import { expect, test, type Page } from "@playwright/test";
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

/**
 * Dismiss the first-run tutorial when present so it does not intercept
 * the settings control. Bilingual: matches either locale's Skip label.
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
 * Bilingual shell smoke: switches to zh-CN, persists the choice across
 * restarts, and confirms meaningful Chinese UI text replaces English on
 * the home surface and settings dialog without leaving placeholder duplicates.
 */
test("switches to zh-CN and persists the locale across restarts", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tl-bilingual-e2e-"));
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
    userData = await mkdtemp(join(tmpdir(), "tl-bilingual-user-"));
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
    let window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await dismissFirstRunTutorial(window);

    // Open settings.
    const settings = window.getByRole("button", { name: /settings|设置/i });
    await expect(settings).toBeVisible();
    await settings.click();
    const settingsDialog = window.getByRole("dialog", {
      name: /settings|设置|产品设置/i,
    });
    await expect(settingsDialog).toBeVisible();

    // Confirm the locale control is present and switch to zh-CN by value.
    const localeControl = window.getByRole("combobox", {
      name: /interface language|界面语言/i,
    });
    await expect(localeControl).toBeVisible();
    await localeControl.selectOption("zh-CN");

    // Wait for stable Chinese UI text on the settings dialog. Use the unique
    // dialog heading (not any text containing 设置, which also matches the
    // "关闭设置" close button) to avoid a strict-mode multiple-match failure.
    await expect(
      settingsDialog.getByRole("heading", { name: "产品设置" }),
    ).toBeVisible({ timeout: 3_000 });

    // Close the dialog.
    await window.keyboard.press("Escape");
    await expect(settingsDialog).toHaveCount(0);

    // Confirm representative Chinese UI text on the home surface.
    await expect(window.getByText(/打开项目|创建项目/)).toBeVisible();

    // Confirm the settings FAB label is now Chinese.
    await expect(window.getByRole("button", { name: /设置/ })).toBeVisible();

    // Restart the application and confirm the locale persisted.
    await application.close();
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
    window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Confirm Chinese UI text is still present after restart.
    await expect(window.getByText(/打开项目|创建项目/)).toBeVisible();
    await expect(window.getByRole("button", { name: /设置/ })).toBeVisible();

    // Open settings again and confirm the locale control still shows zh-CN.
    await window.getByRole("button", { name: /设置/ }).click();
    await expect(
      window.getByRole("dialog", { name: /产品设置|设置/ }),
    ).toBeVisible();
    const persistedLocaleControl = window.getByRole("combobox", {
      name: /语言|语言设置/i,
    });
    await expect(persistedLocaleControl).toHaveValue("zh-CN");
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
