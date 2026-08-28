// Integrated window chrome through the real Electron app. Linux runs the
// same code path as Windows (titleBarStyle hidden + native window-button
// overlay + renderer titlebar strip), so this is the honest cross-platform
// proof CI can give: the OS caption is gone, the classic menu bar takes no
// second row, and 文件…帮助 live on the strip itself.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";

const appRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(appRoot, "../..");

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const workDir = mkdtempSync(join(tmpdir(), "tl-desktop-titlebar-e2e-"));
  app = await electron.launch({
    args: ["."],
    cwd: appRoot,
    env: {
      ...process.env,
      TL_DATA_DIR: join(workDir, "engine-data"),
      TL_ENGINE_BIN: join(repoRoot, "target", "debug", "tl-engine"),
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
});

test("the OS caption is hidden and the classic menu bar takes no second row", async () => {
  const chrome = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    return {
      menuBarAutoHide: window.isMenuBarAutoHide(),
      menuBarVisible: window.isMenuBarVisible(),
    };
  });
  expect(chrome.menuBarAutoHide).toBe(true);
  expect(chrome.menuBarVisible).toBe(false);

  // The Window Controls Overlay is live: min/max/close are native buttons
  // overlaid on the strip's right edge, so the web titlebar area stops
  // short of the full window width.
  const overlay = await page.evaluate(() => {
    interface OverlayNavigator extends Navigator {
      windowControlsOverlay?: {
        visible: boolean;
        getTitlebarAreaRect(): DOMRect;
      };
    }
    const wco = (navigator as OverlayNavigator).windowControlsOverlay;
    return {
      visible: wco?.visible ?? false,
      areaWidth: wco?.getTitlebarAreaRect().width ?? 0,
      windowWidth: window.innerWidth,
    };
  });
  expect(overlay.visible).toBe(true);
  expect(overlay.areaWidth).toBeGreaterThan(0);
  expect(overlay.areaWidth).toBeLessThan(overlay.windowWidth);
});

test("the strip carries brand, the seven application menus, and the title on one row", async () => {
  const menubar = page.getByRole("menubar", { name: "应用菜单" });
  await expect(menubar).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveText([
    "文件",
    "编辑",
    "视图",
    "项目",
    "翻译",
    "QA",
    "帮助",
  ]);

  const titlebar = page.locator(".titlebar");
  await expect(titlebar).toContainText("Translunar");

  // Drag contract: the strip drags the window; the menus opt out so they
  // stay clickable.
  await expect(titlebar).toHaveCSS("-webkit-app-region", "drag");
  await expect(page.locator(".titlebar__menubar")).toHaveCSS(
    "-webkit-app-region",
    "no-drag",
  );

  // One row: the strip's height is the overlay height, and the ribbonless
  // shell starts right under it.
  const box = await titlebar.boundingBox();
  expect(box?.y).toBe(0);
  expect(box?.height).toBe(32);
});
