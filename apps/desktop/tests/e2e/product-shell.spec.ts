import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  _electron as electron,
  errors as playwrightErrors,
  type ElectronApplication,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_APP_PATH = fileURLToPath(new URL("../../", import.meta.url));
const WORKSPACE_ROOT = resolve(DESKTOP_APP_PATH, "..", "..");

const VIEWPORTS = [
  { width: 1250, height: 744, label: "1250x744" },
  { width: 1680, height: 942, label: "1680x942" },
  { width: 1920, height: 1080, label: "1920x1080" },
] as const;

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

/**
 * Dismiss the first-run tutorial when present.
 * Returns only when the dialog is genuinely absent within the wait.
 * Once visible, a missing Skip control or a stuck dialog must fail the test.
 */
async function dismissFirstRunTutorial(page: Page): Promise<void> {
  const tutorial = page.getByRole("dialog", {
    name: /First-run tutorial|首次使用教程/i,
  });
  try {
    await tutorial.waitFor({ state: "visible", timeout: 8_000 });
  } catch (error: unknown) {
    if (error instanceof playwrightErrors.TimeoutError) {
      return;
    }
    throw error;
  }
  await tutorial.getByRole("button", { name: /^(Skip|跳过)$/i }).click();
  await expect(tutorial).toHaveCount(0);
}

/**
 * Product-shell smoke: no-login boot, settings surface, locale control,
 * tutorial skip path, and axe accessibility at all supported viewports.
 */
test("product shell boots without login and exposes settings/tutorial", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tl-shell-e2e-"));
  const engine =
    process.env.TRANSLUNAR_ENGINE_PATH ??
    join(
      WORKSPACE_ROOT,
      "target",
      "debug",
      process.platform === "win32"
        ? "translunar-engine.exe"
        : "translunar-engine",
    );

  let application: ElectronApplication | undefined;
  let userData: string | undefined;
  try {
    userData = await mkdtemp(join(tmpdir(), "tl-shell-user-"));
    application = await electron.launch({
      cwd: DESKTOP_APP_PATH,
      args: ["--no-sandbox", `--user-data-dir=${userData}`, "."],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        TRANSLUNAR_DATA_DIR: dataDir,
        TRANSLUNAR_ENGINE_PATH: engine,
      },
    });
    const window = await application.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    window.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });
    await window.waitForLoadState("domcontentloaded");

    // No login wall.
    await expect(window.getByText(/login|sign in|登录|登入|登陆/i)).toHaveCount(
      0,
    );

    // First-run tutorial is skippable via accessible controls (bilingual).
    await dismissFirstRunTutorial(window);

    const settings = window.getByRole("button", { name: /settings|设置/i });
    await expect(settings).toBeVisible();
    await settings.click();
    await expect(
      window.getByRole("dialog", { name: /settings|设置|产品设置/i }),
    ).toBeVisible();
    await expect(window.getByRole("banner")).toHaveCount(1);

    // Keyboard focus lands inside the dialog.
    await window.keyboard.press("Tab");
    const focusIsInsideDialog = await window.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const active = document.activeElement;
      return (
        dialog !== null &&
        active instanceof HTMLElement &&
        active !== document.body &&
        dialog.contains(active)
      );
    });
    expect(focusIsInsideDialog).toBe(true);

    for (const viewport of VIEWPORTS) {
      await resizeWindow(application, viewport.width, viewport.height);
      await expect(
        window.getByRole("dialog", { name: /settings|设置|产品设置/i }),
      ).toBeVisible();
      const accessibility = await new AxeBuilder({ page: window })
        // Electron's BrowserContext does not support the blank page that
        // axe's partial-run mode creates; legacy mode runs axe in-place.
        .setLegacyMode(true)
        .include('[role="dialog"]')
        .analyze();
      expect(
        accessibility.violations,
        `axe violations at ${viewport.label}`,
      ).toEqual([]);

      const fabGeometry = await settings.evaluate((button) => {
        const fab = button.getBoundingClientRect();
        const header = document
          .querySelector(".project-home-header")
          ?.getBoundingClientRect();
        const overlapsHeader =
          header !== undefined &&
          fab.left < header.right &&
          fab.right > header.left &&
          fab.top < header.bottom &&
          fab.bottom > header.top;
        return {
          rightInset: globalThis.innerWidth - fab.right,
          bottomInset: globalThis.innerHeight - fab.bottom,
          headerFound: header !== undefined,
          overlapsHeader,
        };
      });
      expect(fabGeometry.headerFound).toBe(true);
      expect(Math.abs(fabGeometry.rightInset - 16)).toBeLessThanOrEqual(2);
      expect(Math.abs(fabGeometry.bottomInset - 16)).toBeLessThanOrEqual(2);
      expect(fabGeometry.overlapsHeader).toBe(false);
    }

    // Keep a direct regression for unlabeled controls in addition to axe.
    const unlabeled = await window.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return -1;
      return [...dialog.querySelectorAll("button")].filter((button) => {
        const name =
          button.getAttribute("aria-label") ||
          button.getAttribute("title") ||
          button.textContent?.trim();
        return !name;
      }).length;
    });
    expect(unlabeled).toBe(0);

    await window.keyboard.press("Escape");
    expect(consoleErrors, "unexpected renderer console/page errors").toEqual(
      [],
    );
  } finally {
    try {
      if (application !== undefined) {
        await application.close();
      }
    } finally {
      try {
        await rm(dataDir, { recursive: true, force: true });
      } finally {
        if (userData !== undefined) {
          await rm(userData, { recursive: true, force: true });
        }
      }
    }
  }
});
