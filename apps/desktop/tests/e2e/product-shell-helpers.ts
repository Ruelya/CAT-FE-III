import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import {
  _electron as electron,
  errors as playwrightErrors,
  type ElectronApplication,
  type Page,
} from "playwright";

export const DESKTOP_APP_PATH = fileURLToPath(new URL("../../", import.meta.url));
export const WORKSPACE_ROOT = resolve(DESKTOP_APP_PATH, "..", "..");

export const VIEWPORTS = [
  { width: 1250, height: 744, label: "1250x744" },
  { width: 1680, height: 942, label: "1680x942" },
  { width: 1920, height: 1080, label: "1920x1080" },
] as const;

export interface ProductShellHarness {
  application: ElectronApplication;
  page: Page;
  dataDir: string;
  userData: string;
  /**
   * Absolute path the deterministic backup seam
   * (`TRANSLUNAR_TEST_BACKUP_DESTINATION`) points the Engine at. It lives
   * outside the live data directory so the backup is not a descendant of the
   * workspace it copies. The Engine creates this directory and writes a
   * `manifest.json` inside it.
   */
  backupDestination: string;
  consoleErrors: string[];
}

export interface ProductShellOptions {
  /** Deterministic backup destination seam (skips the native dialog). */
  withBackupSeam?: boolean;
}

function resolveEnginePath(): string {
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

/**
 * Launch the packaged renderer against an isolated temporary data directory and
 * a real Rust Engine build — the same seams `workbench.spec.ts` uses. Optionally
 * wires the deterministic backup-destination seam so a backup UI flow can run
 * without a native dialog.
 */
export async function launchProductShell(
  label: string,
  options: ProductShellOptions = {},
): Promise<ProductShellHarness> {
  const dataDir = await mkdtemp(join(tmpdir(), `tl-shell-${label}-`));
  const userData = await mkdtemp(join(tmpdir(), `tl-shell-user-${label}-`));
  // Sibling of the live data directory, not a descendant: the Engine refuses
  // to back a workspace up into itself, and this path must not pre-exist so the
  // no-clobber check passes and the Engine is the one that creates it.
  const backupDestination = join(
    dirname(dataDir),
    `tl-shell-${label}-backup-${Date.now()}`,
  );
  const engine = resolveEnginePath();
  const consoleErrors: string[] = [];
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      cwd: DESKTOP_APP_PATH,
      args: ["--no-sandbox", `--user-data-dir=${userData}`, "."],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        TRANSLUNAR_DATA_DIR: dataDir,
        TRANSLUNAR_ENGINE_PATH: engine,
        ...(options.withBackupSeam
          ? { TRANSLUNAR_TEST_BACKUP_DESTINATION: backupDestination }
          : {}),
      },
    });
    const page = await application.firstWindow();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.waitForLoadState("domcontentloaded");
    return {
      application,
      page,
      dataDir,
      userData,
      backupDestination,
      consoleErrors,
    };
  } catch (error: unknown) {
    try {
      if (application !== undefined) await application.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
      await rm(userData, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function closeProductShell(
  harness: ProductShellHarness,
): Promise<void> {
  try {
    await harness.application.close();
  } finally {
    try {
      await rm(harness.dataDir, { recursive: true, force: true });
    } finally {
      try {
        await rm(harness.userData, { recursive: true, force: true });
      } finally {
        await rm(harness.backupDestination, { recursive: true, force: true });
      }
    }
  }
}

/**
 * Dismiss the first-run tutorial when present. Returns without acting only when
 * the dialog is genuinely absent within the wait.
 */
export async function dismissFirstRunTutorial(page: Page): Promise<void> {
  const tutorial = page.getByRole("dialog", {
    name: /First-run tutorial|首次使用教程/i,
  });
  try {
    await tutorial.waitFor({ state: "visible", timeout: 8_000 });
  } catch (error: unknown) {
    if (error instanceof playwrightErrors.TimeoutError) return;
    throw error;
  }
  await tutorial.getByRole("button", { name: /^(Skip|跳过)$/i }).click();
  await expect(tutorial).toHaveCount(0);
}

export async function resizeWindow(
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
 * Run axe against a scoped container at a single viewport. Electron's
 * BrowserContext requires legacy mode. Color-contrast is excluded because the
 * shared visual stylesheet is owned by a separate task; contrast remains a
 * manual acceptance check in `docs/accessibility-matrix.md`.
 */
export async function runScopedAxe(
  page: Page,
  include: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .setLegacyMode(true)
    .include(include)
    .disableRules(["color-contrast"])
    .analyze();
  expect(
    results.violations,
    `axe violations in ${include}:\n${JSON.stringify(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      null,
      2,
    )}`,
  ).toEqual([]);
}

/**
 * Assert keyboard focus can reach a focusable element inside `selector` using
 * only the Tab key. Tabs up to `maxTabs` times because the container is not
 * necessarily the first thing in tab order — the shell settings FAB is rendered
 * in the shell chrome ahead of the page content, so a single Tab can land on a
 * legitimately-focusable control outside the container. This proves keyboard
 * reachability without asserting a specific first stop.
 */
export async function assertKeyboardEntersContainer(
  page: Page,
  selector: string,
  maxTabs = 20,
): Promise<void> {
  const isInside = () =>
    page.evaluate((sel) => {
      const container = document.querySelector<HTMLElement>(sel);
      const active = document.activeElement;
      return (
        container !== null &&
        active instanceof HTMLElement &&
        active !== document.body &&
        container.contains(active)
      );
    }, selector);

  // A modal focus trap may already have placed focus inside on mount.
  if (await isInside()) return;
  for (let attempt = 0; attempt < maxTabs; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await isInside()) return;
  }
  expect(
    false,
    `keyboard focus did not reach ${selector} within ${maxTabs} tabs`,
  ).toBe(true);
}
