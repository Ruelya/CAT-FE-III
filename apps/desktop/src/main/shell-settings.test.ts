import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ShellSettingsStore,
  parseShellLocalePreferencePatch,
  sanitizeSettings,
  shellSettingsPath,
} from "./shell-settings.js";
import type {
  BackupHistoryEntry,
  TutorialState,
  UpdateHistoryEntry,
} from "../shared/product-shell.js";

const tempRoots: string[] = [];

describe("shell settings validation", () => {
  it("falls back field-by-field for unknown JSON", () => {
    const settings = sanitizeSettings({
      locale: "fr-FR",
      updateMode: "warp-speed",
      deferredUntilMs: "soon",
      dataDirectoryPath: 12,
      tutorial: { step: "nope", skipped: "yes" },
      backupHistory: [{ id: "b1", destinationPath: "/tmp/b" }],
      updateHistory: "nope",
      secret: "must-not-persist",
    });
    expect(settings.locale).toBeNull();
    expect(settings.updateMode).toBe("manual");
    expect(settings.deferredUntilMs).toBeNull();
    expect(settings.dataDirectoryPath).toBeNull();
    expect(settings.tutorial.step).toBe("welcome");
    expect(settings.tutorial.skipped).toBe(false);
    expect(settings.backupHistory).toHaveLength(1);
    expect(settings.updateHistory).toEqual([]);
    expect(settings.installLedger).toBeNull();
    expect(settings).not.toHaveProperty("secret");
  });

  it("accepts a durable install ledger", () => {
    const settings = sanitizeSettings({
      installLedger: {
        feedKind: "fixture",
        backupCreatedAtMs: 10,
        backupPath: "/tmp/pre-update-backup",
        installStartedAtMs: 11,
        installFinishedAtMs: 12,
        healthCheckedAtMs: null,
        rollbackRequired: false,
        packagePath: "/tmp/pkg",
        packageIdentity: "fixture:2.0.0",
        installInvocationAccepted: true,
        claimedInstalled: false,
        pendingRestart: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        stagedPath: "/tmp/stage",
        lastRecoveryAction: null,
        lastRecoveryAtMs: null,
        lastRecoveryOutcome: null,
        recoveryHistoryRecorded: false,
      },
    });
    expect(settings.installLedger?.pendingRestart).toBe(true);
    expect(settings.installLedger?.targetVersion).toBe("2.0.0");
    expect(settings.installLedger?.claimedInstalled).toBe(false);
    expect(settings.installLedger?.backupPath).toBe("/tmp/pre-update-backup");
    expect(settings.installLedger?.packageIdentity).toBe("fixture:2.0.0");
    expect(settings.installLedger?.installInvocationAccepted).toBe(true);
  });

  it("accepts valid locale and update mode", () => {
    const settings = sanitizeSettings({
      locale: "zh-CN",
      updateMode: "disabled",
      deferredUntilMs: 100,
      dataDirectoryPath: "K:/data",
      tutorial: {
        version: 1,
        step: "import",
        skipped: false,
        completed: false,
        updatedAtMs: 1,
      },
    });
    expect(settings.locale).toBe("zh-CN");
    expect(settings.updateMode).toBe("disabled");
    expect(settings.deferredUntilMs).toBe(100);
    expect(settings.dataDirectoryPath).toBe("K:/data");
    expect(settings.tutorial.step).toBe("import");
  });
});

describe("shell locale preference patch parser", () => {
  it("accepts en-US, zh-CN, and intentional null reset", () => {
    expect(parseShellLocalePreferencePatch({ locale: "en-US" })).toEqual({
      locale: "en-US",
    });
    expect(parseShellLocalePreferencePatch({ locale: "zh-CN" })).toEqual({
      locale: "zh-CN",
    });
    expect(parseShellLocalePreferencePatch({ locale: null })).toEqual({
      locale: null,
    });
  });

  it("rejects missing, extra, and non-locale keys at runtime", () => {
    expect(() => parseShellLocalePreferencePatch({})).toThrow(/locale/i);
    expect(() =>
      parseShellLocalePreferencePatch({
        locale: "en-US",
        updateMode: "manual",
      }),
    ).toThrow(/locale preference/i);
    expect(() =>
      parseShellLocalePreferencePatch({ updateMode: "disabled" }),
    ).toThrow(/locale preference/i);
    expect(() =>
      parseShellLocalePreferencePatch({
        locale: "en-US",
        installLedger: null,
      }),
    ).toThrow(/locale preference/i);
    expect(() => parseShellLocalePreferencePatch({ locale: "fr-FR" })).toThrow(
      /invalid locale/i,
    );
    expect(() => parseShellLocalePreferencePatch(null)).toThrow(/invalid/i);
    expect(() =>
      parseShellLocalePreferencePatch({ deferredUntilMs: 1 }),
    ).toThrow(/locale preference/i);
  });
});

