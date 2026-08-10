/**
 * Investigative Electron probe for custom title-bar verify mission.
 * Not product code — lives under task review/.
 * Run from repo root: node --import ./apps/desktop/node_modules/playwright/index.mjs ...
 * Prefer: cd apps/desktop && node --experimental-import-meta-resolve ... 
 * Actual usage: NODE_PATH=apps/desktop/node_modules node this-file
 */
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "../../../../apps/desktop");
const require = createRequire(join(desktopRoot, "package.json"));
const electronExecutable = require("electron");
const { _electron: electron } = await import(
  pathToFileURL(join(desktopRoot, "node_modules/playwright/index.mjs")).href
);

async function main() {
  const userData = await mkdtemp(join(tmpdir(), "translunar-titlebar-probe-"));
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  env.TRANSLUNAR_TEST_USER_DATA = userData;
  env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");

  let app;
  const report = {
    platform: process.platform,
    arch: process.arch,
    checks: {},
  };

  try {
    app = await electron.launch({
      executablePath: electronExecutable,
      args: ["."],
      cwd: desktopRoot,
      env,
    });

    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("app-shell").waitFor({ timeout: 60_000 });

    const winState = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return null;
      const prefs = win.webContents.getLastWebPreferences?.() ?? null;
      return {
        isMaximized: win.isMaximized(),
        isMinimized: win.isMinimized(),
        isResizable: win.isResizable(),
        isMovable: win.isMovable(),
        isMinimizable: win.isMinimizable(),
        isMaximizable: win.isMaximizable(),
        isClosable: win.isClosable(),
        minimumSize: win.getMinimumSize(),
        size: win.getSize(),
        contentSize: win.getContentSize(),
        webPreferences: prefs
          ? {
              contextIsolation: prefs.contextIsolation,
              nodeIntegration: prefs.nodeIntegration,
              sandbox: prefs.sandbox,
            }
          : null,
        autoHideMenuBar: win.isMenuBarAutoHide?.() ?? null,
      };
    });
    report.checks.nativeWindow = winState;
    report.checks.minSizeEnforced = {
      ok:
        Array.isArray(winState?.minimumSize) &&
        winState.minimumSize[0] === 1180 &&
        winState.minimumSize[1] === 700,
      detail: JSON.stringify(winState?.minimumSize),
    };
    report.checks.resizable = {
      ok: winState?.isResizable === true,
      detail: String(winState?.isResizable),
    };
    const sec = winState?.webPreferences;
    report.checks.securityPrefs = {
      ok:
        !!sec &&
        sec.contextIsolation === true &&
        sec.nodeIntegration === false &&
        sec.sandbox === true,
      detail: JSON.stringify(sec),
    };

    const dom = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="app-shell"]');
      const chrome = document.querySelector(".app-chrome");
      const actions = document.querySelector(".app-chrome__actions");
      const controls = document.querySelector('[data-testid="window-controls"]');
      const hs = chrome ? getComputedStyle(chrome) : null;
      const as = actions ? getComputedStyle(actions) : null;
      const cs = controls ? getComputedStyle(controls) : null;
      return {
        platformApi: window.translunar.getWindowChromePlatform(),
        dataChrome: shell?.getAttribute("data-window-chrome") ?? null,
        hasControls: !!controls,
        controlButtons: controls
          ? Array.from(controls.querySelectorAll("button")).map((b) => ({
              name: b.getAttribute("aria-label") || b.textContent?.trim(),
              disabled: b.disabled,
            }))
          : [],
        drag: {
          chrome:
            hs?.getPropertyValue("-webkit-app-region") ||
            hs?.getPropertyValue("app-region"),
          actions:
            as?.getPropertyValue("-webkit-app-region") ||
            as?.getPropertyValue("app-region"),
          controls:
            cs?.getPropertyValue("-webkit-app-region") ||
            cs?.getPropertyValue("app-region"),
        },
        glass: hs
          ? {
              backdrop: hs.backdropFilter || hs.webkitBackdropFilter || "none",
              bg: hs.backgroundColor,
            }
          : null,
      };
    });
    report.checks.dom = dom;
    report.checks.platformCustom = {
      ok: dom.platformApi === "custom" && dom.dataChrome === "custom",
      detail: JSON.stringify({
        p: dom.platformApi,
        d: dom.dataChrome,
      }),
    };
    report.checks.dragCss = {
      ok:
        dom.drag.chrome === "drag" &&
        dom.drag.actions === "no-drag" &&
        (dom.drag.controls === "no-drag" || !dom.hasControls),
      detail: JSON.stringify(dom.drag),
    };
    report.checks.noGlass = {
      ok: !dom.glass?.backdrop || dom.glass.backdrop === "none",
      detail: JSON.stringify(dom.glass),
    };

    if (dom.hasControls) {
      await page.getByRole("button", { name: "Maximize" }).click();
      await page.waitForTimeout(500);
      const afterMax = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win ? { isMaximized: win.isMaximized() } : null;
      });
      const restoreVisible = await page
        .getByRole("button", { name: "Restore" })
        .isVisible()
        .catch(() => false);
      report.checks.maximizeNative = {
        ok: afterMax?.isMaximized === true && restoreVisible,
        detail: JSON.stringify({ afterMax, restoreVisible }),
      };

      await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win?.isMaximized()) win.unmaximize();
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await page.waitForTimeout(400);
      const afterUnmax = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win ? { isMaximized: win.isMaximized() } : null;
      });
      const maximizeVisible = await page
        .getByRole("button", { name: "Maximize" })
        .isVisible()
        .catch(() => false);
      const dataMax = await page
        .getByTestId("window-controls")
        .getAttribute("data-maximized");
      report.checks.nativeUnmaximizeSync = {
        ok:
          afterUnmax?.isMaximized === false &&
          (maximizeVisible || dataMax === "false"),
        detail: JSON.stringify({ afterUnmax, maximizeVisible, dataMax }),
      };

      await page.getByRole("button", { name: "Minimize" }).click();
      await page.waitForTimeout(600);
      const afterMin = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return null;
        const wasMinimized = win.isMinimized();
        if (wasMinimized) win.restore();
        return { wasMinimized };
      });
      await page.waitForTimeout(400);
      report.checks.minimizeNative = {
        ok: afterMin?.wasMinimized === true,
        detail: JSON.stringify(afterMin),
      };

      const maxBtn = page.getByRole("button", { name: "Maximize" });
      await maxBtn.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      const kbdMax = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win ? { isMaximized: win.isMaximized() } : null;
      });
      report.checks.keyboardMaximize = {
        ok: kbdMax?.isMaximized === true,
        detail: JSON.stringify(kbdMax),
      };
      if (kbdMax?.isMaximized) {
        await page.getByRole("button", { name: "Restore" }).click();
        await page.waitForTimeout(300);
      }
    }

    const viewports = [
      [1250, 744],
      [1680, 942],
      [1920, 1080],
    ];
    const overflow = [];
    for (const [w, h] of viewports) {
      await app.evaluate(
        async ({ BrowserWindow }, size) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            if (win.isMaximized()) win.unmaximize();
            win.setSize(size[0], size[1]);
          }
        },
        [w, h],
      );
      await page.waitForTimeout(300);
      const geom = await page.evaluate(() => {
        const de = document.documentElement;
        const chrome = document.querySelector(".app-chrome");
        const identity = document.querySelector(".app-chrome__identity");
        const controls = document.querySelector(
          '[data-testid="window-controls"]',
        );
        const cr = chrome?.getBoundingClientRect();
        const ir = identity?.getBoundingClientRect();
        const ctr = controls?.getBoundingClientRect();
        return {
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          overflowX: de.scrollWidth > de.clientWidth + 1,
          identityRight: ir?.right ?? null,
          chromeRight: cr?.right ?? null,
          controlsRight: ctr?.right ?? null,
          controlsInChrome:
            controls && chrome ? ctr.right <= cr.right + 2 : null,
        };
      });
      overflow.push({ w, h, ...geom });
    }
    report.checks.viewports = overflow;
    report.checks.viewportNoOverflow = {
      ok: overflow.every((v) => !v.overflowX),
      detail: JSON.stringify(
        overflow.map((v) => ({
          w: v.w,
          h: v.h,
          overflowX: v.overflowX,
          controlsInChrome: v.controlsInChrome,
        })),
      ),
    };

    const titleBarInfo = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return null;
      return {
        bounds: win.getBounds(),
        contentBounds: win.getContentBounds(),
        hasShadow: typeof win.hasShadow === "function" ? win.hasShadow() : null,
      };
    });
    report.checks.titleBarInfo = titleBarInfo;
    if (titleBarInfo?.bounds && titleBarInfo?.contentBounds) {
      const dy = titleBarInfo.contentBounds.y - titleBarInfo.bounds.y;
      const dh =
        titleBarInfo.bounds.height - titleBarInfo.contentBounds.height;
      // dy==0 means no reserved OS title-bar band above content client area.
      report.checks.noNativeTitleStripHint = {
        ok: dy === 0,
        detail: JSON.stringify({
          dy,
          dh,
          bounds: titleBarInfo.bounds,
          contentBounds: titleBarInfo.contentBounds,
        }),
      };
    }

    // Isolated close — window/app may tear down immediately after click.
    let windowsLeft = "unknown";
    try {
      await page.getByRole("button", { name: "Close" }).click({ timeout: 5_000 });
    } catch (err) {
      // Click may race with window destruction.
      windowsLeft = `click-error:${err instanceof Error ? err.message : String(err)}`;
    }
    // Poll native window count / process exit without touching the Page.
    for (let i = 0; i < 20; i += 1) {
      try {
        windowsLeft = await app.evaluate(
          async ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        );
        if (windowsLeft === 0) break;
      } catch {
        windowsLeft = "app-exited";
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    report.checks.closeNative = {
      ok: windowsLeft === 0 || windowsLeft === "app-exited",
      detail: String(windowsLeft),
    };

    console.log(JSON.stringify(report, null, 2));
    const criticalKeys = [
      "minSizeEnforced",
      "resizable",
      "securityPrefs",
      "platformCustom",
      "dragCss",
      "maximizeNative",
      "minimizeNative",
      "closeNative",
    ];
    const critical = criticalKeys
      .map((k) => report.checks[k])
      .filter(Boolean);
    const failed = critical.filter((c) => c.ok === false);
    if (failed.length) {
      console.error("FAILED_CHECKS", failed.length);
      process.exitCode = 1;
    } else {
      console.error("PROBE_OK");
      process.exitCode = 0;
    }
  } catch (err) {
    console.error("PROBE_ERROR", err);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 2;
  } finally {
    try {
      await app?.close();
    } catch {
      /* already closed */
    }
    await rm(userData, { recursive: true, force: true });
  }
}

main();
