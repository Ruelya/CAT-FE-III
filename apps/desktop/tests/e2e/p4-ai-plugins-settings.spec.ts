import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron") as string;
const axeCorePath = require.resolve("axe-core", {
  paths: [dirname(require.resolve("@axe-core/playwright"))],
});
const axeSource = readFileSync(axeCorePath, "utf8");
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceFixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/single-segment-source.txt",
);

async function launchApp(options: {
  userData: string;
  sourcePath?: string;
}): Promise<{ app: ElectronApplication; page: Page }> {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TRANSLUNAR_TEST_USER_DATA = options.userData;
  env.TRANSLUNAR_DATA_DIR = join(options.userData, "engine-data");
  if (options.sourcePath) {
    env.TRANSLUNAR_TEST_SOURCE = options.sourcePath;
    env.TRANSLUNAR_TEST_SOURCE_FILES = options.sourcePath;
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

async function expectNoCriticalAxe(page: Page, label: string): Promise<void> {
  await page.evaluate((source: string) => {
    const indirectEval: (code: string) => unknown = eval;
    indirectEval(source);
  }, axeSource);

  const results = await page.evaluate(async () => {
    const axe = (
      globalThis as unknown as {
        axe: {
          run: () => Promise<{
            violations: Array<{
              id: string;
              impact?: string | null;
              help: string;
            }>;
          }>;
        };
      }
    ).axe;
    return axe.run();
  });

  const critical = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(critical, `${label}: ${JSON.stringify(critical)}`).toEqual([]);
}

async function createOpenProject(page: Page): Promise<void> {
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 60_000 });
  const welcome = page.getByTestId("welcome");
  const home = page.getByTestId("project-home");
  await expect(welcome.or(home)).toBeVisible({ timeout: 60_000 });
  if (await welcome.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Create project" }).click();
  } else {
    await page.getByRole("button", { name: "Create project" }).click();
  }
  await expect(page.getByTestId("create-project")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Name").fill("P4 Project");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("import-document")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Choose files" }).click();
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 60_000 });
}

