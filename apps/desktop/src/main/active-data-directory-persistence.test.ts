import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DataDirectoryMigrationResult } from "../shared/product-shell.js";
import { persistRestoreActiveDataDirectory } from "./active-data-directory-persistence.js";
import { resolveDataDirectory } from "./data-directory-manager.js";
import { ShellSettingsStore, shellSettingsPath } from "./shell-settings.js";

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("restore active data directory persistence", () => {
  it("persists a fallback artifact and restart resolution selects it", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-restore-active-path-"));
    tempRoots.push(root);
    const sourcePath = join(root, "live");
    const activePath = join(root, "live.pre-restore-123");
    const settingsPath = shellSettingsPath(root);
    const store = new ShellSettingsStore(settingsPath);
    const result = restoreResult(sourcePath, activePath);

    await persistRestoreActiveDataDirectory(
      { livePath: activePath, isTestOverride: false },
      result,
      store,
    );

    const reloaded = await new ShellSettingsStore(settingsPath).load();
    expect(reloaded.dataDirectoryPath).toBe(activePath);
    expect(
      resolveDataDirectory({
        settingsPath: reloaded.dataDirectoryPath,
        defaultPath: join(root, "default"),
      }),
    ).toEqual({ path: resolve(activePath), isTestOverride: false });
  });

  it("does not persist an environment override", async () => {
    const update = vi.fn(() => Promise.resolve());
    const sourcePath = resolve("K:/restore-live");
    const activePath = resolve("K:/restore-live.pre-restore-123");

    await persistRestoreActiveDataDirectory(
      { livePath: activePath, isTestOverride: true },
      restoreResult(sourcePath, activePath),
      { update },
    );

    expect(update).not.toHaveBeenCalled();
  });

  it("propagates an atomic settings write failure", async () => {
    const sourcePath = resolve("K:/restore-live");
    const activePath = resolve("K:/restore-live.pre-restore-123");

    await expect(
      persistRestoreActiveDataDirectory(
        { livePath: activePath, isTestOverride: false },
        restoreResult(sourcePath, activePath),
        {
          update: () => Promise.reject(new Error("settings rename failed")),
        },
      ),
    ).rejects.toThrow("settings rename failed");
  });

  it("rejects a manager/result active-path mismatch", async () => {
    const sourcePath = resolve("K:/restore-live");
    const activePath = resolve("K:/restore-live.pre-restore-123");
    const update = vi.fn(() => Promise.resolve());

    await expect(
      persistRestoreActiveDataDirectory(
        { livePath: sourcePath, isTestOverride: false },
        restoreResult(sourcePath, activePath),
        { update },
      ),
    ).rejects.toThrow("does not match");
    expect(update).not.toHaveBeenCalled();
  });
});

function restoreResult(
  sourcePath: string,
  activePath: string,
): DataDirectoryMigrationResult {
  return {
    ok: false,
    phase: "rollback",
    sourcePath,
    targetPath: resolve("K:/backup"),
    activePath,
    code: "post_swap_health_failed",
    message: "Restored live workspace failed health check.",
  };
}
