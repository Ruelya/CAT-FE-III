import { createRequire } from "node:module";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

import { expectNoAxeViolations } from "./helpers/ui-checks.js";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron") as string;
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
/** Deterministic single-segment source so the real Engine gate can clear. */
const sourceFixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/single-segment-source.txt",
);

async function launchApp(options: {
  userData: string;
  sourcePath?: string;
  exportPath?: string;
}): Promise<{ app: ElectronApplication; page: Page }> {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TRANSLUNAR_TEST_USER_DATA = options.userData;
  env.TRANSLUNAR_DATA_DIR = join(options.userData, "engine-data");
  if (options.sourcePath) {
    env.TRANSLUNAR_TEST_SOURCE = options.sourcePath;
    // P1 import uses multi-select; keep single-file P0 path as a one-item batch.
    env.TRANSLUNAR_TEST_SOURCE_FILES = options.sourcePath;
  }
  if (options.exportPath) {
    env.TRANSLUNAR_TEST_EXPORT_DOCX = options.exportPath;
  }

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ["."],
    cwd: desktopRoot,
    env,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

function attachConsoleGuard(page: Page): {
  errors: string[];
  dispose: () => void;
} {
  const errors: string[] = [];
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  };
  const onPageError = (err: Error) => {
    errors.push(err.message);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    errors,
    dispose: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

test.describe("P0 vertical slice", () => {
  test("welcome → create → import → edit/confirm → QA → export → resume", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p0-"));
    const exportPath = join(userData, "export-out.txt");
    let app: ElectronApplication | undefined;
    let page: Page;
    let consoleGuard: ReturnType<typeof attachConsoleGuard> | undefined;

    try {
      ({ app, page } = await launchApp({
        userData,
        sourcePath: sourceFixture,
        exportPath,
      }));
      consoleGuard = attachConsoleGuard(page);

      await expect(page.getByTestId("welcome")).toBeVisible({
        timeout: 60_000,
      });
      await expectNoAxeViolations(page, "welcome");

      await page.getByRole("button", { name: "Create project" }).click();
      await expect(page.getByTestId("create-project")).toBeVisible();

      await page.getByLabel("Name").fill("P0 Demo");
      await page.getByRole("button", { name: "Create" }).click();

      await expect(page.getByTestId("import-document")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Choose files" }).click();

      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 60_000,
      });
      await expectNoAxeViolations(page, "workbench");

      // Segment intelligence dock: both docks are reachable, both report on
      // the current segment, and collapse/expand keeps the body mounted so a
      // screen reader is not handed a panel that vanishes.
      const dock = page.getByTestId("intel-dock");
      await expect(dock).toBeVisible();
      await expect(dock.getByRole("tab", { name: /Matches/ })).toBeVisible();
      await expect(dock.getByRole("tab", { name: /Terms/ })).toBeVisible();
      await dock.getByRole("tab", { name: /Terms/ }).click();
      await expect(page.getByTestId("no-terms")).toBeVisible();
      await dock.getByRole("tab", { name: /Matches/ }).click();
      await expect(page.getByTestId("no-matches")).toBeVisible();

      const collapseDock = page.getByRole("button", {
        name: /Collapse segment intelligence/i,
      });
      if (await collapseDock.isVisible().catch(() => false)) {
        await collapseDock.click();
        await expect(
          page.getByRole("button", { name: /Expand segment intelligence/i }),
        ).toBeVisible();
        await expect(dock.locator(".intel-dock__body")).toHaveCount(1);
        await page
          .getByRole("button", { name: /Expand segment intelligence/i })
          .click();
      }

      // Confirm every imported segment with a non-empty target so QA gate is Clear.
      // Avoid digits (qa.number-mismatch is an error blocker) and empty targets.
      // Multi-segment fixtures must not leave empty-target blockers (Blocked ≠ success).
      const safeTargets = [
        "欢迎使用 Translunar CAT 离线垂直切片示例。",
        "本示例在本机完成导入编辑确认质检与导出。",
        "翻译记忆与术语库均保留在本地设备。",
      ];
      for (let i = 0; i < 20; i += 1) {
        const target = page.locator('[data-testid^="target-editor-"]').first();
        await expect(target).toBeVisible();
        const beforeConfirmed = await page
          .locator(".status-chip--confirmed")
          .count();
        await target.fill(safeTargets[i % safeTargets.length]!);
        await page.getByRole("button", { name: /^Confirm segment / }).click();
        await expect(page.locator(".status-chip--confirmed")).toHaveCount(
          beforeConfirmed + 1,
          { timeout: 30_000 },
        );
        // Stop when all rows show confirmed chips.
        const confirmed = await page.locator(".status-chip--confirmed").count();
        const activateCount = await page
          .locator('[data-testid^="segment-activate-"]')
          .count();
        // activate controls exist only for inactive rows; +1 active ≈ total segments.
        const totalSegments = activateCount + 1;
        if (confirmed >= totalSegments) break;
      }

      // Authoritative confirmed state must appear in Engine-rendered UI.
      await expect(page.locator(".status-chip--confirmed").first()).toBeVisible(
        { timeout: 30_000 },
      );

      await page.getByTestId("workbench-qa").click();
      await expect(page.getByTestId("qa-review")).toBeVisible();
      // Wait for authoritative list (loading → empty or issues), not invented empty.
      await expect(
        page.getByText(/No issues|error|warning|#/i).first(),
      ).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Run QA" }).click();
      await expect(
        page.getByText(/No issues|error|warning|#/i).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expectNoAxeViolations(page, "qa");

      await page
        .getByTestId("qa-review")
        .getByRole("button", { name: "Export" })
        .click();
      await expect(page.getByTestId("export-review")).toBeVisible();
      await page
        .getByTestId("export-review")
        .getByRole("button", { name: "Export" })
        .click();

      // Deterministic pass: require clear gate + export result + real file.
      // Blocked is NOT accepted as success for this fixture path.
      await expect(page.getByTestId("export-result")).toBeVisible({
        timeout: 45_000,
      });
      await expect(page.getByText(/Blocked/i)).toHaveCount(0);
      await access(exportPath);
      await expectNoAxeViolations(page, "export");

      expect(
        consoleGuard.errors,
        `renderer/page console errors: ${consoleGuard.errors.join("\n")}`,
      ).toEqual([]);

      await app.close();
      app = undefined;

      ({ app, page } = await launchApp({
        userData,
        sourcePath: sourceFixture,
        exportPath,
      }));
      const resumeGuard = attachConsoleGuard(page);
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId("app-shell")).toContainText("P0 Demo");
      expect(
        resumeGuard.errors,
        `resume console errors: ${resumeGuard.errors.join("\n")}`,
      ).toEqual([]);
      resumeGuard.dispose();
    } finally {
      consoleGuard?.dispose();
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });

  test("project home Open resumes an existing project", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p0-home-"));
    let app: ElectronApplication | undefined;
    let page: Page;

    try {
      ({ app, page } = await launchApp({
        userData,
        sourcePath: sourceFixture,
      }));
      await expect(page.getByTestId("welcome")).toBeVisible({
        timeout: 60_000,
      });
      await page.getByRole("button", { name: "Create project" }).click();
      await page.getByLabel("Name").fill("Listed");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByTestId("import-document")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Choose files" }).click();
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 60_000,
      });

      await page.evaluate(() => {
        localStorage.removeItem("translunar.renderer.session.v1");
      });
      await app.close();
      app = undefined;

      ({ app, page } = await launchApp({ userData }));
      await expect(page.getByTestId("project-home")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByText("Listed")).toBeVisible();
      await expectNoAxeViolations(page, "project-home");

      // Scope to the listed project row so "Open" does not collide with "Open example".
      await page
        .locator(".project-row")
        .filter({ hasText: "Listed" })
        .getByRole("button", { name: "Open", exact: true })
        .click();
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId("app-shell")).toContainText("Listed");
    } finally {
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });
});
