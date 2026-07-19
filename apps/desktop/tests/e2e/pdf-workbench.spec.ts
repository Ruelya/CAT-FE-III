import { mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

test.skip(
  !process.env.TRANSLUNAR_PDF_E2E,
  "PDF desktop E2E requires Poppler and Tesseract on the test host",
);

test("reviews and corrects a scanned PDF through the workbench", async () => {
  const desktopRoot = process.cwd();
  const workspaceRoot = resolve(desktopRoot, "..", "..");
  const dataDirectory = mkdtempSync(join(tmpdir(), "translunar-pdf-desktop-"));
  const exportPath = join(dataDirectory, "scanned-translated.docx");
  const fixture = join(workspaceRoot, "fixtures", "pdf", "scanned.pdf");
  const engine =
    process.env.TRANSLUNAR_ENGINE_PATH ??
    join(
      workspaceRoot,
      "target",
      "debug",
      process.platform === "win32"
        ? "translunar-engine.exe"
        : "translunar-engine",
    );
  const application = await electron.launch({
    args: [
      "--no-sandbox",
      "--user-data-dir=" + join(dataDirectory, "electron-user-data"),
      ".",
    ],
    cwd: desktopRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      TRANSLUNAR_DATA_DIR: dataDirectory,
      TRANSLUNAR_ENGINE_PATH: engine,
      TRANSLUNAR_TEST_SOURCE: fixture,
      TRANSLUNAR_TEST_EXPORT_DOCX: exportPath,
    },
  });
  const page = await application.firstWindow();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1920, 1080);
    });
    await page.getByRole("button", { name: "Choose file" }).click();
    await expect(page.getByText("scanned.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Create and import" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    await expect(page.locator(".segment-row")).toHaveCount(3);
    await expect(page.locator('img[alt^="Original PDF page"]')).toBeVisible();
    await page.screenshot({ path: "test-results/pdf-review-1920x1080.png" });

    const invoiceRow = page.locator(".segment-row").filter({
      hasText: "INV-2048",
    });
    await invoiceRow.click();
    await page.getByRole("button", { name: "Correct OCR" }).click();
    const sourceEditor = page.getByLabel("Correct OCR source");
    await sourceEditor.fill("Keep invoice number INV-2048 unchanged!");
    await page
      .getByLabel("OCR correction reason")
      .fill("Verified against original scan");
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(
      page.getByRole("button", { name: "Correct OCR" }),
    ).toBeVisible();
    await expect(invoiceRow).toContainText("INV-2048 unchanged!");
    await invoiceRow.locator("textarea").fill("发票号 INV-2048 保持不变！");
    await expect(page.locator(".save-indicator")).toContainText("Saved");

    await page.getByRole("button", { name: "Collapse preview" }).click();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Open preview" }).click();
    await page.getByRole("button", { name: "Maximize preview" }).click();
    await expect(page.locator(".pdf-preview-grid")).toBeVisible();
    await page.screenshot({
      path: "test-results/pdf-review-maximized-1920x1080.png",
    });

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.locator(".toast")).toContainText(
      "Exported 1 translated segments",
    );
    expect(statSync(exportPath).size).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await application.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
