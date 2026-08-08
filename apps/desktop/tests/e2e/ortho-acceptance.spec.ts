/**
 * ORTHO live acceptance: real Engine + Electron, screenshots + structural gates.
 * Run: pnpm build && pnpm exec playwright test tests/e2e/ortho-acceptance.spec.ts
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import type { DesktopApi } from "../../src/shared/desktop-api.js";
import { dismissFirstRunTutorial } from "./product-shell-helpers.js";

type ElectronApplication = Awaited<ReturnType<typeof electron.launch>>;

const WORKSPACE_ROOT = resolve(process.cwd(), "..", "..");
const EVIDENCE_DIR = join(
  WORKSPACE_ROOT,
  "docs",
  "design-ii",
  "reference",
  "impl-acceptance",
);

interface Harness {
  application: ElectronApplication;
  page: Page;
  dataDirectory: string;
  consoleErrors: string[];
}

function enginePath(): string {
  return (
    process.env.TRANSLUNAR_ENGINE_PATH ??
    join(
      WORKSPACE_ROOT,
      "target",
      "debug",
      process.platform === "win32"
        ? "translunar-engine.exe"
        : "translunar-engine",
    )
  );
}

async function launchHarness(label: string): Promise<Harness> {
  const dataDirectory = mkdtempSync(
    join(tmpdir(), `translunar-ortho-${label}-`),
  );
  const fixture = join(WORKSPACE_ROOT, "fixtures", "docx", "m0-source.docx");
  expect(existsSync(enginePath()), `engine missing: ${enginePath()}`).toBe(
    true,
  );
  expect(existsSync(fixture), `fixture missing: ${fixture}`).toBe(true);

  const consoleErrors: string[] = [];
  const application = await electron.launch({
    args: [
      "--no-sandbox",
      "--user-data-dir=" + join(dataDirectory, "electron-user-data"),
      ".",
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      TRANSLUNAR_DATA_DIR: dataDirectory,
      TRANSLUNAR_ENGINE_PATH: enginePath(),
      TRANSLUNAR_TEST_SOURCE: fixture,
      TRANSLUNAR_TEST_SOURCE_FILES: fixture,
      TRANSLUNAR_TEST_EXPORT_DOCX: join(dataDirectory, "out.docx"),
      TRANSLUNAR_TEST_EXPORT_DIRECTORY: dataDirectory,
      TRANSLUNAR_AI_TEST_MODE: "1",
      TRANSLUNAR_AI_TEST_CREDENTIAL: "desktop-ai-secret",
    },
  });
  const page = await application.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  await dismissFirstRunTutorial(page);
  await page.evaluate(async () => {
    const api = (window as unknown as { translunar: DesktopApi }).translunar;
    await api.updateShellSettings({ locale: "en-US" });
  });
  await page.reload();
  await dismissFirstRunTutorial(page);
  return { application, page, dataDirectory, consoleErrors };
}

async function closeHarness(harness: Harness): Promise<void> {
  try {
    await harness.application.close();
  } finally {
    await rm(harness.dataDirectory, { recursive: true, force: true });
  }
}

async function resize(
  application: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await application.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
    },
    { width, height },
  );
}

/** Same create path as workbench.spec.ts importFixture (test seams). */
async function importFixture(
  page: Page,
  expectedName = "m0-source.docx",
  timeout = 30_000,
): Promise<void> {
  await dismissFirstRunTutorial(page);
  await expect(
    page.getByRole("heading", {
      name: /Continue translating|继续翻译/i,
    }),
  ).toBeVisible({ timeout });
  await page
    .getByRole("button", { name: /New project|新建项目/i })
    .first()
    .click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Add files" }).click();
  await expect(page.getByText(expectedName, { exact: true })).toBeVisible({
    timeout,
  });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page
      .getByRole("region", { name: /Translation segments|翻译段落|segments/i })
      .or(page.locator(".segment-grid, .doc-matrix, .masthead"))
      .first(),
  ).toBeVisible({ timeout });
}

async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

