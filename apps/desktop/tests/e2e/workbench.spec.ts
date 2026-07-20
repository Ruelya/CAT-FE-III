import {
  existsSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:http";

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

async function launchHarness(
  label: string,
  sourceOverride?: string,
): Promise<ElectronHarness> {
  const desktopRoot = process.cwd();
  const workspaceRoot = resolve(desktopRoot, "..", "..");
  const dataDirectory = mkdtempSync(
    join(tmpdir(), `translunar-desktop-${label}-`),
  );
  const exportPath = join(dataDirectory, "translated.docx");
  const fixture =
    sourceOverride ?? join(workspaceRoot, "fixtures", "docx", "m0-source.docx");
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
      TRANSLUNAR_TEST_EXPORT_DIRECTORY: dataDirectory,
      TRANSLUNAR_TEST_SOURCE: fixture,
      TRANSLUNAR_AI_TEST_MODE: "1",
      TRANSLUNAR_AI_TEST_CREDENTIAL: "desktop-ai-secret",
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

interface AiFixture {
  url: string;
  readonly requestCount: number;
  close(): Promise<void>;
}

async function startAiFixture(): Promise<AiFixture> {
  let requestCount = 0;
  const server: Server = createServer((request, response) => {
    requestCount += 1;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      expect(body).not.toContain("desktop-ai-secret");
      const events = [
        'data: {"choices":[{"delta":{"content":"Desktop fixture "}}]}',
        'data: {"choices":[{"delta":{"content":"translation"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":4}}',
        "data: [DONE]",
        "",
      ].join("\n\n");
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "content-length": Buffer.byteLength(events),
        connection: "close",
      });
      response.end(events);
    });
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("AI fixture address is unavailable.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    get requestCount() {
      return requestCount;
    },
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) rejectPromise(error);
          else resolvePromise();
        });
      }),
  };
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
    await firstTarget.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      );
    });
    await expect(
      page.locator(".segment-row").nth(1).locator("textarea"),
    ).not.toBeFocused();
    await firstTarget.evaluate((element) => {
      element.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    await firstTarget.focus();
    await firstTarget.press("Control+Enter");
    await expect(page.locator(".segment-row").first()).toContainText("Issues");
    await expect(
      page.locator(".segment-row").nth(1).locator("textarea"),
    ).toBeFocused();

    await page.getByRole("tab", { name: /^QA/u }).click();
    const lengthIssue = page.locator(".qa-card", {
      hasText: "Target length",
    });
    await expect(lengthIssue).toHaveCount(1);
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
    await expect(page.locator(".segment-row").first()).toContainText("Issues");
    await page.getByRole("button", { name: "Run QA" }).click();
    await expect(page.locator(".qa-card").first()).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.locator(".toast")).toContainText("QA");
    expect(existsSync(exportPath)).toBe(false);
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
    const metricBox = await inputMetric.boundingBox();
    expect(metricBox).not.toBeNull();
    await page.mouse.move(1, 1);
    await page.mouse.move(
      (metricBox?.x ?? 0) + (metricBox?.width ?? 0) / 2,
      (metricBox?.y ?? 0) + (metricBox?.height ?? 0) / 2,
    );
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
      page.getByRole("heading", { name: "QA and review" }),
    ).toBeVisible();
    const editProfileButton = page
      .getByLabel("QA controls")
      .getByRole("button", { name: "Edit profile" });
    await expect(editProfileButton).toBeEnabled();
    await editProfileButton.click();
    let profileDialog = page.locator(".profile-editor");
    await expect(profileDialog).toBeVisible();
    await profileDialog
      .locator("label", { hasText: "Name" })
      .locator("input")
      .fill("E2E QA profile");
    await profileDialog.getByRole("button", { name: "Clone profile" }).click();
    await expect(profileDialog).not.toBeVisible();
    await expect(page.getByLabel("Profile")).toContainText("E2E QA profile");

    await expect(editProfileButton).toBeEnabled();
    await editProfileButton.click();
    profileDialog = page.locator(".profile-editor");
    await expect(profileDialog).toBeVisible();
    await profileDialog.getByRole("button", { name: "Add rule" }).click();
    await profileDialog.getByLabel("Pattern").fill("临时草稿");
    await profileDialog
      .getByLabel("Message")
      .fill("Temporary draft marker remains");
    await profileDialog.getByRole("button", { name: "Save profile" }).click();
    await expect(profileDialog).not.toBeVisible();

    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("button", { name: "Run QA" }).click();
    await page.getByRole("button", { name: "Document", exact: true }).click();
    await page.getByRole("button", { name: "Run QA" }).click();
    await page.getByRole("button", { name: "HTML" }).click();
    await expect(page.getByText(/Saved HTML report/u)).toBeVisible();
    await page.getByRole("button", { name: "XLSX" }).click();
    await expect(page.getByText(/Saved XLSX report/u)).toBeVisible();
    const reportFiles = readdirSync(harness.dataDirectory).filter((name) =>
      name.startsWith("qa-"),
    );
    expect(reportFiles.some((name) => name.endsWith(".html"))).toBe(true);
    expect(reportFiles.some((name) => name.endsWith(".xlsx"))).toBe(true);
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(100);
      await page.screenshot({
        path: `test-results/qa-review-${viewport.label}.png`,
      });
      const overflow = await page
        .locator(".qa-workspace")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    await resizeWindow(application, 1250, 744);
    const mandatoryReview = page.getByLabel("Mandatory review");
    await mandatoryReview.click();
    await page.waitForTimeout(150);
    const reviewPolicyError =
      (await page.locator(".qa-banner").textContent()) ?? "";
    expect(mandatoryReview, reviewPolicyError).not.toBeChecked();
    await expect(page.getByText(/Direct sign-off is enabled/u)).toBeVisible();
    await expect(page.locator(".qa-issue-row").first()).toBeVisible();
    await expect(
      page.getByText("Temporary draft marker remains"),
    ).toBeVisible();
    await expect(page.getByLabel("Review statistics and queue")).toBeVisible();
    await page.getByLabel("Disposition").selectOption("all");
    await page.getByLabel("Disposition").selectOption("open");
    await page
      .locator(".qa-issue-row", { hasText: "Temporary draft marker remains" })
      .click();
    await page.getByRole("button", { name: "Waive finding" }).click();
    const waiverDialog = page.getByRole("dialog", {
      name: "Waive this finding",
    });
    await waiverDialog.getByLabel("Actor").fill("E2E QA reviewer");
    await waiverDialog
      .getByLabel("Reason")
      .fill("Verified fixture-specific false positive");
    await waiverDialog.getByRole("button", { name: "Record waiver" }).click();
    await page.getByLabel("Disposition").selectOption("all");
    await page
      .locator(".qa-issue-row", { hasText: "Temporary draft marker remains" })
      .click();
    await expect(
      page.getByRole("button", { name: "Revoke waiver" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Revoke waiver" }).click();
    await expect(
      page.getByRole("button", { name: "Waive finding" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/page-qa-review-1250x744.png" });
    await page.getByRole("button", { name: "Open segment" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible();
    await expect(
      page.locator(".segment-row").nth(2).locator("textarea"),
    ).toBeFocused();
    await expect(
      page.locator(".segment-row").nth(2).locator("textarea"),
    ).toHaveValue("临时草稿");
    const firstRowForSignoff = page.locator(".segment-row").first();
    await firstRowForSignoff.locator("textarea").click();
    await firstRowForSignoff
      .getByRole("button", { name: "Open review panel" })
      .click();
    await page.getByRole("button", { name: "signed", exact: true }).click();
    const signoffDialog = page.getByRole("dialog", {
      name: "Sign off directly",
    });
    await signoffDialog.getByLabel("Actor").fill("E2E direct reviewer");
    await signoffDialog
      .getByLabel("Reason")
      .fill("Exercise explicit direct sign-off audit");
    await signoffDialog.getByRole("button", { name: "Sign off" }).click();
    await expect(firstRowForSignoff).toContainText("signed");
    await page
      .getByRole("button", { name: "translation", exact: true })
      .click();
    await page.getByRole("button", { name: "Close review panel" }).click();
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

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "Export review" }).click();
    await expect(
      page.getByRole("heading", { name: "Export review" }),
    ).toBeVisible();
    await expect(page.getByText("Publication blocked")).toBeVisible();
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(100);
      await page.screenshot({
        path: `test-results/export-review-${viewport.label}.png`,
      });
      const overflow = await page
        .locator(".export-review-workspace")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    await resizeWindow(application, 1250, 744);
    await page.screenshot({ path: "test-results/page-export-1250x744.png" });
    await page.getByLabel("Override the QA delivery gate").check();
    await page.getByLabel("Actor").fill("E2E delivery reviewer");
    await page
      .getByLabel("Reason")
      .fill(
        "Fixture intentionally leaves untranslated segments for round-trip coverage",
      );
    await page.getByRole("button", { name: "Export document" }).click();
    await expect(
      page.getByText(/Exported \d+ translated segments/u),
    ).toBeVisible();
    expect(statSync(exportPath).size).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("configures BYOK AI, streams a grounded run, applies its diff, and reports usage", async () => {
  const fixture = await startAiFixture();
  const harness = await launchHarness("live-ai");
  const { application, page, consoleErrors } = harness;

  try {
    await importFixture(page);
    await openApplicationMenu(page);
    await page.getByRole("button", { name: "AI control" }).click();
    await expect(
      page.getByRole("heading", { name: "AI control" }),
    ).toBeVisible();

    await page.getByLabel("Connector").selectOption("openaiCompatible");
    await page.getByLabel("Profile name").fill("Desktop fixture");
    await page.getByLabel("Base URL").fill(fixture.url);
    await page.getByLabel("Model").fill("fixture-model");
    await page.getByRole("button", { name: "Add provider" }).click();

    const profile = page.locator(".ai-profile-row", {
      hasText: "Desktop fixture",
    });
    await expect(profile).toBeVisible();
    await profile.getByRole("button", { name: "Edit Desktop fixture" }).click();
    const profileEdit = page.locator(".ai-profile-edit");
    await profileEdit.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Desktop fixture profile updated."),
    ).toBeVisible();
    await profile
      .getByRole("textbox", {
        name: "Credential for Desktop fixture",
        exact: true,
      })
      .fill("desktop-ai-secret");
    const storeCredential = profile.locator(".ai-credential-entry button");
    await expect(storeCredential).toBeEnabled();
    await storeCredential.click();
    await expect(profile).toContainText("Stored");

    await page.getByLabel("AI enabled").check();
    await page
      .getByLabel("Default profile")
      .selectOption({ label: "Desktop fixture" });
    await page.getByRole("button", { name: "Save policy" }).click();
    await expect(page.getByText("AI workspace policy saved.")).toBeVisible();
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(180);
      await page.screenshot({
        path: `test-results/ai-control-${viewport.label}.png`,
      });
      const horizontalOverflow = await page
        .locator(".ai-control-surface")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(horizontalOverflow).toBeLessThanOrEqual(1);
    }
    await page.getByRole("button", { name: "Back to workbench" }).click();

    const targetRow = page.locator(".segment-row").nth(2);
    const target = targetRow.locator("textarea");
    await target.click();
    await targetRow
      .getByRole("button", { name: "Copy protected tags" })
      .click();
    await expect(
      targetRow.locator(".target-tag-strip .tag-capsule"),
    ).not.toHaveCount(0);
    await page.getByRole("tab", { name: /Assistant/u }).click();
    await expect(page.getByText("Engine connected")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByLabel("Requested model")).toContainText(
      "Desktop fixture",
    );
    await page.getByRole("button", { name: /Translate/u }).click();
    await expect(page.locator(".grounding-inspector")).toBeVisible();
    await expect(page.locator(".ai-diff-proposal")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".assistant-metric")).toHaveCount(7);
    for (const viewport of [
      { width: 1250, height: 744, label: "1250x744" },
      { width: 1680, height: 942, label: "1680x942" },
      { width: 1920, height: 1080, label: "1920x1080" },
    ]) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(180);
      await page.screenshot({
        path: `test-results/assistant-online-${viewport.label}.png`,
      });
      const transcriptOverflow = await page
        .locator(".assistant-transcript")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(transcriptOverflow).toBeLessThanOrEqual(1);
      if (viewport.width <= 1320) {
        const filterBox = await page.locator(".filter-group").boundingBox();
        const matchScopeBox = await page.locator(".match-scope").boundingBox();
        expect(filterBox).not.toBeNull();
        expect(matchScopeBox).not.toBeNull();
        expect(
          (filterBox?.x ?? 0) + (filterBox?.width ?? 0),
        ).toBeLessThanOrEqual((matchScopeBox?.x ?? 0) + 1);
      }
    }
    await page
      .locator(".ai-diff-proposal")
      .getByRole("button", { name: "Use in target" })
      .click();
    await expect(target).toHaveValue("Desktop fixture translation");

    await openApplicationMenu(page);
    await page.getByRole("button", { name: "AI control" }).click();
    await page.getByRole("tab", { name: /Usage/u }).click();
    await expect(page.locator(".usage-table")).toContainText(
      "openai_compatible",
    );
    await expect(page.locator(".usage-table")).toContainText("20");
    await page.getByRole("tab", { name: /Batch/u }).click();
    await page.getByLabel("Requests / minute").fill("600");
    await page.getByRole("button", { name: "Start batch" }).click();
    await expect(page.locator(".batch-meter")).toContainText(
      "completedWithErrors",
      { timeout: 15_000 },
    );
    await expect(page.locator(".batch-item-list")).toContainText(
      "tag_validation_failed",
    );
    expect(fixture.requestCount).toBe(3);
    await page.getByRole("tab", { name: /Providers/u }).click();
    await profile
      .getByRole("button", {
        name: "Delete credential for Desktop fixture",
      })
      .click();
    await expect(profile).toContainText("Missing");
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
    await fixture.close();
  }
});

test("uses the authoritative professional editor commands", async () => {
  const harness = await launchHarness("professional-editor");
  const { page, consoleErrors } = harness;

  try {
    await importFixture(page);
    const firstRow = page.locator(".segment-row").first();
    const firstTarget = firstRow.locator("textarea");
    await expect(firstRow.locator(".tag-capsule.source-tag")).toHaveCount(4);
    await expect(firstRow.locator(".tag-issue")).toHaveCount(0);

    await firstTarget.fill("保留期为 30 天。");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await firstTarget.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error("Target editor is not a textarea.");
      }
      element.focus();
      element.setSelectionRange(0, 0);
    });
    await firstRow
      .getByRole("button", { name: "Insert protected tag pair" })
      .click();
    await expect(
      firstRow.locator(".target-tag-strip .tag-capsule"),
    ).toHaveCount(2);
    const insertedPairEnd = firstRow
      .locator(".target-tag-strip .tag-capsule")
      .nth(1);
    await expect(insertedPairEnd.locator("small")).toHaveText("0");
    await insertedPairEnd.click();
    await expect(insertedPairEnd).toHaveClass(/selected/u);
    await firstTarget.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error("Target editor is not a textarea.");
      }
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
    await firstTarget.press("Control+K");
    await page.getByLabel("Filter commands").fill("move selected tag");
    await page
      .getByRole("option", { name: /Move selected tag to caret/u })
      .click();
    await expect(insertedPairEnd.locator("small")).not.toHaveText("0");
    await firstRow.getByRole("button", { name: "Copy protected tags" }).click();
    await expect(
      firstRow.locator(".target-tag-strip .tag-capsule"),
    ).toHaveCount(4);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(firstRow).toContainText("Issues");

    await firstTarget.fill("保留期为");
    await expect(
      firstRow.getByRole("button", { name: "Accept TM autocomplete" }),
    ).toContainText("30 天。");
    await firstTarget.press("Tab");
    await expect(firstTarget).toHaveValue("保留期为 30 天。");

    await firstTarget.focus();
    await firstTarget.press("Control+A");
    await firstTarget.dispatchEvent("keydown", {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    await expect(
      page.getByRole("dialog", { name: "Concordance" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".concordance-results article")).toHaveCount(1);
    await expect(page.locator(".concordance-results")).toContainText(
      "保留期为 30 天。",
    );
    await page.getByRole("button", { name: "Close concordance" }).click();

    await firstTarget.focus();
    await firstTarget.dispatchEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      bubbles: true,
    });
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toBeVisible();
    await page.getByLabel("Filter commands").fill("cycle theme");
    await page.getByRole("option", { name: /Cycle theme/u }).click();
    await expect(page.locator(".workbench-app")).toHaveClass(/theme-dark/u);

    await firstTarget.focus();
    await firstTarget.dispatchEvent("keydown", {
      key: ",",
      code: "Comma",
      ctrlKey: true,
      bubbles: true,
    });
    await expect(
      page.getByRole("dialog", { name: "Editor preferences" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Trados", exact: true }).click();
    await expect(page.getByLabel("Shortcut for Next segment")).toHaveValue(
      "Ctrl+Alt+ArrowDown",
    );
    await page.getByRole("button", { name: "Save shortcuts" }).click();

    await page.getByRole("button", { name: "Open find and replace" }).click();
    await expect(
      page.getByRole("dialog", { name: "Find and replace" }),
    ).toBeVisible();
    const replaceInputs = page.locator(".find-dialog input");
    await replaceInputs.nth(0).fill("30");
    await replaceInputs.nth(1).fill("45");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".replace-preview")).toContainText("1 segments");
    await page.getByRole("button", { name: "Apply unchanged preview" }).click();
    await expect(firstTarget).toHaveValue("保留期为 45 天。");

    await page.getByRole("button", { name: "Undo editor operation" }).click();
    await expect(firstTarget).toHaveValue("保留期为 30 天。");
    await page.getByRole("button", { name: "Redo editor operation" }).click();
    await expect(firstTarget).toHaveValue("保留期为 45 天。");

    await firstRow.getByRole("button", { name: "Open comments" }).click();
    await page.getByLabel("New comment").fill("Verify the retention number.");
    await page.getByRole("button", { name: "Add comment" }).click();
    await expect(page.getByText("Verify the retention number.")).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Edited comment text")
      .fill("Verify the updated retention number.");
    await page.getByRole("button", { name: "Save edit" }).click();
    await expect(
      page.getByText("Verify the updated retention number."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    await page.getByRole("button", { name: "Reopen" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("No comments on this segment.")).toBeVisible();
    await page.getByRole("button", { name: "Close comments" }).click();

    const thirdRow = page.locator(".segment-row").nth(2);
    await thirdRow.click();
    const thirdTarget = thirdRow.locator("textarea");
    await thirdTarget.fill("鼠标和打印机里的软件");
    await expect(page.locator(".save-indicator")).toContainText("Saved");
    await thirdRow
      .getByRole("button", { name: "Open Chinese conversion" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Chinese conversion" }),
    ).toBeVisible();
    await page
      .getByLabel("Chinese conversion profile")
      .selectOption("simplifiedToTaiwan");
    await page.getByRole("button", { name: "Apply conversion" }).click();
    await expect(thirdTarget).toHaveValue("滑鼠和印表機裡的軟體");
    await thirdRow.getByRole("button", { name: "Correct source" }).click();
    await page
      .getByLabel("Corrected source")
      .fill("Corrected source for review.");
    await page.getByLabel("Source correction reason").fill("Fix source typo");
    await page.getByRole("button", { name: "Apply correction" }).click();
    await expect(thirdRow.locator(".source-cell .tagged-text")).toHaveAttribute(
      "aria-label",
      "Corrected source for review.",
    );

    await thirdRow.getByRole("button", { name: "Open review panel" }).click();
    await page
      .getByLabel("Proposed source revision")
      .fill("Corrected source after reviewer feedback.");
    await page.getByRole("button", { name: "Create review proposal" }).click();
    await expect(page.locator(".review-thread")).toContainText(
      "Source revision",
    );
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(thirdRow.locator(".source-cell .tagged-text")).toHaveAttribute(
      "aria-label",
      "Corrected source after reviewer feedback.",
    );
    await page.getByRole("button", { name: "Close review panel" }).click();

    await firstRow.click();
    await firstRow.getByRole("button", { name: "Open review panel" }).click();
    await page
      .getByLabel("Proposed target revision")
      .fill("保留期限为 45 天。");
    await page.getByRole("button", { name: "Create review proposal" }).click();
    await expect(page.getByText("pending", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(firstTarget).toHaveValue("保留期限为 45 天。");
    await expect(page.getByText("accepted", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close review panel" }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await firstRow.click();
    await firstRow.getByRole("button", { name: "Open review panel" }).click();
    await page.getByRole("button", { name: "signed", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "signed", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Close review panel" }).click();
    await expect(firstTarget).toBeDisabled();
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test("keeps a 10,000 segment document inside the virtual row and 60-second performance budget", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(150_000);
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "translunar-10k-"));
  const source = join(fixtureDirectory, "ten-thousand.txt");
  writeFileSync(
    source,
    Array.from(
      { length: 10_000 },
      (_, index) => `Segment ${String(index).padStart(5, "0")} benchmark text.`,
    ).join("\n\n"),
  );
  const harness = await launchHarness("virtual-10k", source);
  const { page, consoleErrors } = harness;

  try {
    await page.getByRole("button", { name: "Choose file" }).click();
    await expect(page.getByText("ten-thousand.txt")).toBeVisible();
    await page.getByRole("button", { name: "Create and import" }).click();
    await expect(
      page.getByRole("region", { name: "Translation segments" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".document-switcher")).toContainText(
      "10000 segments",
    );
    await expect
      .poll(() => page.locator(".segment-row").count())
      .toBeLessThanOrEqual(100);
    await expect
      .poll(() => page.locator(".segment-row").count())
      .toBeGreaterThan(0);

    await page.locator(".segment-grid").evaluate((element) => {
      element.scrollTop = 620_000;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect
      .poll(async () =>
        Number(await page.locator(".id-cell").first().textContent()),
      )
      .toBeGreaterThan(1_000);
    await expect
      .poll(() => page.locator(".segment-row").count())
      .toBeLessThanOrEqual(100);

    const performanceEvidence = await page.evaluate(async () => {
      const grid = document.querySelector<HTMLElement>(".segment-grid");
      if (!grid) throw new Error("Segment grid was not mounted.");
      const durationMs = 60_000;
      const frameDeltas: number[] = [];
      const heapSamples: number[] = [];
      let maxMountedRows = 0;
      let frame = 0;
      const startedAt = performance.now();
      let previousFrameAt = startedAt;
      const memory = () =>
        (
          performance as Performance & {
            memory?: { usedJSHeapSize: number };
          }
        ).memory?.usedJSHeapSize;

      return await new Promise<{
        durationMs: number;
        frameCount: number;
        frameP95Ms: number;
        frameMaxMs: number;
        maxMountedRows: number;
        heapSampleCount: number;
        baselineHeapBytes: number | null;
        peakHeapBytes: number | null;
        finalHeapBytes: number | null;
        peakHeapGrowthBytes: number | null;
        finalHeapGrowthBytes: number | null;
      }>((resolvePerformance) => {
        const sample = () => {
          maxMountedRows = Math.max(
            maxMountedRows,
            document.querySelectorAll(".segment-row").length,
          );
          const usedHeap = memory();
          if (usedHeap !== undefined) heapSamples.push(usedHeap);
        };
        sample();
        const tick = (now: number) => {
          frameDeltas.push(now - previousFrameAt);
          previousFrameAt = now;
          frame += 1;
          if (frame % 30 === 0) {
            const elapsedRatio = Math.min(1, (now - startedAt) / durationMs);
            const wave = (Math.sin(elapsedRatio * Math.PI * 12) + 1) / 2;
            grid.scrollTop = wave * (grid.scrollHeight - grid.clientHeight);
            grid.dispatchEvent(new Event("scroll", { bubbles: true }));
          }
          if (frame % 60 === 0) sample();
          if (now - startedAt < durationMs) {
            requestAnimationFrame(tick);
            return;
          }
          sample();
          const sortedFrames = [...frameDeltas].sort(
            (left, right) => left - right,
          );
          const p95Index = Math.max(
            0,
            Math.ceil(sortedFrames.length * 0.95) - 1,
          );
          const baselineHeap = heapSamples[0] ?? null;
          const peakHeap = heapSamples.length ? Math.max(...heapSamples) : null;
          const finalHeap = heapSamples.at(-1) ?? null;
          resolvePerformance({
            durationMs: now - startedAt,
            frameCount: frameDeltas.length,
            frameP95Ms: sortedFrames[p95Index] ?? 0,
            frameMaxMs: sortedFrames.at(-1) ?? 0,
            maxMountedRows,
            heapSampleCount: heapSamples.length,
            baselineHeapBytes: baselineHeap,
            peakHeapBytes: peakHeap,
            finalHeapBytes: finalHeap,
            peakHeapGrowthBytes:
              baselineHeap === null || peakHeap === null
                ? null
                : peakHeap - baselineHeap,
            finalHeapGrowthBytes:
              baselineHeap === null || finalHeap === null
                ? null
                : finalHeap - baselineHeap,
          });
        };
        requestAnimationFrame(tick);
      });
    });
    expect(performanceEvidence.durationMs).toBeGreaterThanOrEqual(60_000);
    expect(performanceEvidence.frameP95Ms).toBeLessThan(33);
    expect(performanceEvidence.maxMountedRows).toBeLessThanOrEqual(120);
    expect(performanceEvidence.heapSampleCount).toBeGreaterThan(0);
    expect(performanceEvidence.peakHeapGrowthBytes).not.toBeNull();
    expect(performanceEvidence.peakHeapGrowthBytes ?? Infinity).toBeLessThan(
      128 * 1024 * 1024,
    );
    expect(performanceEvidence.finalHeapGrowthBytes).not.toBeNull();
    expect(performanceEvidence.finalHeapGrowthBytes ?? Infinity).toBeLessThan(
      64 * 1024 * 1024,
    );
    await testInfo.attach("renderer-60-second-performance", {
      body: JSON.stringify(performanceEvidence, null, 2),
      contentType: "application/json",
    });

    await page.getByLabel("Search in document").fill("Segment 09999");
    await expect(page.locator(".segment-row")).toHaveCount(1);
    await expect(page.locator(".segment-row").first()).toContainText(
      "Segment 09999 benchmark text.",
    );
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeHarness(harness);
    await rm(fixtureDirectory, { recursive: true, force: true });
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