describe("shell settings concurrent atomic writes", () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  async function isolatedStore(): Promise<{
    root: string;
    path: string;
    store: ShellSettingsStore;
  }> {
    const root = await mkdtemp(join(tmpdir(), "tl-shell-settings-"));
    tempRoots.push(root);
    const path = shellSettingsPath(root);
    return { root, path, store: new ShellSettingsStore(path) };
  }

  function backupEntry(id: string, createdAtMs: number): BackupHistoryEntry {
    return {
      id,
      destinationPath: `/tmp/backup-${id}`,
      createdAtMs,
      schemaVersion: 1,
      engineVersion: "1.0.0",
      fileCount: 1,
    };
  }

  function updateEntry(id: string, atMs: number): UpdateHistoryEntry {
    return {
      id,
      version: `1.0.${atMs}`,
      status: "installed",
      atMs,
    };
  }

  async function expectNoTempSiblings(path: string): Promise<void> {
    const siblings = await readdir(dirname(path));
    expect(siblings.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  }

  it("merges concurrent unrelated update patches without loss", async () => {
    const { path, store } = await isolatedStore();
    const tutorial: TutorialState = {
      version: 1,
      step: "import",
      skipped: false,
      completed: false,
      updatedAtMs: 42,
    };

    await Promise.all([
      store.update({ locale: "zh-CN" }),
      store.update({ updateMode: "disabled" }),
      store.update({ tutorial }),
    ]);

    const reloaded = await new ShellSettingsStore(path).load();
    expect(reloaded.locale).toBe("zh-CN");
    expect(reloaded.updateMode).toBe("disabled");
    expect(reloaded.tutorial.step).toBe("import");
    expect(reloaded.tutorial.updatedAtMs).toBe(42);

    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      locale: "zh-CN",
      updateMode: "disabled",
      tutorial: { step: "import", updatedAtMs: 42 },
    });
    await expectNoTempSiblings(path);
  });

  it("preserves concurrent history pushes and the bounded newest-first contract", async () => {
    const { path, store } = await isolatedStore();
    const backupIds = Array.from({ length: 25 }, (_, index) => `b${index}`);
    const updateIds = Array.from({ length: 25 }, (_, index) => `u${index}`);

    await Promise.all([
      ...backupIds.map((id, index) =>
        store.pushBackup(backupEntry(id, index + 1)),
      ),
      ...updateIds.map((id, index) =>
        store.pushUpdate(updateEntry(id, index + 1)),
      ),
    ]);

    const reloaded = await new ShellSettingsStore(path).load();
    expect(reloaded.backupHistory.map((entry) => entry.id)).toEqual(
      [...backupIds].reverse().slice(0, 20),
    );
    expect(reloaded.updateHistory.map((entry) => entry.id)).toEqual(
      [...updateIds].reverse().slice(0, 20),
    );
    expect(reloaded.backupHistory).toHaveLength(20);
    expect(reloaded.updateHistory).toHaveLength(20);
    const raw = await readFile(path, "utf8");
    expect(() => {
      const parsed: unknown = JSON.parse(raw);
      void parsed;
    }).not.toThrow();
    await expectNoTempSiblings(path);
  });

  it("continues processing after a queued operation fails", async () => {
    const { root } = await isolatedStore();
    const blockedParent = join(root, "blocked-parent");
    await writeFile(blockedParent, "not a directory", "utf8");
    const path = join(blockedParent, "settings.json");
    const store = new ShellSettingsStore(path);

    await expect(store.update({ locale: "en-US" })).rejects.toThrow();

    await rm(blockedParent, { force: true });
    await mkdir(blockedParent);
    await expect(
      store.update({ updateMode: "automatic" }),
    ).resolves.toMatchObject({ updateMode: "automatic" });
    const reloaded = await new ShellSettingsStore(path).load();
    expect(reloaded.updateMode).toBe("automatic");
    await expectNoTempSiblings(path);
  });

  it("cleans a staged file and leaves the cache unchanged when rename fails", async () => {
    const { root } = await isolatedStore();
    const path = shellSettingsPath(root);
    await mkdir(path);
    const store = new ShellSettingsStore(path);

    await expect(store.update({ locale: "zh-CN" })).rejects.toThrow();
    await expectNoTempSiblings(path);

    await rm(path, { recursive: true, force: true });
    const saved = await store.update({ updateMode: "disabled" });
    expect(saved.locale).toBeNull();
    expect(saved.updateMode).toBe("disabled");
    await expectNoTempSiblings(path);
  });
});