test.describe("ORTHO live acceptance", () => {
  test.setTimeout(180_000);

  test("engine binary is present", () => {
    expect(existsSync(enginePath())).toBe(true);
  });

  test("boots shell, surfaces, theme, and workbench chrome with screenshots", async () => {
    const harness = await launchHarness("boot");
    const { application, page, consoleErrors } = harness;
    const report: {
      engine: string;
      shots: string[];
      checks: Record<string, boolean | string | number | string[]>;
    } = {
      engine: enginePath(),
      shots: [],
      checks: {},
    };

    try {
      await resize(application, 1440, 900);
      await page.waitForTimeout(500);

      // Home / shell
      report.checks.bandSpine =
        (await page.locator(".band-spine").count()) === 1;
      report.checks.indexSpine = (await page.locator(".index-spine, [data-spine]").count()) >= 1 ||
        (await page.locator(".shell").count()) >= 1;
      (report.shots as string[]).push(await shot(page, "01-home-or-shell"));

      // Theme: single data-theme source
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      report.checks.noThemeDarkClass =
        (await page.locator(".workbench-app.theme-dark, .theme-dark").count()) === 0;
      (report.shots as string[]).push(await shot(page, "02-theme-dark-home"));

      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
      });

      // Navigate surfaces via Index Spine / keyboard if available
      for (const [key, label] of [
        ["Control+1", "home"],
        ["Control+2", "workbench"],
        ["Control+3", "assets"],
        ["Control+4", "qa"],
        ["Control+5", "ai"],
        ["Control+6", "export"],
      ] as const) {
        await page.keyboard.press(key);
        await page.waitForTimeout(350);
        (report.shots as string[]).push(
          await shot(page, `03-surface-${label}`),
        );
      }

      // Command palette
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(300);
      const paletteVisible =
        (await page.locator(".cmdk, [data-cmdk], .command-palette, [role=dialog]").count()) > 0;
      report.checks.commandPalette = paletteVisible;
      (report.shots as string[]).push(await shot(page, "04-command-palette"));
      await page.keyboard.press("Escape");

      // Create project + import fixture into workbench
      await importFixture(page);
      await page.waitForTimeout(800);

      const hasMasthead = (await page.locator(".masthead").count()) > 0;
      const hasFilter = (await page.locator(".filter, .filter-rail, [class*=FilterRail]").count()) > 0
        || (await page.locator(".filter-group, [role=group][aria-label*=filter i]").count()) > 0;
      const hasMatrix = (await page.locator(".doc-matrix").count()) > 0;
      const hasGrid =
        (await page.locator(".segment-grid, [role=grid], .segment-row, textarea").count()) > 0;
      const hasStack =
        (await page.locator(".stack-panel, .suggestions-panel, .stack").count()) > 0;

      report.checks.masthead = hasMasthead;
      report.checks.filterRail = hasFilter;
      report.checks.documentMatrix = hasMatrix;
      report.checks.segmentGrid = hasGrid;
      report.checks.stack = hasStack;
      report.checks.axisCount = await page.locator('[data-axis="active"]').count();

      await resize(application, 1250, 744);
      await page.waitForTimeout(200);
      (report.shots as string[]).push(await shot(page, "05-workbench-1250x744"));

      await resize(application, 1680, 942);
      await page.waitForTimeout(200);
      (report.shots as string[]).push(await shot(page, "06-workbench-1680x942"));

      await resize(application, 1920, 1080);
      await page.waitForTimeout(200);
      (report.shots as string[]).push(await shot(page, "07-workbench-1920x1080"));

      // Density × scale matrix (3×3 standard cells)
      const densities = ["compact", "standard", "comfortable"] as const;
      const scales = [1, 1.25, 1.6] as const;
      for (const density of densities) {
        for (const scale of scales) {
          await page.evaluate(
            ({ d, s }) => {
              const root = document.documentElement;
              if (d === "standard") {
                delete root.dataset.density;
              } else {
                root.dataset.density = d;
              }
              root.style.setProperty("--ui-scale", String(s));
            },
            { d: density, s: scale },
          );
          await page.waitForTimeout(150);
          (report.shots as string[]).push(
            await shot(page, `08-density-${density}-scale-${String(scale).replace(".", "_")}`),
          );
        }
      }

      // Dark workbench
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        delete document.documentElement.dataset.density;
        document.documentElement.style.setProperty("--ui-scale", "1");
      });
      await page.waitForTimeout(200);
      (report.shots as string[]).push(await shot(page, "09-workbench-dark"));

      // axe on shell (soft: record, don't fail whole suite on contrast-only)
      try {
        const axe = await new AxeBuilder({ page })
          .setLegacyMode(true)
          .disableRules(["color-contrast"])
          .analyze();
        const serious = axe.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        report.checks.axeSerious = serious.length;
        report.checks.axeViolations = serious.map((v) => v.id);
      } catch (error) {
        report.checks.axeError = String(error);
      }

      // Structural asserts (hard)
      expect(report.checks.bandSpine, "exactly one .band-spine").toBe(true);
      expect(
        report.checks.noThemeDarkClass,
        "no .theme-dark dual-track class",
      ).toBe(true);
      // Axis: 0 or 1 only
      expect(
        Number(report.checks.axisCount ?? 0),
        "[data-axis=active] ≤ 1",
      ).toBeLessThanOrEqual(1);

      // Soft console: filter known noise
      const hardErrors = consoleErrors.filter(
        (line) =>
          !/DevTools|Autofill|Download the React DevTools/i.test(line),
      );
      report.checks.consoleErrors = hardErrors;
      expect(hardErrors, `console errors: ${hardErrors.join("\n")}`).toEqual(
        [],
      );

      writeFileSync(
        join(EVIDENCE_DIR, "acceptance-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );
    } finally {
      await closeHarness(harness);
    }
  });
});
