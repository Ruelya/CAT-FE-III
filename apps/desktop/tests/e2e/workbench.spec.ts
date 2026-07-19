import { mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type Page,
} from "@playwright/test";

type ElectronApplication = Awaited<ReturnType<typeof electron.launch>>;

interface ElectronHarness {
  application: ElectronApplication;
  page: Page;
  dataDirectory: string;
  exportPath: string;
  consoleErrors: string[];
}

async function launchHarness(label: string): Promise<ElectronHarness> {
  const desktopRoot = process.cwd();
  const workspaceRoot = resolve(desktopRoot, "..", "..");
  const dataDirectory = mkdtempSync(
    join(tmpdir(), `translunar-desktop-${label}-`),
  );
  const exportPath = join(dataDirectory, "translated.docx");
  const fixture = join(workspaceRoot, "fixtures", "docx", "m0-source.docx");
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
  const consoleErrors: string[] = [];
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
      TRANSLUNAR_TEST_EXPORT_DOCX: exportPath,
      TRANSLUNAR_TEST_SOURCE_DOCX: fixture,
    },
  });
  const page = await application.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  return {
    application,
    page,
    dataDirectory,
    exportPath,
    consoleErrors,
  };
}

async function closeHarness(harness: ElectronHarness): Promise<void> {
  await harness.application.close();
  await rm(harness.dataDirectory, { recursive: true, force: true });
}

async function importFixture(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Choose file" }).click();
  await expect(page.getByText("m0-source.docx")).toBeVisible();
  await page.getByRole("button", { name: "Create and import" }).click();
  await expect(
    page.getByRole("region", { name: "Translation segments" }),
  ).toBeVisible();
  await expect(page.locator(".segment-row")).toHaveCount(3);
}

async function resizeWindow(
  application: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await application.evaluate(
    ({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0]?.setSize(
        dimensions.width,
        dimensions.height,
      );
    },
    { width, height },
  );
}

async function waitForPanelMotion(page: Page): Promise<void> {
  await page.waitForTimeout(270);
}

async function openApplicationMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(
    page.getByRole("navigation", { name: "Application views" }),
  ).toBeVisible();
}

