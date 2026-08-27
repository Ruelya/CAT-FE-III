// Captures one workbench screenshot per theme, plus phosphor with its
// signature effect switched off. Not an assertion suite — this is the review
// vehicle for the gallery in /opt/cursor/artifacts/themes.
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";

import { THEMES } from "@translunar/ui";

const appRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(appRoot, "../..");
const fixture = join(repoRoot, "fixtures", "docx", "m0-source.docx");
const shotsDir = join(appRoot, "test-results", "gallery");

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const workDir = mkdtempSync(join(tmpdir(), "tl-gallery-"));
  mkdirSync(shotsDir, { recursive: true });
  app = await electron.launch({
    args: [".", `--user-data-dir=${join(workDir, "user-data")}`],
    cwd: appRoot,
    env: {
      ...process.env,
      TL_DATA_DIR: join(workDir, "engine-data"),
      TL_ENGINE_BIN: join(repoRoot, "target", "debug", "tl-engine"),
      TL_FAKE_OPEN_PATH: fixture,
      TL_FAKE_SAVE_PATH: join(workDir, "translated.docx"),
    },
  });
  page = await app.firstWindow();
  await expect(page.locator(".app-statusbar__engine")).toContainText("pid", {
    timeout: 30_000,
  });
});

test.afterAll(async () => {
  await app.close();
});

test("gallery", async () => {
  test.setTimeout(300_000);
  await page.getByLabel("项目名称").fill("主题总览");
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const importDialog = page.getByRole("dialog");
  await importDialog.getByRole("button", { name: "选择文件…" }).click();
  await importDialog.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("tab", { name: "m0-source.docx" })).toBeVisible({
    timeout: 30_000,
  });

  // Put real work on screen: a confirmed row, a draft, and the preview open.
  const rows = page.locator(".segment-grid tbody tr");
  await rows.first().click();
  const editor = page.locator(".segment-grid textarea").first();
  await editor.fill("保留期为 30 天。");
  await page.keyboard.press("Control+Enter");
  await rows.nth(1).click();
  await page
    .locator(".segment-grid textarea")
    .first()
    .fill("表中金额：1,300。");
  const expand = page.locator(".preview-pane__toggle");
  if ((await expand.getAttribute("aria-expanded")) !== "true") {
    await expand.click();
  }

  const open = async () => {
    if ((await page.locator(".theme-picker").count()) === 0) {
      await page.locator(".app-statusbar__jump", { hasText: "主题" }).click();
    }
  };
  const close = async () => {
    const dismiss = page.getByRole("button", { name: "关闭对话框" });
    if ((await dismiss.count()) > 0) {
      await dismiss.first().click();
    }
    await expect(page.locator(".theme-picker")).toHaveCount(0);
  };

  for (const theme of THEMES) {
    await open();
    await page.locator(`[data-theme-preview="${theme.id}"]`).click();
    await close();
    // Let the entrance motion and any drifting field settle.
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => {
      const el = document.querySelector(".fx-layer--ambient");
      const cs = el ? getComputedStyle(el) : null;
      return {
        ambient: document.documentElement.getAttribute("data-fx-ambient"),
        display: cs?.display,
        z: cs?.zIndex,
      };
    });
    console.log(theme.id, JSON.stringify(state));
    await page.screenshot({ path: join(shotsDir, `${theme.id}.png`) });
  }

  // The picker itself, and phosphor stripped of its signature effect.
  await open();
  await page.locator('[data-theme-preview="phosphor"]').click();
  await page.screenshot({ path: join(shotsDir, "_picker.png") });
  await page.getByRole("checkbox", { name: "扫描线" }).uncheck();
  await page.getByRole("checkbox", { name: "颗粒" }).uncheck();
  await page.getByRole("checkbox", { name: "环境光" }).uncheck();
  await close();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shotsDir, "_phosphor-fx-off.png") });
});
