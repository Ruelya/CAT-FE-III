import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

import { expectNoAxeViolations } from "./helpers/ui-checks.js";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron") as string;
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

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `${label}: horizontal overflow ${overflow.scrollWidth}>${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function seedWorkbench(page: Page): Promise<void> {
  await expect(page.getByTestId("welcome")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("create-project")).toBeVisible();
  await page.getByLabel("Name").fill("P2 Editor Assets");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("import-document")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Choose files" }).click();
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 60_000 });
  const target = page.locator('[data-testid^="target-editor-"]').first();
  await expect(target).toBeVisible();
  await target.fill("P2 seeded target for editor and assets.");
  await page.getByRole("button", { name: /^Confirm segment / }).click();
  await expect(page.locator(".status-chip--confirmed").first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("P2 editor + assets", () => {
  test("editor commands, find, assets sections against real Engine", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p2-"));
    let app: ElectronApplication | undefined;
    let page: Page;
    let consoleGuard: ReturnType<typeof attachConsoleGuard> | undefined;

    try {
      ({ app, page } = await launchApp({
        userData,
        sourcePath: sourceFixture,
      }));
      consoleGuard = attachConsoleGuard(page);

      await seedWorkbench(page);
      await expect(page.getByTestId("editor-command-bar")).toBeVisible();
      await expectNoAxeViolations(page, "workbench-p2");
      await expectNoHorizontalOverflow(page, "workbench-p2");

      // Primary commands + overflow menu (not a flat always-visible overflow group).
      await expect(page.getByTestId("cmd-editor.findReplace")).toBeVisible();
      await page.getByTestId("cmd-overflow").click();
      await expect(page.getByTestId("cmd-overflow-menu")).toBeVisible();
      await page.getByTestId("cmd-editor.history").click();
      await expect(page.getByTestId("panel-history")).toBeVisible({
        timeout: 15_000,
      });
      // After history open, command bar must not stick in Working.
      await expect(page.getByText("Working")).toHaveCount(0);

      await page.getByTestId("cmd-editor.findReplace").click();
      await expect(page.getByTestId("panel-find-replace")).toBeVisible();
      await page.getByTestId("find-query").fill("P2");
      await page.getByTestId("find-run").click();
      await expect(page.getByTestId("find-matches")).toBeVisible({
        timeout: 15_000,
      });

      // Comments path (create).
      await page.getByTestId("cmd-editor.comments").click();
      await expect(page.getByTestId("panel-comments")).toBeVisible();
      await page.getByTestId("comment-text").fill("P2 comment");
      await page.getByTestId("comment-create").click();
      await expect(page.getByText("P2 comment")).toBeVisible({
        timeout: 15_000,
      });

      // Assets hub: enter from workbench, walk sections, return.
      await page.getByTestId("nav-assets").click();
      await expect(page.getByTestId("asset-hub")).toBeVisible({
        timeout: 30_000,
      });
      // Dead chrome must not appear on Assets.
      await expect(
        page.getByTestId("app-shell").getByRole("button", { name: "QA" }),
      ).toHaveCount(0);
      await expect(
        page.getByTestId("app-shell").getByRole("button", { name: "Export" }),
      ).toHaveCount(0);
      await expect(
        page.getByTestId("app-shell").getByRole("button", { name: "Insights" }),
      ).toHaveCount(0);
      await expectNoAxeViolations(page, "assets");
      await expectNoHorizontalOverflow(page, "assets");

      for (const tab of [
        "tm",
        "termbase",
        "alignment",
        "corpus",
        "catalog",
        "curation",
      ] as const) {
        await page.getByTestId(`assets-tab-${tab}`).click();
        await expect(page.getByTestId(`assets-${tab}`)).toBeVisible();
      }

      // Non-import TM path: create library.
      await page.getByTestId("assets-tab-tm").click();
      await page.getByTestId("tm-create-name").fill("P2 TM");
      await page.getByTestId("tm-create").click();
      await expect(page.getByText("P2 TM")).toBeVisible({ timeout: 30_000 });

      // Catalog filters surface present.
      await page.getByTestId("assets-tab-catalog").click();
      await expect(page.getByTestId("catalog-source-locale")).toBeVisible();
      await expect(page.getByTestId("catalog-domain")).toBeVisible();
      await page.getByTestId("catalog-search").click();

      // Curation policy form present (not hidden defaults only).
      await page.getByTestId("assets-tab-curation").click();
      await expect(page.getByTestId("curation-policy")).toBeVisible();
      await expect(
        page.getByTestId("curation-policy-minimumChars"),
      ).toBeVisible();

      await page.getByTestId("assets-back").click();
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 30_000,
      });

      expect(consoleGuard.errors, consoleGuard.errors.join("\n")).toEqual([]);
    } finally {
      consoleGuard?.dispose();
      if (app) await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
});
