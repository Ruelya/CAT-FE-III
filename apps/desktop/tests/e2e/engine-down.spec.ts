// Honest engine-down UX through the real Electron app:
// 1. A missing engine binary must park the app behind a blocking gate that
//    says the engine is stopped and offers a manual relaunch — never an
//    editable-looking surface.
// 2. A mid-session SIGKILL of the engine must surface the restart honestly
//    and recover to ready with a fresh pid.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";

const appRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(appRoot, "../..");
const engineBinary = join(repoRoot, "target", "debug", "tl-engine");

async function launch(binaryPath: string): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const workDir = mkdtempSync(join(tmpdir(), "tl-desktop-down-e2e-"));
  const app = await electron.launch({
    args: ["."],
    cwd: appRoot,
    env: {
      ...process.env,
      TL_DATA_DIR: join(workDir, "engine-data"),
      TL_ENGINE_BIN: binaryPath,
    },
  });
  const page = await app.firstWindow();
  return { app, page };
}

test("a missing engine parks the app behind a blocking gate with a relaunch offer", async () => {
  const { app, page } = await launch(
    join(tmpdir(), "definitely-missing-tl-engine"),
  );
  try {
    const gate = page.getByRole("alertdialog");
    // The gate is up from the first paint: no editable-looking surface.
    await expect(gate).toBeVisible();

    // The supervisor burns its restart budget (~15s of backoff), then the
    // gate must say the engine is stopped — with the real error — and
    // offer a manual relaunch.
    await expect(gate).toContainText("翻译引擎已停止", { timeout: 45_000 });
    await expect(gate).toContainText("编辑已锁定");
    const relaunch = page.getByRole("button", { name: "重新启动引擎" });
    await expect(relaunch).toBeVisible();

    // Relaunch leaves the parked "down" state and runs the spawn/backoff
    // cycle again (the binary is still missing, so the spawn error lands
    // within milliseconds and the gate shows the auto-restart state).
    await relaunch.click();
    await expect(gate).toContainText("正在自动重启", { timeout: 10_000 });
    await expect(relaunch).not.toBeVisible();

    // The workbench underneath stays inert the whole time.
    await expect(page.locator(".app-main")).toHaveAttribute("inert", "");
  } finally {
    await app.close();
  }
});

test("a mid-session engine kill shows the restart gate and recovers with a fresh pid", async () => {
  const { app, page } = await launch(engineBinary);
  try {
    const engineLabel = page.locator(".app-header__engine");
    await expect(engineLabel).toContainText("pid", { timeout: 30_000 });
    const before = await engineLabel.innerText();
    const pid = Number(/pid (\d+)/.exec(before)?.[1]);
    expect(pid).toBeGreaterThan(0);

    // Hard-kill the engine out from under the app.
    process.kill(pid, "SIGKILL");

    // The crash must surface as a blocking gate (backoff keeps it up for
    // at least 500ms), not as a silent toast.
    const gate = page.getByRole("alertdialog");
    await expect(gate).toBeVisible({ timeout: 10_000 });

    // ...and the supervisor recovers to ready with a fresh process.
    await expect(engineLabel).toContainText("pid", { timeout: 30_000 });
    await expect(engineLabel).not.toContainText(`pid ${pid}`, {
      timeout: 30_000,
    });
    await expect(gate).not.toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".app-main")).not.toHaveAttribute("inert");
  } finally {
    await app.close();
  }
});
