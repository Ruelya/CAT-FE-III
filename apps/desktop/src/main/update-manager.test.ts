import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.1.0",
    isPackaged: false,
  },
}));

import {
  assertHttpUrl,
  compareSemVer,
  createDefaultUpdateManager,
  emptyInstallLedger,
  FixtureFeedAdapter,
  FixturePlatformInstaller,
  HttpFeedAdapter,
  isStrictlyNewerVersion,
  isValidSemVer,
  NativeElectronUpdaterAdapter,
  NativePlatformInstaller,
  type ElectronUpdaterClient,
  UpdateManager,
} from "./update-manager.js";

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function baseHooks(
  overrides?: Partial<{
    createBackup: () => Promise<{ path: string }>;
    hasUnsavedDrafts: () => Promise<boolean>;
    healthCheck: () => Promise<boolean>;
    pathExists: (path: string) => Promise<boolean>;
    validateBackup: (
      path: string,
    ) => Promise<{ ok: boolean; message?: string }>;
    validatePackage: (
      path: string,
    ) => Promise<{ ok: boolean; message?: string }>;
    restoreFromBackup: (
      path: string,
    ) => Promise<{ ok: boolean; message?: string }>;
    openPath: (path: string) => Promise<string>;
    persistLedger: (
      ledger: ReturnType<typeof emptyInstallLedger>,
    ) => Promise<void>;
    onInstalled: (info: { version: string }) => Promise<void>;
    onRecovery: (info: {
      action: "rollback" | "open_installer";
      outcome: "succeeded" | "failed";
      version: string;
    }) => Promise<void>;
  }>,
) {
  return {
    createBackup:
      overrides?.createBackup ??
      (() => Promise.resolve({ path: join(tmpdir(), "pre-update-backup") })),
    hasUnsavedDrafts:
      overrides?.hasUnsavedDrafts ?? (() => Promise.resolve(false)),
    healthCheck: overrides?.healthCheck ?? (() => Promise.resolve(true)),
    pathExists:
      overrides?.pathExists ??
      (async (path: string) => {
        try {
          await access(path);
          return true;
        } catch {
          // synthetic fixture backup paths
          return path.includes("pre-update") || path.includes("backup");
        }
      }),
    validateBackup:
      overrides?.validateBackup ??
      ((path: string) => Promise.resolve({ ok: Boolean(path) })),
    validatePackage:
      overrides?.validatePackage ??
      ((path: string) => Promise.resolve({ ok: Boolean(path) })),
    ...(overrides?.restoreFromBackup
      ? { restoreFromBackup: overrides.restoreFromBackup }
      : {}),
    ...(overrides?.openPath ? { openPath: overrides.openPath } : {}),
    ...(overrides?.persistLedger
      ? { persistLedger: overrides.persistLedger }
      : {}),
    ...(overrides?.onInstalled ? { onInstalled: overrides.onInstalled } : {}),
    ...(overrides?.onRecovery ? { onRecovery: overrides.onRecovery } : {}),
  };
}

function mockElectronUpdaterClient(
  overrides?: Partial<ElectronUpdaterClient> & {
    version?: string;
    packagePath?: string;
  },
): ElectronUpdaterClient & {
  quitAndInstall: ReturnType<typeof vi.fn>;
  setFeedURL: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
} {
  let progressListener: ((info: { percent: number }) => void) | undefined;
  const client = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(() =>
      Promise.resolve({
        updateInfo: { version: overrides?.version ?? "2.0.0" },
      }),
    ),
    downloadUpdate: vi.fn(() => {
      progressListener?.({ percent: 25 });
      progressListener?.({ percent: 80 });
      return Promise.resolve([
        overrides?.packagePath ?? "/tmp/translunar-update-pkg.exe",
      ]);
    }),
    quitAndInstall: vi.fn(),
    on: vi.fn(
      (
        event: "download-progress",
        listener: (info: { percent: number }) => void,
      ) => {
        if (event === "download-progress") progressListener = listener;
      },
    ),
    removeListener: vi.fn(),
    ...overrides,
  };
  return client as ElectronUpdaterClient & {
    quitAndInstall: ReturnType<typeof vi.fn>;
    setFeedURL: ReturnType<typeof vi.fn>;
    checkForUpdates: ReturnType<typeof vi.fn>;
    downloadUpdate: ReturnType<typeof vi.fn>;
  };
}

