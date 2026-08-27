// Theme system through the real app: terra is what a first launch gets, the
// choice survives a restart, every theme repaints the real surfaces, and an
// effect the reader switched off stays off.
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";

const appRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(appRoot, "../..");
const fixture = join(repoRoot, "fixtures", "docx", "m0-source.docx");
const shotsDir = join(appRoot, "test-results", "themes");

let app: ElectronApplication;
let page: Page;
let workDir: string;

async function launch(): Promise<void> {
  app = await electron.launch({
    /* A private profile per suite run: the theme lives in renderer
       localStorage, so a shared userData dir would make "first launch" mean
       "whatever the last run picked". */
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
}

test.beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "tl-themes-e2e-"));
  mkdirSync(shotsDir, { recursive: true });
  await launch();
});

test.afterAll(async () => {
  await app.close();
});

async function themeAttr(): Promise<string | null> {
  return page.evaluate(() => document.documentElement.dataset["theme"] ?? null);
}

async function fxAttr(key: string): Promise<string | null> {
  return page.evaluate(
    (name) => document.documentElement.getAttribute(`data-fx-${name}`),
    key,
  );
}

test("a first launch is terra", async () => {
  expect(await themeAttr()).toBe("terra");
  // terra ships no cinematic effect, so nothing is on out of the box.
  expect(await fxAttr("scanlines")).toBe("off");
  expect(await fxAttr("grain")).toBe("off");
  expect(await fxAttr("ambient")).toBe("off");
});

test("the workbench renders and the theme repaints its real surfaces", async () => {
  await page.getByLabel("项目名称").fill("主题演示");
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByRole("toolbar", { name: "工具栏" })).toBeVisible();

  await page.getByRole("button", { name: "导入", exact: true }).click();
  const importDialog = page.getByRole("dialog");
  await importDialog.getByRole("button", { name: "选择文件…" }).click();
  await importDialog.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("tab", { name: "m0-source.docx" })).toBeVisible({
    timeout: 30_000,
  });

  // The ribbon groups its stacked buttons under captions, as the studies do.
  const captions = await page.locator(".ribbon__group-label").allTextContents();
  expect(captions.length).toBeGreaterThan(1);
  expect(captions).toContain("文档");

  // Proofreading state is a filled chip, never an underline.
  const expand = page.locator(".preview-pane__toggle");
  if ((await expand.getAttribute("aria-expanded")) !== "true") {
    await expand.click();
  }
  const segment = page.locator(".preview__segment").first();
  await expect(segment).toBeVisible();
  const chip = await segment.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      underline: style.textDecorationLine,
      display: style.display,
    };
  });
  expect(chip.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(chip.underline).toBe("none");

  // The explorer is a tree, not a flat list, and a lone document imported
  // from one path has no structure to indent for.
  const tree = page.locator('.document-list[role="tree"]');
  await expect(tree).toBeVisible();
  await expect(tree.locator('[role="treeitem"]')).toHaveCount(1);

  await page.screenshot({ path: join(shotsDir, "terra.png") });
});

test("every theme paints a distinct workbench", async () => {
  // The picker is behind the status-bar control.
  await page.locator(".app-statusbar__jump", { hasText: "主题" }).click();
  const themes = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-theme-preview]")).map(
      (node) => (node as HTMLElement).dataset["themePreview"]!,
    ),
  );
  expect(themes.length).toBe(16);

  const seen = new Set<string>();
  for (const id of themes) {
    await page.locator(`[data-theme-preview="${id}"]`).click();
    expect(await themeAttr()).toBe(id);
    // The chrome actually repaints; two themes never land on one colour.
    const paint = await page.evaluate(() => {
      const ribbon = document.querySelector(".ribbon");
      const grid = document.querySelector(".segment-grid");
      return [
        ribbon ? getComputedStyle(ribbon).backgroundColor : "",
        grid ? getComputedStyle(grid).color : "",
        getComputedStyle(document.body).fontFamily,
      ].join(" | ");
    });
    expect(seen.has(paint), `${id} reuses another theme's paint`).toBe(false);
    seen.add(paint);
  }
});

test("an effect the reader switches off stays off, per theme", async () => {
  await page.locator('[data-theme-preview="phosphor"]').click();
  expect(await fxAttr("scanlines")).toBe("on");

  // Turn the scanlines off; the rest of phosphor is untouched.
  await page.getByRole("checkbox", { name: "扫描线" }).uncheck();
  expect(await fxAttr("scanlines")).toBe("off");
  expect(await themeAttr()).toBe("phosphor");
  await page.screenshot({ path: join(shotsDir, "phosphor-fx-off.png") });

  // A different theme keeps its own signature: the choice is per theme.
  await page.locator('[data-theme-preview="riso"]').click();
  expect(await fxAttr("grain")).toBe("on");

  // Coming back does not silently switch the scanlines on again.
  await page.locator('[data-theme-preview="phosphor"]').click();
  expect(await fxAttr("scanlines")).toBe("off");
});

test("the native frame follows the theme's cast", async () => {
  const source = () =>
    app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);

  await page.locator('[data-theme-preview="dark"]').click();
  await expect.poll(source).toBe("dark");

  await page.locator('[data-theme-preview="quarry"]').click();
  await expect.poll(source).toBe("light");
});

test("the choice survives a restart", async () => {
  await page.locator('[data-theme-preview="cobalt"]').click();
  expect(await themeAttr()).toBe("cobalt");
  await app.close();

  await launch();
  expect(await themeAttr()).toBe("cobalt");
  // The restored theme is dark, so the frame is dark before any interaction.
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(
    "dark",
  );
});
