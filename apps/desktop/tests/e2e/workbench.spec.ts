import { mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

test("runs the local-first CAT workflow through Electron", async () => {
  const desktopRoot = process.cwd();
  const workspaceRoot = resolve(desktopRoot, "..", "..");
  const dataDirectory = mkdtempSync(join(tmpdir(), "translunar-desktop-e2e-"));
  const exportPath = join(dataDirectory, "translated.docx");
  const fixture = join(workspaceRoot, "fixtures", "docx", "m0-source.docx");
  const engine = join(
    workspaceRoot,
    "target",
    "debug",
    process.platform === "win32"
      ? "translunar-engine.exe"
      : "translunar-engine",
  );
  const consoleErrors: string[] = [];

  const application = await electron.launch({
    args: ["--no-sandbox", "."],
    cwd: desktopRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      TRANSLUNAR_DATA_DIR: dataDirectory,
      TRANSLUNAR_ENGINE_PATH: engine,
      TRANSLUNAR_TEST_EXPORT_DOCX: exportPath,
      TRANSLUNAR_TEST_SOURCE_DOCX: fixture,
    },
  });

  try {
    const page = await application.firstWindow();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.getByRole("button", { name: "Choose file" }).click();
    await expect(page.getByText("m0-source.docx")).toBeVisible();
    await page.getByRole("button", { name: "Create and import" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    await expect(page.locator(".segment-row")).toHaveCount(3);

    let firstTarget = page.locator(".segment-row").first().locator("textarea");
    await firstTarget.fill("保留期为 60 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saving");
    await expect(page.locator(".save-indicator")).toContainText("Saved");

    await page.evaluate("window.translunar.restartEngine()");
    await page.reload();
    await expect(page.locator(".segment-row")).toHaveCount(3);
    firstTarget = page.locator(".segment-row").first().locator("textarea");
    await expect(firstTarget).toHaveValue("保留期为 60 天。");

    await firstTarget.evaluate((element) => {
      element.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
    });
    await firstTarget.press("Control+Enter");
    await expect(page.locator(".segment-row").first()).toContainText("Draft");
    await firstTarget.evaluate((element) => {
      element.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    await firstTarget.press("Control+Enter");
    await expect(page.locator(".segment-row").first()).toContainText("Issues");
    await expect(
      page.locator(".segment-row").nth(1).locator("textarea"),
    ).toBeFocused();

    await page.getByRole("tab", { name: /^QA/u }).click();
    await expect(page.locator(".qa-card")).toHaveCount(1);
    await expect(page.locator(".qa-evidence")).toContainText("30");
    await expect(page.locator(".qa-evidence")).toContainText("60");
    await firstTarget.focus();
    await page.getByRole("tab", { name: /^Matches/u }).click();
    await expect(page.locator(".match-card")).toHaveCount(1);
    await expect(page.locator(".match-target")).toContainText(
      "保留期为 60 天。",
    );

    await page.getByRole("button", { name: "Collapse Suggestions" }).click();
    await page.waitForTimeout(260);
    expect(
      (await page.locator(".suggestions-panel").boundingBox())?.width,
    ).toBeCloseTo(48, 0);
    await page.getByRole("button", { name: "Open Suggestions" }).click();
    await page.waitForTimeout(260);
    expect(
      (await page.locator(".suggestions-panel").boundingBox())?.width,
    ).toBeGreaterThan(300);
    await page.getByRole("button", { name: "Maximize Suggestions" }).click();
    await page.waitForTimeout(260);
    expect(
      (await page.locator(".editor-region").boundingBox())?.width,
    ).toBeLessThan(2);
    await page.getByRole("button", { name: "Restore Suggestions" }).click();

    await page.getByRole("button", { name: "Collapse preview" }).click();
    await page.waitForTimeout(240);
    expect(
      (await page.locator(".document-preview").boundingBox())?.height,
    ).toBeLessThanOrEqual(33);
    await page.getByRole("button", { name: "Open preview" }).click();
    await page.getByRole("button", { name: "Maximize preview" }).click();
    await page.waitForTimeout(240);
    expect(
      (await page.locator(".segment-grid").boundingBox())?.height,
    ).toBeLessThan(2);
    await page.getByRole("button", { name: "Restore preview" }).click();

    firstTarget = page.locator(".segment-row").first().locator("textarea");
    await firstTarget.fill("保留期为 30 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.locator(".segment-row").first()).toContainText(
      "Confirmed",
    );
    await page.getByRole("button", { name: "Run QA" }).click();
    await expect(page.getByText("No open QA issues")).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.locator(".toast")).toContainText(
      "Exported 1 translated segments",
    );
    expect(statSync(exportPath).size).toBeGreaterThan(0);

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1250, 744);
    });
    await page.waitForTimeout(180);
    await page.screenshot({ path: "test-results/workbench-1250x744.png" });
    const editorBox = await page.locator(".editor-region").boundingBox();
    const suggestionsBox = await page
      .locator(".suggestions-panel")
      .boundingBox();
    const statusLabelBox = await page
      .locator(".segment-row")
      .nth(1)
      .locator(".status-lamp")
      .boundingBox();
    const sourceCellBox = await page
      .locator(".segment-row")
      .nth(1)
      .locator(".source-cell")
      .boundingBox();
    expect(
      editorBox &&
        suggestionsBox &&
        editorBox.x + editorBox.width <= suggestionsBox.x + 1,
    ).toBeTruthy();
    expect(
      statusLabelBox &&
        sourceCellBox &&
        statusLabelBox.x + statusLabelBox.width <= sourceCellBox.x,
    ).toBeTruthy();

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1680, 942);
    });
    await page.waitForTimeout(180);
    await page.screenshot({ path: "test-results/workbench-1680x942.png" });
    expect(consoleErrors).toEqual([]);
  } finally {
    await application.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