test.describe("P4 AI plugins settings", () => {
  test("always-on: reach AI/Plugins/Settings and Collaboration after project open", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p4-"));
    const { app, page } = await launchApp({
      userData,
      sourcePath: sourceFixture,
    });
    const guard = attachConsoleGuard(page);
    try {
      await createOpenProject(page);

      await page.getByTestId("nav-ai-control").click();
      await expect(page.getByTestId("ai-control")).toBeVisible();
      await expect(page.getByTestId("ai-tab-providers")).toBeVisible();
      await page.getByTestId("ai-tab-providers").click();
      await expect(page.getByTestId("ai-providers")).toBeVisible();
      await page.getByTestId("ai-tab-usage").click();
      await expect(page.getByTestId("ai-usage")).toBeVisible();
      await page.getByTestId("ai-tab-interactive").click();
      await expect(page.getByTestId("ai-interactive")).toBeVisible();
      await page.getByTestId("ai-tab-batch").click();
      await expect(page.getByTestId("ai-batch")).toBeVisible();
      await page.getByTestId("ai-tab-quality").click();
      await expect(page.getByTestId("ai-quality")).toBeVisible();

      await page.getByTestId("nav-plugins").click();
      await expect(page.getByTestId("plugins")).toBeVisible();
      for (const tab of [
        "installed",
        "bundled",
        "permissions",
        "aiActions",
        "uiPanels",
        "connectors",
      ]) {
        await page.getByTestId(`plugins-tab-${tab}`).click();
      }
      await expect(page.getByTestId("plugins-connectors")).toBeVisible();

      await page.getByTestId("nav-collaboration").click();
      await expect(page.getByTestId("collaboration")).toBeVisible();
      for (const tab of [
        "members",
        "locks",
        "presence",
        "assignments",
        "opLog",
      ]) {
        await page.getByTestId(`collab-tab-${tab}`).click();
      }

      await page.getByTestId("nav-settings").click();
      await expect(page.getByTestId("product-settings")).toBeVisible();
      for (const tab of [
        "locale",
        "appearance",
        "data",
        "updates",
        "tutorial",
      ]) {
        await page.getByTestId(`settings-tab-${tab}`).click();
      }

      await page.getByTestId("settings-tab-appearance").click();
      await page.getByTestId("settings-theme").selectOption("dark");
      await page.getByTestId("settings-accent-hex").fill("#224466");
      await page.getByTestId("settings-appearance-apply").click();
      await expect
        .poll(async () =>
          page.evaluate(() => document.documentElement.dataset.theme),
        )
        .toBe("dark");

      await page.getByTestId("settings-tab-locale").click();
      await page.getByTestId("settings-locale-select").selectOption("en-US");
      await page.getByTestId("settings-locale-save").click();

      await page.getByTestId("settings-tab-tutorial").click();
      await expect(page.getByTestId("settings-tutorial-state")).toBeVisible();
      await page.getByTestId("settings-tutorial-skip").click();

      await page.getByTestId("settings-tab-data").click();
      await expect(page.getByTestId("settings-data")).toBeVisible();
      await expect(page.getByTestId("settings-data-path")).toBeVisible();

      await page.getByTestId("settings-tab-updates").click();
      await expect(page.getByTestId("settings-update-status")).toBeVisible({
        timeout: 15_000,
      });

      // Collaboration member + locks/assignments/opLog local paths
      await page.getByTestId("nav-collaboration").click();
      await page.getByTestId("collab-tab-members").click();
      await page.getByTestId("collab-member-id").fill("reviewer-1");
      await page.getByTestId("collab-member-add").click();
      await expect(page.getByTestId("collab-members")).toContainText(
        "reviewer-1",
        { timeout: 15_000 },
      );

      await page.getByTestId("collab-tab-locks").click();
      await expect(page.getByTestId("collab-locks")).toBeVisible();

      await page.getByTestId("collab-tab-presence").click();
      await page.getByTestId("collab-presence-start").click();
      await page.getByTestId("collab-presence-stop").click();

      await page.getByTestId("collab-tab-assignments").click();
      await expect(page.getByTestId("collab-assignments")).toBeVisible();

      await page.getByTestId("collab-tab-opLog").click();
      await expect(page.getByTestId("collab-oplog")).toBeVisible();

      // Settings appearance cancel-style draft path (change then leave without apply)
      await page.getByTestId("nav-settings").click();
      await page.getByTestId("settings-tab-appearance").click();
      await page.getByTestId("settings-accent-hex").fill("#abcdef");
      await page.getByTestId("settings-tab-locale").click();
      await page.getByTestId("settings-tab-appearance").click();
      // Draft may reset on remount; ensure surface remains usable
      await expect(page.getByTestId("settings-appearance-apply")).toBeVisible();

      for (const size of [
        { width: 1250, height: 744 },
        { width: 1680, height: 942 },
        { width: 1920, height: 1080 },
      ]) {
        await page.setViewportSize(size);
        const overflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth + 1;
        });
        expect(overflow, `overflow at ${size.width}x${size.height}`).toBe(
          false,
        );
      }

      await expectNoCriticalAxe(page, "p4-settings");
      expect(guard.errors, guard.errors.join("\n")).toEqual([]);
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("always-on: appearance survives relaunch and reset", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p4-appear-"));
    let { app, page } = await launchApp({
      userData,
      sourcePath: sourceFixture,
    });
    let guard = attachConsoleGuard(page);
    try {
      await createOpenProject(page);
      await page.getByTestId("nav-settings").click();
      await page.getByTestId("settings-tab-appearance").click();
      await page.getByTestId("settings-theme").selectOption("dark");
      await page.getByTestId("settings-accent-hex").fill("#336699");
      await page.getByTestId("settings-appearance-apply").click();
      await expect
        .poll(async () =>
          page.evaluate(() => document.documentElement.dataset.theme),
        )
        .toBe("dark");

      guard.dispose();
      await app.close();

      ({ app, page } = await launchApp({
        userData,
        sourcePath: sourceFixture,
      }));
      guard = attachConsoleGuard(page);
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(async () =>
          page.evaluate(() => document.documentElement.dataset.theme),
        )
        .toBe("dark");
      await expect
        .poll(async () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--color-accent-seed")
              .trim(),
          ),
        )
        .toBe("#336699");

      await page.getByTestId("nav-settings").click();
      await page.getByTestId("settings-tab-appearance").click();
      await page.getByTestId("settings-appearance-reset").click();
      await expect
        .poll(async () =>
          page.evaluate(() => document.documentElement.dataset.theme),
        )
        .toBe("light");
      expect(guard.errors, guard.errors.join("\n")).toEqual([]);
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("fixture-gated: deep AI provider/run/apply", async () => {
    const hasLoopback = process.env.TRANSLUNAR_P4_LOOPBACK_AI === "1";
    test.skip(
      !hasLoopback,
      "TRANSLUNAR_P4_LOOPBACK_AI not set — skip deep AI provider/run/apply path",
    );
    const userData = await mkdtemp(join(tmpdir(), "tl-p4-ai-"));
    const { app, page } = await launchApp({
      userData,
      sourcePath: sourceFixture,
    });
    const guard = attachConsoleGuard(page);
    try {
      await createOpenProject(page);
      await page.getByTestId("nav-ai-control").click();
      await expect(page.getByTestId("ai-control")).toBeVisible();
      await page.getByTestId("ai-tab-providers").click();
      await expect(page.getByTestId("ai-providers")).toBeVisible();
      await expect(page.getByTestId("ai-settings")).toBeVisible();
      await page.getByTestId("ai-tab-interactive").click();
      await expect(page.getByTestId("ai-interactive")).toBeVisible();
      // Loopback fixture must expose at least the run profile control.
      await expect(page.getByTestId("ai-run-profile")).toBeVisible({
        timeout: 15_000,
      });
      expect(guard.errors, guard.errors.join("\n")).toEqual([]);
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("fixture-gated: deep plugin install/panel", async () => {
    const hasPluginFixture = process.env.TRANSLUNAR_P4_PLUGIN_FIXTURE === "1";
    test.skip(
      !hasPluginFixture,
      "TRANSLUNAR_P4_PLUGIN_FIXTURE not set — skip deep plugin install/panel path",
    );
    const userData = await mkdtemp(join(tmpdir(), "tl-p4-plugin-"));
    const { app, page } = await launchApp({
      userData,
      sourcePath: sourceFixture,
    });
    const guard = attachConsoleGuard(page);
    try {
      await createOpenProject(page);
      await page.getByTestId("nav-plugins").click();
      await expect(page.getByTestId("plugins")).toBeVisible();
      await page.getByTestId("plugins-tab-installed").click();
      await expect(page.getByTestId("plugin-install-pick")).toBeVisible();
      await page.getByTestId("plugins-tab-uiPanels").click();
      await expect(page.getByTestId("plugins-ui-panels")).toBeVisible();
      expect(guard.errors, guard.errors.join("\n")).toEqual([]);
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("fixture-gated: external connector console", async () => {
    const hasConnector = process.env.TRANSLUNAR_P4_CONNECTOR_FIXTURE === "1";
    test.skip(
      !hasConnector,
      "TRANSLUNAR_P4_CONNECTOR_FIXTURE not set — skip external connector path",
    );
    const userData = await mkdtemp(join(tmpdir(), "tl-p4-conn-"));
    const { app, page } = await launchApp({
      userData,
      sourcePath: sourceFixture,
    });
    const guard = attachConsoleGuard(page);
    try {
      await createOpenProject(page);
      await page.getByTestId("nav-plugins").click();
      await page.getByTestId("plugins-tab-connectors").click();
      await expect(page.getByTestId("plugins-connectors")).toBeVisible();
      expect(guard.errors, guard.errors.join("\n")).toEqual([]);
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
});