describe("semver helpers", () => {
  it("orders core versions and prereleases", () => {
    expect(compareSemVer("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareSemVer("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemVer("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemVer("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
    expect(compareSemVer("1.0.0-alpha.1", "1.0.0-alpha.2")).toBeLessThan(0);
    expect(compareSemVer("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(isStrictlyNewerVersion("1.2.0", "1.1.9")).toBe(true);
    expect(isStrictlyNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isStrictlyNewerVersion("1.0.0", "1.0.1")).toBe(false);
    expect(isStrictlyNewerVersion("1.0.0", "1.0.0-rc.1")).toBe(true);
  });

  it("rejects invalid SemVer without lexical fallback", () => {
    expect(isValidSemVer("01.0.0")).toBe(false);
    expect(isValidSemVer("1.0.0-01")).toBe(false);
    expect(isValidSemVer("1.0.0-alpha..1")).toBe(false);
    expect(isValidSemVer("v1.0.0")).toBe(false);
    expect(isValidSemVer(" 1.0.0")).toBe(false);
    expect(isValidSemVer("1.0.0 ")).toBe(false);
    expect(isValidSemVer("1.0")).toBe(false);
    expect(() => compareSemVer("01.0.0", "1.0.0")).toThrow(/semantic version/i);
    expect(() => compareSemVer("1.0.0", "1.0.0-01")).toThrow(
      /semantic version/i,
    );
    expect(() => compareSemVer("v1.0.0", "1.0.1")).toThrow(/semantic version/i);
    expect(() => compareSemVer("1.0.0-alpha..1", "1.0.0")).toThrow(
      /semantic version/i,
    );
  });

  it("compares large numeric prerelease identifiers safely", () => {
    expect(
      compareSemVer("1.0.0-1.9007199254740993", "1.0.0-1.9007199254740994"),
    ).toBeLessThan(0);
    expect(
      compareSemVer("9007199254740993.0.0", "9007199254740992.0.0"),
    ).toBeGreaterThan(0);
  });
});

describe("update manager", () => {
  it("fixture check/download/install ends as pending-restart without claiming", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-update-"));
    const stageRoot = join(root, "stage");
    const feed = join(root, "feed.json");
    const backupPath = join(root, "backup");
    await mkdirSafe(backupPath);
    await writeFile(
      feed,
      JSON.stringify({ version: "9.9.9", notes: "fixture" }),
      "utf8",
    );
    let backups = 0;
    let persisted = 0;
    const manager = new UpdateManager({
      adapter: new FixtureFeedAdapter(feed, "0.1.0"),
      installer: new FixturePlatformInstaller(stageRoot),
      currentVersion: "0.1.0",
      feedUrl: feed,
      feedKind: "fixture",
      hooks: baseHooks({
        createBackup: () => {
          backups += 1;
          return Promise.resolve({ path: backupPath });
        },
        pathExists: async (path) => {
          try {
            await access(path);
            return true;
          } catch {
            return false;
          }
        },
        persistLedger: () => {
          persisted += 1;
          return Promise.resolve();
        },
      }),
    });

    const checked = await manager.check({ manual: true });
    expect(checked.status).toBe("available");
    expect(checked.availableVersion).toBe("9.9.9");
    expect(checked.feedKind).toBe("fixture");

    const downloaded = await manager.download();
    expect(downloaded.status).toBe("ready");

    const installed = await manager.install();
    expect(installed.status).toBe("pending-restart");
    expect(installed.installLedger.claimedInstalled).toBe(false);
    expect(installed.installLedger.pendingRestart).toBe(true);
    expect(installed.installLedger.installInvocationAccepted).toBe(true);
    expect(installed.installLedger.targetVersion).toBe("9.9.9");
    expect(installed.installLedger.backupPath).toBe(backupPath);
    expect(installed.installLedger.backupCreatedAtMs).toBeTypeOf("number");
    expect(installed.installLedger.stagedPath).toBeTruthy();
    expect(backups).toBe(1);
    expect(persisted).toBeGreaterThan(0);
    await access(installed.installLedger.stagedPath!);
  });

  it("native updater configures/check/download/progress and quitAndInstall once after ordered ledger", async () => {
    const events: string[] = [];
    const packagePath = "/tmp/native-update.exe";
    const backupPath = join(
      await mkdtemp(join(tmpdir(), "tl-native-bak-")),
      "workspace",
    );
    await mkdirSafe(backupPath);
    const client = mockElectronUpdaterClient({
      version: "3.0.0",
      packagePath,
    });
    const quitAndInstall = client.quitAndInstall as ReturnType<typeof vi.fn>;
    quitAndInstall.mockImplementation(() => {
      events.push("quitAndInstall");
    });

    const manager = new UpdateManager({
      adapter: new NativeElectronUpdaterAdapter({
        client,
        feedUrl: "https://updates.example.com/",
        currentVersion: "1.0.0",
        isPackaged: true,
        platform: "win32",
      }),
      installer: new NativePlatformInstaller(client),
      currentVersion: "1.0.0",
      feedUrl: "https://updates.example.com/",
      feedKind: "http",
      hooks: baseHooks({
        createBackup: () => {
          events.push("backup");
          return Promise.resolve({ path: backupPath });
        },
        pathExists: (path) =>
          Promise.resolve(path === backupPath || path === packagePath),
        persistLedger: (ledger) => {
          if (
            ledger.targetVersion &&
            !ledger.backupPath &&
            !ledger.installInvocationAccepted
          ) {
            events.push("ledger-initial");
          } else if (ledger.backupPath && !ledger.installInvocationAccepted) {
            events.push("ledger-backup");
          } else if (
            ledger.installInvocationAccepted &&
            ledger.pendingRestart
          ) {
            events.push("ledger-accepted");
          }
          return Promise.resolve();
        },
      }),
    });

    const checked = await manager.check({ manual: true });
    expect(checked.status).toBe("available");
    expect(client.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://updates.example.com/",
    });
    expect(client.autoDownload).toBe(false);
    expect(client.autoInstallOnAppQuit).toBe(false);

    const downloaded = await manager.download();
    expect(downloaded.status).toBe("ready");
    expect(downloaded.downloadPercent).toBe(100);
    expect(client.downloadUpdate).toHaveBeenCalledTimes(1);

    const installed = await manager.install();
    expect(installed.status).toBe("pending-restart");
    expect(installed.installLedger.installInvocationAccepted).toBe(true);
    expect(installed.installLedger.claimedInstalled).toBe(false);
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    expect(quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(events).toEqual([
      "ledger-initial",
      "backup",
      "ledger-backup",
      "ledger-accepted",
      "quitAndInstall",
    ]);
  });

  it("records recovery-required when quitAndInstall rejects", async () => {
    const backupPath = join(await mkdtemp(join(tmpdir(), "tl-reject-")), "bak");
    await mkdirSafe(backupPath);
    const client = mockElectronUpdaterClient({ version: "2.1.0" });
    (client.quitAndInstall as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error("installer rejected");
      },
    );
    const manager = new UpdateManager({
      adapter: new NativeElectronUpdaterAdapter({
        client,
        feedUrl: "https://updates.example.com/",
        currentVersion: "1.0.0",
        isPackaged: true,
        platform: "darwin",
      }),
      installer: new NativePlatformInstaller(client),
      currentVersion: "1.0.0",
      feedKind: "http",
      hooks: baseHooks({
        createBackup: () => Promise.resolve({ path: backupPath }),
        pathExists: () => Promise.resolve(true),
      }),
    });
    await manager.check({ manual: true });
    await manager.download();
    const result = await manager.install();
    expect(result.status).toBe("rollback-required");
    expect(result.installLedger.installInvocationAccepted).toBe(false);
    expect(result.installLedger.pendingRestart).toBe(false);
    expect(result.installLedger.claimedInstalled).toBe(false);
    expect(result.lastError).toMatch(/rejected/i);
  });

  it("refuses unpackaged and unsupported platforms truthfully", async () => {
    const client = mockElectronUpdaterClient();
    const unpackaged = new UpdateManager({
      adapter: new NativeElectronUpdaterAdapter({
        client,
        feedUrl: "https://updates.example.com/",
        currentVersion: "1.0.0",
        isPackaged: false,
        platform: "win32",
      }),
      installer: new NativePlatformInstaller(client),
      currentVersion: "1.0.0",
      feedKind: "http",
      hooks: baseHooks(),
    });
    const unpackagedResult = await unpackaged.check({ manual: true });
    expect(unpackagedResult.status).toBe("failed");
    expect(unpackagedResult.lastError).toMatch(/packaged/i);

    const linux = new UpdateManager({
      adapter: new NativeElectronUpdaterAdapter({
        client,
        feedUrl: "https://updates.example.com/",
        currentVersion: "1.0.0",
        isPackaged: true,
        platform: "linux",
      }),
      installer: new NativePlatformInstaller(client),
      currentVersion: "1.0.0",
      feedKind: "http",
      hooks: baseHooks(),
    });
    const linuxResult = await linux.check({ manual: true });
    expect(linuxResult.status).toBe("failed");
    expect(linuxResult.lastError).toMatch(/Windows|macOS/i);
  });

  it("rejects whitespace-padded production feed versions", async () => {
    const client = mockElectronUpdaterClient({ version: " 2.0.0 " });
    const manager = new UpdateManager({
      adapter: new NativeElectronUpdaterAdapter({
        client,
        feedUrl: "https://updates.example.com/",
        currentVersion: "1.0.0",
        isPackaged: true,
        platform: "win32",
      }),
      installer: new NativePlatformInstaller(client),
      currentVersion: "1.0.0",
      feedKind: "http",
      hooks: baseHooks(),
    });

    const result = await manager.check({ manual: true });
    expect(result.status).toBe("failed");
    expect(result.lastError).toMatch(/invalid/i);
  });

  it("reconcilePendingInstall claims installed only on exact version + health", async () => {
    let installedVersion: string | null = null;
    const manager = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "2.0.0"),
      installer: new FixturePlatformInstaller(
        await mkdtemp(join(tmpdir(), "tl-stage-")),
      ),
      currentVersion: "2.0.0",
      feedKind: "fixture",
      installLedger: {
        ...emptyInstallLedger("fixture"),
        pendingRestart: true,
        installInvocationAccepted: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath: "/tmp/bak",
        packagePath: "/tmp/pkg",
        backupCreatedAtMs: 1,
        installStartedAtMs: 2,
        installFinishedAtMs: 3,
      },
      hooks: baseHooks({
        pathExists: () => Promise.resolve(true),
        healthCheck: () => Promise.resolve(true),
        onInstalled: ({ version }) => {
          installedVersion = version;
          return Promise.resolve();
        },
      }),
    });

    const result = await manager.reconcilePendingInstall();
    expect(result.status).toBe("idle");
    expect(result.installLedger.claimedInstalled).toBe(true);
    expect(result.installLedger.pendingRestart).toBe(false);
    expect(result.installLedger.rollbackRequired).toBe(false);
    expect(installedVersion).toBe("2.0.0");
  });

  it("exact-version mismatch and failed health enter recovery-required", async () => {
    const mismatch = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "2.1.0"),
      installer: new FixturePlatformInstaller(
        await mkdtemp(join(tmpdir(), "tl-mismatch-")),
      ),
      currentVersion: "2.1.0",
      feedKind: "fixture",
      installLedger: {
        ...emptyInstallLedger("fixture"),
        pendingRestart: true,
        installInvocationAccepted: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath: "/tmp/bak",
        packagePath: "/tmp/pkg",
      },
      hooks: baseHooks({
        pathExists: () => Promise.resolve(true),
      }),
    });
    const mismatchResult = await mismatch.reconcilePendingInstall();
    expect(mismatchResult.status).toBe("rollback-required");
    expect(mismatchResult.installLedger.claimedInstalled).toBe(false);

    const unhealthy = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "2.0.0"),
      installer: new FixturePlatformInstaller(
        await mkdtemp(join(tmpdir(), "tl-health-")),
      ),
      currentVersion: "2.0.0",
      feedKind: "fixture",
      installLedger: {
        ...emptyInstallLedger("fixture"),
        pendingRestart: true,
        installInvocationAccepted: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath: "/tmp/bak",
        packagePath: "/tmp/pkg",
      },
      hooks: baseHooks({
        pathExists: () => Promise.resolve(true),
        healthCheck: () => Promise.resolve(false),
      }),
    });
    const healthResult = await unhealthy.reconcilePendingInstall();
    expect(healthResult.status).toBe("rollback-required");
    expect(healthResult.installLedger.claimedInstalled).toBe(false);
  });

  it("missing recovery material after restart requires recovery", async () => {
    const manager = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "2.0.0"),
      installer: new FixturePlatformInstaller(
        await mkdtemp(join(tmpdir(), "tl-missing-")),
      ),
      currentVersion: "2.0.0",
      feedKind: "fixture",
      installLedger: {
        ...emptyInstallLedger("fixture"),
        pendingRestart: true,
        installInvocationAccepted: false,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath: null,
        packagePath: null,
      },
      hooks: baseHooks(),
    });
    const result = await manager.reconcilePendingInstall();
    expect(result.status).toBe("rollback-required");
    expect(result.lastError).toMatch(/not accepted|recovery material/i);
  });

  it("rollback and openInstaller are busy-guarded and durable", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-recovery-"));
    const backupPath = join(root, "bak");
    const packagePath = join(root, "pkg.exe");
    await mkdirSafe(backupPath);
    await writeFile(packagePath, "installer-bytes");
    let restoreCalls = 0;
    let openCalls = 0;
    let recoveryHistory = 0;
    const manager = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "1.0.0"),
      installer: new FixturePlatformInstaller(join(root, "stage")),
      currentVersion: "1.0.0",
      feedKind: "http",
      installLedger: {
        ...emptyInstallLedger("http"),
        rollbackRequired: true,
        pendingRestart: false,
        installInvocationAccepted: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath,
        packagePath,
      },
      hooks: baseHooks({
        pathExists: async (path) => {
          try {
            await access(path);
            return true;
          } catch {
            return false;
          }
        },
        restoreFromBackup: (path) => {
          restoreCalls += 1;
          expect(path).toBe(backupPath);
          return Promise.resolve({ ok: true });
        },
        openPath: (path) => {
          openCalls += 1;
          expect(path).toBe(packagePath);
          return Promise.resolve("");
        },
        onRecovery: () => {
          recoveryHistory += 1;
          return Promise.resolve();
        },
      }),
    });
    expect(manager.snapshot().status).toBe("rollback-required");
    expect(manager.snapshot().canRollback).toBe(true);
    expect(manager.snapshot().canOpenInstaller).toBe(true);

    const rolled = await manager.rollback();
    expect(rolled.status).toBe("idle");
    expect(rolled.installLedger.lastRecoveryAction).toBe("rollback");
    expect(rolled.installLedger.lastRecoveryOutcome).toBe("succeeded");
    expect(restoreCalls).toBe(1);
    expect(recoveryHistory).toBe(1);

    // idempotent
    await manager.rollback();
    expect(restoreCalls).toBe(1);
    expect(recoveryHistory).toBe(1);

    // force recovery state again for openInstaller
    const manager2 = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "1.0.0"),
      installer: new FixturePlatformInstaller(join(root, "stage2")),
      currentVersion: "1.0.0",
      feedKind: "http",
      installLedger: {
        ...emptyInstallLedger("http"),
        rollbackRequired: true,
        installInvocationAccepted: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath,
        packagePath,
      },
      hooks: baseHooks({
        pathExists: async (path) => {
          try {
            await access(path);
            return true;
          } catch {
            return false;
          }
        },
        openPath: () => {
          openCalls += 1;
          return Promise.resolve("");
        },
        onRecovery: () => {
          recoveryHistory += 1;
          return Promise.resolve();
        },
      }),
    });
    const opened = await manager2.openInstaller();
    expect(opened.installLedger.lastRecoveryAction).toBe("open_installer");
    expect(opened.installLedger.claimedInstalled).toBe(false);
    expect(openCalls).toBe(1);
    expect(recoveryHistory).toBe(2);
    expect(manager2.snapshot().canOpenInstaller).toBe(false);
    await manager2.openInstaller();
    expect(openCalls).toBe(1);
    expect(recoveryHistory).toBe(2);
  });

  it("rejects downgrade and equal versions on check", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-update-eq-"));
    const equalFeed = join(root, "equal.json");
    const olderFeed = join(root, "older.json");
    await writeFile(equalFeed, JSON.stringify({ version: "1.0.0" }), "utf8");
    await writeFile(olderFeed, JSON.stringify({ version: "0.9.0" }), "utf8");

    const equalManager = new UpdateManager({
      adapter: new FixtureFeedAdapter(equalFeed, "1.0.0"),
      installer: new FixturePlatformInstaller(join(root, "stage")),
      currentVersion: "1.0.0",
      feedKind: "fixture",
      hooks: baseHooks(),
    });
    expect((await equalManager.check({ manual: true })).status).toBe("idle");
    expect(equalManager.snapshot().availableVersion).toBeNull();

    const olderManager = new UpdateManager({
      adapter: new FixtureFeedAdapter(olderFeed, "1.0.0"),
      installer: new FixturePlatformInstaller(join(root, "stage2")),
      currentVersion: "1.0.0",
      feedKind: "fixture",
      hooks: baseHooks(),
    });
    expect((await olderManager.check({ manual: true })).status).toBe("idle");
  });

  it("blocks install when unsaved drafts exist", async () => {
    const stageRoot = await mkdtemp(join(tmpdir(), "tl-draft-"));
    const manager = new UpdateManager({
      adapter: {
        kind: "fixture",
        check: () => Promise.resolve({ version: "2.0.0" }),
        download: () => Promise.resolve({ path: "pkg" }),
      },
      installer: new FixturePlatformInstaller(stageRoot),
      currentVersion: "1.0.0",
      feedKind: "fixture",
      hooks: baseHooks({
        hasUnsavedDrafts: () => Promise.resolve(true),
      }),
    });
    await manager.check({ manual: true });
    await manager.download();
    const result = await manager.install();
    expect(result.status).toBe("failed");
    expect(result.lastError).toMatch(/drafts/i);
    expect(result.installLedger.claimedInstalled).toBe(false);
  });

  it("supports disable and defer modes", async () => {
    const stageRoot = await mkdtemp(join(tmpdir(), "tl-mode-"));
    const manager = new UpdateManager({
      adapter: {
        kind: "fixture",
        check: () => Promise.resolve({ version: "2.0.0" }),
        download: () => Promise.resolve({ path: "pkg" }),
      },
      installer: new FixturePlatformInstaller(stageRoot),
      currentVersion: "1.0.0",
      mode: "disabled",
      feedKind: "fixture",
      hooks: baseHooks(),
    });
    expect((await manager.check()).status).toBe("disabled");
    manager.setMode("manual");
    manager.defer(Date.now() + 60_000);
    expect(manager.snapshot().status).toBe("deferred");
  });

  it("HttpFeedAdapter fixture helper validates digest and rejects credentials", async () => {
    expect(() =>
      assertHttpUrl("https://user:pass@example.com/feed.json"),
    ).toThrow(/credentials/i);

    const packageBody = Buffer.from("fake-package-bytes");
    const digest = await import("node:crypto").then((crypto) =>
      crypto.createHash("sha256").update(packageBody).digest("hex"),
    );
    const { baseUrl } = await listen((req, res) => {
      if (req.url === "/feed.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            version: "3.1.0",
            url: `${baseUrl}/pkg.bin`,
            sha256: digest,
          }),
        );
        return;
      }
      if (req.url === "/pkg.bin") {
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(packageBody.length),
        });
        res.end(packageBody);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const adapter = new HttpFeedAdapter(`${baseUrl}/feed.json`, "1.0.0");
    const release = await adapter.check();
    expect(release?.version).toBe("3.1.0");
    const downloaded = await adapter.download(release!, () => undefined);
    expect(downloaded.path).toBeTruthy();
  });

  it("createDefaultUpdateManager selects native http / fixture / none", async () => {
    const stageRoot = await mkdtemp(join(tmpdir(), "tl-default-"));
    const client = mockElectronUpdaterClient();
    const httpManager = createDefaultUpdateManager({
      feedUrl: "https://updates.example.com/feed.json",
      stageRoot,
      electronUpdaterClient: client,
      isPackaged: true,
      platform: "win32",
      hooks: baseHooks(),
    });
    expect(httpManager.snapshot().feedKind).toBe("http");

    const fixtureManager = createDefaultUpdateManager({
      feedUrl: "C:/feeds/local-feed.json",
      stageRoot,
      hooks: baseHooks(),
    });
    expect(fixtureManager.snapshot().feedKind).toBe("fixture");

    const noneManager = createDefaultUpdateManager({
      feedUrl: null,
      stageRoot,
      hooks: baseHooks(),
    });
    expect(noneManager.snapshot().feedKind).toBe("none");
    const noneCheck = await noneManager.check({ manual: true });
    expect(noneCheck.status).toBe("failed");
    expect(noneCheck.lastError).toMatch(/feed/i);
  });

  it("FixturePlatformInstaller writes markers; production native has no copy/marker fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-installer-"));
    const fixture = new FixturePlatformInstaller(join(root, "fixture"));
    const fixtureResult = await fixture.prepareInstall("virtual.pkg", {
      version: "1.2.3",
    });
    const fixtureBody = await readFile(fixtureResult.stagedPath!, "utf8");
    expect(fixtureBody).toMatch(/1\.2\.3/);
    fixtureResult.invoke();

    const client = mockElectronUpdaterClient();
    const native = new NativePlatformInstaller(client);
    const prepared = await native.prepareInstall("/tmp/real.exe", {
      version: "4.5.6",
    });
    expect(prepared.stagedPath).toBeNull();
    prepared.invoke();
    expect(client.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("feed adapters do not expose install()", () => {
    const fixture = new FixtureFeedAdapter(null, "1.0.0");
    const http = new HttpFeedAdapter("https://example.com/feed.json", "1.0.0");
    expect("install" in fixture).toBe(false);
    expect("install" in http).toBe(false);
  });

  it("serializes public actions as FIFO without overlap and does not poison later actions", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let checkCount = 0;
    const manager = new UpdateManager({
      adapter: {
        kind: "fixture",
        check: async () => {
          checkCount += 1;
          const id = checkCount;
          order.push(`check-${id}-start`);
          if (id === 1) {
            await firstGate;
          }
          order.push(`check-${id}-end`);
          if (id === 1) {
            throw new Error("first check failed");
          }
          return null;
        },
        download: () => Promise.resolve({ path: "pkg" }),
      },
      installer: new FixturePlatformInstaller(
        await mkdtemp(join(tmpdir(), "tl-fifo-")),
      ),
      currentVersion: "1.0.0",
      feedKind: "fixture",
      hooks: baseHooks(),
    });

    const first = manager.check({ manual: true });
    const second = manager.check({ manual: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["check-1-start"]);
    releaseFirst();
    await expect(first).resolves.toMatchObject({ status: "failed" });
    await expect(second).resolves.toMatchObject({ status: "idle" });
    expect(order).toEqual([
      "check-1-start",
      "check-1-end",
      "check-2-start",
      "check-2-end",
    ]);
  });

  it("fails closed on invalid package validation without invoking the installer", async () => {
    const invoke = vi.fn();
    const manager = new UpdateManager({
      adapter: {
        kind: "fixture",
        check: () => Promise.resolve({ version: "2.0.0" }),
        download: () => Promise.resolve({ path: "pkg" }),
      },
      installer: {
        prepareInstall: () =>
          Promise.resolve({
            packagePath: "pkg",
            packageIdentity: "bad",
            stagedPath: null,
            unsigned: true,
            invoke,
          }),
      },
      currentVersion: "1.0.0",
      feedKind: "fixture",
      hooks: baseHooks({
        validatePackage: () =>
          Promise.resolve({ ok: false, message: "package invalid" }),
      }),
    });
    await manager.check({ manual: true });
    await manager.download();
    const result = await manager.install();
    expect(result.status).toBe("failed");
    expect(result.lastError).toMatch(/package invalid/i);
    expect(result.installLedger.claimedInstalled).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed when backup validation is missing or invalid before prepare", async () => {
    const invoke = vi.fn();
    const prepareInstall = vi.fn(() =>
      Promise.resolve({
        packagePath: "pkg",
        packageIdentity: "id",
        stagedPath: null,
        unsigned: true,
        invoke,
      }),
    );
    const backupPath = join(
      await mkdtemp(join(tmpdir(), "tl-bak-val-")),
      "bak",
    );
    await mkdirSafe(backupPath);

    // baseHooks always sets validateBackup; force-remove it:
    const hooksNoBackup = baseHooks({
      createBackup: () => Promise.resolve({ path: backupPath }),
      pathExists: () => Promise.resolve(true),
    });
    delete (hooksNoBackup as { validateBackup?: unknown }).validateBackup;
    const managerMissing = new UpdateManager({
      adapter: {
        kind: "fixture",
        check: () => Promise.resolve({ version: "2.0.0" }),
        download: () => Promise.resolve({ path: "pkg" }),
      },
      installer: { prepareInstall },
      currentVersion: "1.0.0",
      feedKind: "fixture",
      hooks: hooksNoBackup,
    });
    await managerMissing.check({ manual: true });
    await managerMissing.download();
    const missingResult = await managerMissing.install();
    expect(missingResult.status).toBe("failed");
    expect(missingResult.lastError).toMatch(
      /backup validation is unavailable/i,
    );
    expect(missingResult.installLedger.claimedInstalled).toBe(false);
    expect(missingResult.installLedger.rollbackRequired).toBe(false);
    expect(missingResult.canOpenInstaller).toBe(false);
    expect(prepareInstall).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();

    const managerInvalid = new UpdateManager({
      adapter: {
        kind: "fixture",
        check: () => Promise.resolve({ version: "2.0.0" }),
        download: () => Promise.resolve({ path: "pkg" }),
      },
      installer: { prepareInstall },
      currentVersion: "1.0.0",
      feedKind: "fixture",
      hooks: baseHooks({
        createBackup: () => Promise.resolve({ path: backupPath }),
        pathExists: () => Promise.resolve(true),
        validateBackup: () =>
          Promise.resolve({ ok: false, message: "backup corrupt" }),
      }),
    });
    await managerInvalid.check({ manual: true });
    await managerInvalid.download();
    const invalidResult = await managerInvalid.install();
    expect(invalidResult.status).toBe("failed");
    expect(invalidResult.lastError).toMatch(/backup corrupt/i);
    expect(invalidResult.installLedger.claimedInstalled).toBe(false);
    expect(invalidResult.installLedger.rollbackRequired).toBe(false);
    expect(invalidResult.canOpenInstaller).toBe(false);
    expect(prepareInstall).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("records rollback-required when native acceptance probe is false", async () => {
    const backupPath = join(await mkdtemp(join(tmpdir(), "tl-probe-")), "bak");
    await mkdirSafe(backupPath);
    const client = mockElectronUpdaterClient({
      version: "2.1.0",
      wasInstallInvocationAccepted: () => false,
    });
    const manager = new UpdateManager({
      adapter: new NativeElectronUpdaterAdapter({
        client,
        feedUrl: "https://updates.example.com/",
        currentVersion: "1.0.0",
        isPackaged: true,
        platform: "win32",
      }),
      installer: new NativePlatformInstaller(client),
      currentVersion: "1.0.0",
      feedKind: "http",
      hooks: baseHooks({
        createBackup: () => Promise.resolve({ path: backupPath }),
        pathExists: () => Promise.resolve(true),
      }),
    });
    await manager.check({ manual: true });
    await manager.download();
    const result = await manager.install();
    expect(result.status).toBe("rollback-required");
    expect(result.installLedger.claimedInstalled).toBe(false);
    expect(result.installLedger.installInvocationAccepted).toBe(false);
    expect(result.lastError).toMatch(/rejected/i);
  });

  it("HTTP reconcile does not require retained package path after restart", async () => {
    let installedVersion: string | null = null;
    const manager = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "2.0.0"),
      installer: new FixturePlatformInstaller(
        await mkdtemp(join(tmpdir(), "tl-http-recon-")),
      ),
      currentVersion: "2.0.0",
      feedKind: "http",
      installLedger: {
        ...emptyInstallLedger("http"),
        pendingRestart: true,
        installInvocationAccepted: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath: "/tmp/bak",
        packagePath: null,
        stagedPath: null,
        backupCreatedAtMs: 1,
        installStartedAtMs: 2,
        installFinishedAtMs: 3,
      },
      hooks: baseHooks({
        pathExists: (path) => Promise.resolve(path === "/tmp/bak"),
        healthCheck: () => Promise.resolve(true),
        onInstalled: ({ version }) => {
          installedVersion = version;
          return Promise.resolve();
        },
      }),
    });
    const result = await manager.reconcilePendingInstall();
    expect(result.status).toBe("idle");
    expect(result.installLedger.claimedInstalled).toBe(true);
    expect(installedVersion).toBe("2.0.0");
  });

  it("fixture reconcile still requires retained package material", async () => {
    const manager = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "2.0.0"),
      installer: new FixturePlatformInstaller(
        await mkdtemp(join(tmpdir(), "tl-fix-recon-")),
      ),
      currentVersion: "2.0.0",
      feedKind: "fixture",
      installLedger: {
        ...emptyInstallLedger("fixture"),
        pendingRestart: true,
        installInvocationAccepted: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath: "/tmp/bak",
        packagePath: null,
        stagedPath: null,
      },
      hooks: baseHooks({
        pathExists: (path) => Promise.resolve(path === "/tmp/bak"),
      }),
    });
    const result = await manager.reconcilePendingInstall();
    expect(result.status).toBe("rollback-required");
    expect(result.installLedger.claimedInstalled).toBe(false);
    expect(result.lastError).toMatch(/recovery material/i);
  });

  it("validates a retained package before opening it for manual recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-open-validate-"));
    const backupPath = join(root, "bak");
    const packagePath = join(root, "pkg.exe");
    await mkdirSafe(backupPath);
    await writeFile(packagePath, "installer-bytes");
    const openPath = vi.fn(() => Promise.resolve(""));
    const manager = new UpdateManager({
      adapter: new FixtureFeedAdapter(null, "1.0.0"),
      installer: new FixturePlatformInstaller(join(root, "stage")),
      currentVersion: "1.0.0",
      feedKind: "http",
      installLedger: {
        ...emptyInstallLedger("http"),
        rollbackRequired: true,
        installInvocationAccepted: true,
        targetVersion: "2.0.0",
        previousVersion: "1.0.0",
        backupPath,
        packagePath,
      },
      hooks: baseHooks({
        pathExists: () => Promise.resolve(true),
        validatePackage: () =>
          Promise.resolve({ ok: false, message: "package is untrusted" }),
        openPath,
      }),
    });

    const result = await manager.openInstaller();
    expect(result.lastError).toMatch(/untrusted/i);
    expect(result.installLedger.lastRecoveryOutcome).toBe("failed");
    expect(openPath).not.toHaveBeenCalled();
  });
});

async function mkdirSafe(path: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path, { recursive: true });
}
