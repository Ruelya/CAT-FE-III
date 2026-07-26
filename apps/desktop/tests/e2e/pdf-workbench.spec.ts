import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type Page,
} from "@playwright/test";

import type { DesktopApi } from "../../src/shared/desktop-api.js";
import { dismissFirstRunTutorial } from "./product-shell-helpers.js";

test.skip(
  !process.env.TRANSLUNAR_PDF_E2E,
  "PDF desktop E2E requires Poppler and Tesseract on the test host",
);

async function waitForPdfPreviewReady(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolveFrame()),
        );
      }),
  );

  const loadingState = page.locator(
    ".workbench-visual-state.state-preview.loading",
  );
  const pageImage = page.locator('img[alt^="Original PDF page"]');
  await expect(loadingState).toHaveCount(0);
  await expect(pageImage).toBeVisible();
  await expect
    .poll(() =>
      pageImage.evaluate(
        (element) =>
          (element as HTMLImageElement).complete &&
          (element as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);

  // Resizing can enqueue a render after the previous image was already visible.
  await page.waitForTimeout(100);
  await expect(loadingState).toHaveCount(0);
  await expect(pageImage).toBeVisible();
}

async function setWorkbenchTheme(page: Page, theme: "light" | "dark") {
  await page.locator(".segment-row.active textarea").focus();
  await page.keyboard.press("Control+,");
  const preferences = page.getByRole("dialog", {
    name: "Editor preferences",
  });
  await expect(preferences).toBeVisible();
  await preferences.locator(".preference-controls select").selectOption(theme);
  await expect(page.locator(".workbench-app")).toHaveClass(
    new RegExp(`theme-${theme}`, "u"),
  );
  await preferences
    .getByRole("button", { name: "Close editor preferences" })
    .click();
}

async function expectPdfLoadingGeometry(page: Page) {
  const state = page.locator(".workbench-visual-state.state-preview.loading");
  const [stateBox, skeletonBox, labelBox, statusBox] = await Promise.all([
    state.boundingBox(),
    state.locator(".workbench-state-skeleton").boundingBox(),
    state.locator(".workbench-state-label").boundingBox(),
    page.locator(".status-bar").boundingBox(),
  ]);
  expect(stateBox).not.toBeNull();
  expect(skeletonBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(
    (skeletonBox?.y ?? 0) + (skeletonBox?.height ?? 0),
  ).toBeLessThanOrEqual((labelBox?.y ?? 0) + 1);
  expect((labelBox?.y ?? 0) + (labelBox?.height ?? 0)).toBeLessThanOrEqual(
    (stateBox?.y ?? 0) + (stateBox?.height ?? 0) + 1,
  );
  expect((stateBox?.y ?? 0) + (stateBox?.height ?? 0)).toBeLessThanOrEqual(
    (statusBox?.y ?? 0) + 1,
  );
}

test("reviews and corrects a scanned PDF through the workbench", async () => {
  const desktopRoot = process.cwd();
  const workspaceRoot = resolve(desktopRoot, "..", "..");
  const dataDirectory = mkdtempSync(join(tmpdir(), "translunar-pdf-desktop-"));
  const exportPath = join(dataDirectory, "scanned-translated.docx");
  const fixture = join(workspaceRoot, "fixtures", "pdf", "scanned.pdf");
  const evidenceDirectory = join(
    workspaceRoot,
    ".trellis",
    "tasks",
    "07-21-workbench-visual-identity",
    "evidence",
    "screenshots",
  );
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
      TRANSLUNAR_TEST_SOURCE_FILES: fixture,
      TRANSLUNAR_TEST_EXPORT_DOCX: exportPath,
      TRANSLUNAR_TEST_ENGINE_DELAY_METHODS: "pdf.page.list",
      TRANSLUNAR_TEST_ENGINE_DELAY_MS: "6000",
      TRANSLUNAR_TEST_ENGINE_DELAY_LIMIT: "1",
    },
  });
  const page = await application.firstWindow();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await dismissFirstRunTutorial(page);
    await page.evaluate(async () => {
      const api = (window as unknown as { translunar: DesktopApi }).translunar;
      await api.updateShellSettings({ locale: "en-US" });
    });
    await page.reload();
    await dismissFirstRunTutorial(page);
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1920, 1080);
    });
    await expect(
      page.getByRole("heading", { name: "Continue translating" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New project" }).first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Add files" }).click();
    await expect(page.getByText("scanned.pdf", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    await expect(page.locator(".segment-row")).toHaveCount(3);
    mkdirSync(evidenceDirectory, { recursive: true });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1250, 744);
    });
    const pdfLoading = page.getByRole("status", {
      name: "Rendering the PDF page…",
    });
    await expect(pdfLoading).toBeVisible();
    await expectPdfLoadingGeometry(page);
    await page.screenshot({
      path: join(evidenceDirectory, "wp2-loading-pdf-page-1250x744-light.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setWorkbenchTheme(page, "dark");
    await expect(pdfLoading).toBeVisible();
    await expect(pdfLoading.locator(".state-skeleton-page")).toHaveCSS(
      "animation-name",
      "none",
    );
    await expectPdfLoadingGeometry(page);
    await page.screenshot({
      path: join(
        evidenceDirectory,
        "wp2-loading-pdf-page-1250x744-dark-reduced.png",
      ),
    });
    await setWorkbenchTheme(page, "light");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await waitForPdfPreviewReady(page);
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await application.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
      }, viewport);
      await waitForPdfPreviewReady(page);
      await page.screenshot({
        path: join(
          evidenceDirectory,
          `wp6-preview-pdf-default-${viewport.label}.png`,
        ),
      });
      await page.getByRole("button", { name: "Collapse preview" }).click();
      await page.waitForTimeout(250);
      await page.screenshot({
        path: join(
          evidenceDirectory,
          `wp6-preview-pdf-collapsed-${viewport.label}.png`,
        ),
      });
      await page.getByRole("button", { name: "Open preview" }).click();
      await waitForPdfPreviewReady(page);
      await page.getByRole("button", { name: "Maximize preview" }).click();
      await expect(page.locator(".document-preview")).toHaveAttribute(
        "data-preview-mode",
        "maximized",
      );
      await expect(page.locator(".pdf-preview-grid")).toBeVisible();
      await waitForPdfPreviewReady(page);
      await page.screenshot({
        path: join(
          evidenceDirectory,
          `wp6-preview-pdf-maximized-${viewport.label}.png`,
        ),
      });
      await page.getByRole("button", { name: "Restore preview" }).click();
    }

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

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.locator(".toast")).toContainText(
      "document export is blocked by open QA errors",
    );
    await page.locator(".toast").click();
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions" })
      .click();
    await page
      .getByRole("navigation", { name: "Application views" })
      .getByRole("button", { name: "Export review" })
      .click();
    await page.getByLabel("Override the QA delivery gate").check();
    await page.getByLabel("Actor").fill("PDF E2E reviewer");
    await page
      .getByLabel("Reason")
      .fill("Fixture intentionally keeps open QA evidence for PDF coverage");
    await page.getByRole("button", { name: "Export document" }).click();
    await expect(
      page.getByText(
        /Exported \d+ translated segments to scanned-translated\.docx\./u,
      ),
    ).toBeVisible();
    expect(statSync(exportPath).size).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await application.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