test("runs the local-first CAT workflow through Electron", async () => {
  const harness = await launchHarness("workflow");
  const { page, exportPath, consoleErrors } = harness;

  try {
    await importFixture(page);

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
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("manages the offline Assistant and real workspace projections", async () => {
  const harness = await launchHarness("assistant-pages");
  const { application, page, exportPath, consoleErrors } = harness;

  try {
    await importFixture(page);
    await resizeWindow(application, 1250, 744);

    let firstTarget = page.locator(".segment-row").first().locator("textarea");
    await firstTarget.fill("保留期为 60 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await firstTarget.press("Control+Enter");
    await expect(page.locator(".segment-row").first()).toContainText("Issues");

    await page.getByRole("tab", { name: /Assistant/u }).click();
    await expect(page.getByLabel("Requested model")).toHaveValue("grok-4.5");
    await expect(page.getByLabel("Reasoning level")).toHaveValue("high");
    await expect(page.getByText("Offline preview")).toBeVisible();
    await expect(page.locator(".assistant-metric")).toHaveCount(7);
    const inputMetric = page.getByLabel("Synthetic input tokens: 1,438");
    await inputMetric.hover();
    await expect
      .poll(() =>
        inputMetric.evaluate(
          (element) => getComputedStyle(element, "::after").opacity,
        ),
      )
      .toBe("1");

    const secondTarget = page
      .locator(".segment-row")
      .nth(1)
      .locator("textarea");
    const useInTarget = page.getByRole("button", { name: "Use in target" });
    await useInTarget.click();
    await expect(useInTarget).toContainText("Applied");
    await expect(secondTarget).not.toHaveValue("");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await secondTarget.fill("");
    await expect(page.locator(".save-indicator")).toContainText("Saved");

    await page.getByLabel("Requested model").selectOption("local-preview");
    await page.getByLabel("Reasoning level").selectOption("low");
    await page.getByRole("button", { name: /Terminology and tone/u }).click();
    await page.getByRole("menuitem", { name: "New conversation" }).click();
    await expect(page.getByText("No messages", { exact: true })).toBeVisible();
    const composer = page.getByLabel("Ask about the active segment");
    await composer.fill("Shorten the target");
    await composer.press("Control+Enter");
    await expect(page.locator(".assistant-message")).toHaveCount(2);
    await expect(
      page.getByLabel("Offline model profile: local-preview"),
    ).toBeVisible();
    await page.getByRole("button", { name: /Shorten the target/u }).click();
    await page
      .getByRole("menuitemradio", {
        name: "Terminology and tone",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: /Terminology and tone/u }).click();
    await page
      .getByRole("menuitem", { name: "Archive Shorten the target" })
      .click();
    await expect(page.locator(".conversation-row")).toHaveCount(2);

    const thirdTarget = page.locator(".segment-row").nth(2).locator("textarea");
    await thirdTarget.fill("临时草稿");
    await openApplicationMenu(page);
    await page.getByRole("button", { name: "QA review" }).click();
    await expect(
      page.getByRole("heading", { name: "Check the current document" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/page-qa-review-1250x744.png" });
    await page.getByRole("button", { name: "Go to segment" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    await expect(
      page.locator(".segment-row").first().locator("textarea"),
    ).toBeFocused();
    await expect(
      page.locator(".segment-row").nth(2).locator("textarea"),
    ).toHaveValue("临时草稿");
    await page.locator(".segment-row").nth(2).locator("textarea").fill("");
    await expect(page.locator(".save-indicator")).toContainText("Saved");

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Translation memory" }).click();
    await expect(
      page.getByRole("heading", { name: "Translation memory" }),
    ).toBeVisible();
    await expect(page.locator(".tm-entry")).toHaveCount(1);
    await page.screenshot({ path: "test-results/page-tm-1250x744.png" });
    await page.getByRole("button", { name: "Back to workbench" }).click();

    firstTarget = page.locator(".segment-row").first().locator("textarea");
    await firstTarget.fill("保留期为 30 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Run QA" }).click();
    await expect(page.getByText("No open QA issues")).toBeVisible();

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Export review" }).click();
    await expect(
      page.getByRole("heading", { name: "Review before export" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/page-export-1250x744.png" });
    await page.getByRole("button", { name: "Export DOCX" }).click();
    await expect(
      page.getByText(/Exported 1 translated segments/u),
    ).toBeVisible();
    expect(statSync(exportPath).size).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("keeps panel motion, geometry, and Windows rendering coherent", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const harness = await launchHarness("visual");
  const { application, page, consoleErrors } = harness;

  try {
    await importFixture(page);
    await resizeWindow(application, 1920, 1080);
    await page.waitForTimeout(180);

    const suggestions = page.locator(".suggestions-panel");
    const expandedWidth = (await suggestions.boundingBox())?.width ?? 0;
    await page.getByRole("button", { name: "Collapse Suggestions" }).click();
    await page.waitForTimeout(80);
    const collapsingWidth = (await suggestions.boundingBox())?.width ?? 0;
    expect(collapsingWidth).toBeGreaterThan(48);
    expect(collapsingWidth).toBeLessThan(expandedWidth);
    await waitForPanelMotion(page);
    expect((await suggestions.boundingBox())?.width).toBeCloseTo(48, 0);
    await expect(
      page.getByRole("button", { name: "Open Suggestions" }),
    ).toBeFocused();

    await page.getByRole("button", { name: "Open Suggestions" }).click();
    await page.waitForTimeout(80);
    const expandingWidth = (await suggestions.boundingBox())?.width ?? 0;
    expect(expandingWidth).toBeGreaterThan(48);
    expect(expandingWidth).toBeLessThan(expandedWidth);
    await waitForPanelMotion(page);
    expect((await suggestions.boundingBox())?.width).toBeCloseTo(
      expandedWidth,
      0,
    );
    await expect(
      page.getByRole("button", { name: "Collapse Suggestions" }),
    ).toBeFocused();

    const previewResizer = page.getByRole("separator", {
      name: "Resize document preview",
    });
    await previewResizer.focus();
    await previewResizer.press("End");
    await waitForPanelMotion(page);
    expect(
      (await page.locator(".document-preview").boundingBox())?.height,
    ).toBeCloseTo(320, 0);
    await previewResizer.press("Home");
    await waitForPanelMotion(page);
    expect(
      (await page.locator(".document-preview").boundingBox())?.height,
    ).toBeCloseTo(120, 0);
    for (let index = 0; index < 10; index += 1) {
      await previewResizer.press("ArrowUp");
    }
    await waitForPanelMotion(page);
    expect(
      (await page.locator(".document-preview").boundingBox())?.height,
    ).toBeCloseTo(200, 0);
    await page.getByLabel("Follow active segment").uncheck();
    await expect(page.getByLabel("Follow active segment")).not.toBeChecked();
    await page.getByLabel("Follow active segment").check();

    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(180);
      await page.screenshot({
        path: `test-results/workbench-default-${viewport.label}.png`,
      });

      if (viewport.width === 1250) {
        await page.getByRole("tab", { name: /Assistant/u }).click();
        await page.screenshot({
          path: `test-results/workbench-assistant-${viewport.label}.png`,
        });
        const assistantOverflow = await page
          .locator(".assistant-transcript")
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(assistantOverflow).toBeLessThanOrEqual(1);
        await page.getByRole("tab", { name: /^Matches/u }).click();
      }

      await page.getByRole("button", { name: "Collapse Suggestions" }).click();
      await waitForPanelMotion(page);
      await page.screenshot({
        path: `test-results/suggestions-collapsed-${viewport.label}.png`,
      });
      await page.getByRole("button", { name: "Open Suggestions" }).click();
      await waitForPanelMotion(page);

      await page.getByRole("button", { name: "Maximize Suggestions" }).click();
      await waitForPanelMotion(page);
      expect(
        (await page.locator(".editor-region").boundingBox())?.width,
      ).toBeLessThan(2);
      await page.screenshot({
        path: `test-results/suggestions-maximized-${viewport.label}.png`,
      });
      if (viewport.width === 1920) {
        await page.getByRole("tab", { name: /Assistant/u }).click();
        await page.screenshot({
          path: "test-results/suggestions-maximized-assistant-1920x1080.png",
        });
        await page.getByRole("tab", { name: /^Matches/u }).click();
      }
      await page.getByRole("button", { name: "Restore Suggestions" }).click();
      await waitForPanelMotion(page);

      await page.getByRole("button", { name: "Collapse preview" }).click();
      await waitForPanelMotion(page);
      expect(
        (await page.locator(".document-preview").boundingBox())?.height,
      ).toBeLessThanOrEqual(33);
      await expect(
        page.getByRole("button", { name: "Open preview" }),
      ).toBeFocused();
      await page.screenshot({
        path: `test-results/preview-collapsed-${viewport.label}.png`,
      });
      await page.getByRole("button", { name: "Open preview" }).click();
      await waitForPanelMotion(page);

      await page.getByRole("button", { name: "Maximize preview" }).click();
      await waitForPanelMotion(page);
      expect(
        (await page.locator(".segment-grid").boundingBox())?.height,
      ).toBeLessThan(2);
      await page.screenshot({
        path: `test-results/preview-maximized-${viewport.label}.png`,
      });
      await page.getByRole("button", { name: "Restore preview" }).click();
      await waitForPanelMotion(page);

      const editorBox = await page.locator(".editor-region").boundingBox();
      const suggestionsBox = await suggestions.boundingBox();
      expect(
        editorBox &&
          suggestionsBox &&
          editorBox.x + editorBox.width <= suggestionsBox.x + 1,
      ).toBeTruthy();
      await expect(page.locator(".segment-row").first()).toHaveClass(/active/u);
    }

    const renderingEvidence = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const suggestionsTitle = document.querySelector(
        ".suggestions-header > strong",
      );
      const panel = document.querySelector(".suggestions-panel");
      const panelBox = panel?.getBoundingClientRect();
      return {
        devicePixelRatio: window.devicePixelRatio,
        bodyFontFamily: bodyStyle.fontFamily,
        bodyTextRendering: bodyStyle.textRendering,
        segoeAvailable: document.fonts.check('14px "Segoe UI"'),
        yaheiAvailable: document.fonts.check('14px "Microsoft YaHei UI"'),
        suggestionsTitleAfter: suggestionsTitle
          ? getComputedStyle(suggestionsTitle, "::after").content
          : null,
        suggestionsX: panelBox?.x ?? null,
        suggestionsWidth: panelBox?.width ?? null,
      };
    });
    expect(renderingEvidence.devicePixelRatio).toBeGreaterThan(0);
    expect(renderingEvidence.bodyFontFamily).toContain("Segoe UI");
    expect(renderingEvidence.suggestionsTitleAfter).toBe("none");
    expect(renderingEvidence.suggestionsWidth).toBeCloseTo(400, 0);
    await testInfo.attach("rendering-evidence", {
      body: JSON.stringify(renderingEvidence, null, 2),
      contentType: "application/json",
    });
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});
