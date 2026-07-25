import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

import type {
  UpdateFeedKind,
  UpdateInstallLedger,
  UpdateMode,
  UpdateServiceStatus,
  UpdateStatusSnapshot,
} from "../shared/product-shell.js";

export const HTTP_FEED_MAX_BYTES = 256 * 1024;
export const HTTP_FEED_TIMEOUT_MS = 15_000;
export const HTTP_FEED_MAX_REDIRECTS = 3;
export const HTTP_PACKAGE_MAX_BYTES = 200 * 1024 * 1024;

const requireFromUpdaterModule = createRequire(import.meta.url);

export interface UpdateFeedRelease {
  version: string;
  notes?: string | undefined;
  url?: string | undefined;
  sha256?: string | undefined;
}

/** Feed adapters only discover and download packages — install is PlatformInstaller. */
export interface UpdateFeedAdapter {
  readonly kind: UpdateFeedKind;
  check(): Promise<UpdateFeedRelease | null>;
  download(
    release: UpdateFeedRelease,
    onProgress: (percent: number) => void,
  ): Promise<{ path: string }>;
}

export interface PreparedPlatformInstall {
  packagePath: string;
  packageIdentity: string;
  stagedPath: string | null;
  unsigned: boolean;
  /**
   * Invoke only after installInvocationAccepted is persisted.
   * electron-updater quitAndInstall is synchronous void; do not model Promise/boolean acceptance.
   */
  invoke(): void;
}

/** Prepares a real or fixture install; must not claim installed. */
export interface PlatformInstaller {
  prepareInstall(
    packagePath: string,
    release: UpdateFeedRelease,
  ): Promise<PreparedPlatformInstall>;
}

export interface ElectronUpdaterProgress {
  percent: number;
}

export interface ElectronUpdaterCheckResult {
  updateInfo: {
    version: string;
    releaseNotes?: string | null | undefined;
  };
}

/**
 * Narrow injected boundary around electron-updater so unit tests never quit
 * Electron or launch a real installer.
 */
export interface ElectronUpdaterClient {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<ElectronUpdaterCheckResult | null>;
  downloadUpdate(): Promise<string[]>;
  /**
   * electron-updater quitAndInstall returns void. Call synchronously and
   * inspect wasInstallInvocationAccepted immediately on platforms that expose it.
   */
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
  /**
   * electron-updater's Windows implementation exposes this state at runtime
   * even though it is protected in its TypeScript declarations. A false
   * value means the native installer rejected the invocation; macOS clients
   * may omit the probe because Squirrel's API has no equivalent state.
   */
  wasInstallInvocationAccepted?(): boolean;
  on(
    event: "download-progress",
    listener: (info: ElectronUpdaterProgress) => void,
  ): void;
  removeListener(
    event: "download-progress",
    listener: (info: ElectronUpdaterProgress) => void,
  ): void;
}

export interface UpdateManagerHooks {
  createBackup(): Promise<{ path: string }>;
  hasUnsavedDrafts(): Promise<boolean>;
  healthCheck(): Promise<boolean>;
  pathExists?(path: string): Promise<boolean>;
  validateBackup?(
    path: string,
  ):
    | Promise<{ ok: boolean; message?: string | undefined }>
    | { ok: boolean; message?: string | undefined };
  validatePackage?(
    path: string,
  ):
    | Promise<{ ok: boolean; message?: string | undefined }>
    | { ok: boolean; message?: string | undefined };
  restoreFromBackup?(
    path: string,
  ): Promise<{ ok: boolean; message?: string | undefined }>;
  openPath?(path: string): Promise<string>;
  onStatus?(status: UpdateStatusSnapshot): void;
  persistLedger?(ledger: UpdateInstallLedger): Promise<void> | void;
  onInstalled?(info: {
    version: string;
    ledger: UpdateInstallLedger;
  }): Promise<void> | void;
  onRecovery?(info: {
    action: "rollback" | "open_installer";
    outcome: "succeeded" | "failed";
    version: string;
    detail?: string;
  }): Promise<void> | void;
}

export function emptyInstallLedger(
  feedKind: UpdateFeedKind = "none",
): UpdateInstallLedger {
  return {
    feedKind,
    backupCreatedAtMs: null,
    backupPath: null,
    installStartedAtMs: null,
    installFinishedAtMs: null,
    healthCheckedAtMs: null,
    rollbackRequired: false,
    packagePath: null,
    packageIdentity: null,
    installInvocationAccepted: false,
    claimedInstalled: false,
    pendingRestart: false,
    targetVersion: null,
    previousVersion: null,
    stagedPath: null,
    lastRecoveryAction: null,
    lastRecoveryAtMs: null,
    lastRecoveryOutcome: null,
    recoveryHistoryRecorded: false,
  };
}

/**
 * Compare two SemVer 2.0.0 versions. Throws when either input is invalid.
 * Large numeric prerelease identifiers are compared with BigInt.
 */
export function compareSemVer(a: string, b: string): number {
  const pa = parseSemVer(a);
  const pb = parseSemVer(b);
  if (!pa || !pb) {
    throw new Error(`Invalid semantic version: ${JSON.stringify(!pa ? a : b)}`);
  }
  for (let i = 0; i < 3; i += 1) {
    const leftCore = pa.core[i] ?? 0n;
    const rightCore = pb.core[i] ?? 0n;
    if (leftCore < rightCore) return -1;
    if (leftCore > rightCore) return 1;
  }
  const aPre = pa.prerelease;
  const bPre = pb.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;
  const len = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < len; i += 1) {
    const left = aPre[i];
    const right = bPre[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNum = /^\d+$/u.test(left);
    const rightNum = /^\d+$/u.test(right);
    if (leftNum && rightNum) {
      const leftBig = BigInt(left);
      const rightBig = BigInt(right);
      if (leftBig < rightBig) return -1;
      if (leftBig > rightBig) return 1;
      continue;
    }
    if (leftNum) return -1;
    if (rightNum) return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

export function isStrictlyNewerVersion(
  candidate: string,
  current: string,
): boolean {
  return compareSemVer(candidate, current) > 0;
}

export function isValidSemVer(value: string): boolean {
  return parseSemVer(value) !== null;
}

/** Strict SemVer 2.0.0 parser. No leading `v`, no lexical fallback. */
export function parseSemVer(value: string): {
  core: [bigint, bigint, bigint];
  prerelease: string[];
} | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length === 0) return null;
  if (/^v/iu.test(trimmed)) return null;
  const match =
    /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z.-]+))?(?:\+(?<build>[0-9A-Za-z.-]+))?$/u.exec(
      trimmed,
    );
  if (!match?.groups) return null;
  const { major, minor, patch: patchVersion } = match.groups;
  if (!major || !minor || !patchVersion) return null;
  const prerelease: string[] = [];
  if (match.groups.pre) {
    const parts = match.groups.pre.split(".");
    for (const part of parts) {
      if (part.length === 0) return null;
      if (/^\d+$/u.test(part)) {
        if (part.length > 1 && part.startsWith("0")) return null;
      } else if (!/^[0-9A-Za-z-]+$/u.test(part)) {
        return null;
      }
      prerelease.push(part);
    }
  }
  if (match.groups.build) {
    for (const part of match.groups.build.split(".")) {
      if (part.length === 0) return null;
      if (!/^[0-9A-Za-z-]+$/u.test(part)) return null;
    }
  }
  return {
    core: [BigInt(major), BigInt(minor), BigInt(patchVersion)],
    prerelease,
  };
}

function hasSigningCredentials(): boolean {
  return Boolean(
    process.env.CSC_LINK ||
    process.env.APPLE_ID ||
    process.env.TRANSLUNAR_SIGNING_IDENTITY,
  );
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultPackageValidation(
  path: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
      return {
        ok: false,
        message: "Downloaded update package is not a non-empty regular file.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Downloaded update package is missing." };
  }
}

/**
 * Lazy-load the real electron-updater autoUpdater only when the production
 * HTTP path first configures it. Fixture tests inject a mock client instead.
 */
export function createLazyElectronUpdaterClient(): ElectronUpdaterClient {
  type Loaded = ElectronUpdaterClient;
  let loaded: Loaded | null = null;
  const get = (): Loaded => {
    if (loaded) return loaded;
    const mod = requireFromUpdaterModule("electron-updater") as {
      autoUpdater: Loaded;
    };
    loaded = mod.autoUpdater;
    return loaded;
  };
  return {
    get autoDownload() {
      return get().autoDownload;
    },
    set autoDownload(value: boolean) {
      get().autoDownload = value;
    },
    get autoInstallOnAppQuit() {
      return get().autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(value: boolean) {
      get().autoInstallOnAppQuit = value;
    },
    setFeedURL(options) {
      get().setFeedURL(options);
    },
    checkForUpdates: () => get().checkForUpdates(),
    downloadUpdate: () => get().downloadUpdate(),
    quitAndInstall: (isSilent, isForceRunAfter) =>
      get().quitAndInstall(isSilent, isForceRunAfter),
    wasInstallInvocationAccepted: () => {
      const updater = get() as Loaded & { quitAndInstallCalled?: boolean };
      return typeof updater.quitAndInstallCalled === "boolean"
        ? updater.quitAndInstallCalled
        : true;
    },
    on: (event, listener) => get().on(event, listener),
    removeListener: (event, listener) => get().removeListener(event, listener),
  };
}

/** Production HTTP(S) feed via electron-updater (check + download only). */
export class NativeElectronUpdaterAdapter implements UpdateFeedAdapter {
  readonly kind: UpdateFeedKind = "http";
  readonly #client: ElectronUpdaterClient;
  readonly #feedUrl: string;
  readonly #currentVersion: string;
  readonly #isPackaged: boolean;
  readonly #platform: string;
  #configured = false;

  constructor(options: {
    client: ElectronUpdaterClient;
    feedUrl: string;
    currentVersion: string;
    isPackaged: boolean;
    platform: string;
  }) {
    this.#client = options.client;
    this.#feedUrl = options.feedUrl;
    this.#currentVersion = options.currentVersion;
    this.#isPackaged = options.isPackaged;
    this.#platform = options.platform;
  }

  #configure(): void {
    if (this.#configured) return;
    if (!this.#isPackaged) {
      throw new Error("Application updates require a packaged build.");
    }
    if (this.#platform !== "win32" && this.#platform !== "darwin") {
      throw new Error(
        "Application updates are only supported on Windows and macOS.",
      );
    }
    assertHttpUrl(this.#feedUrl);
    this.#client.autoDownload = false;
    this.#client.autoInstallOnAppQuit = false;
    this.#client.setFeedURL({ provider: "generic", url: this.#feedUrl });
    this.#configured = true;
  }

  async check(): Promise<UpdateFeedRelease | null> {
    this.#configure();
    if (!isValidSemVer(this.#currentVersion)) {
      throw new Error("Current application version is not valid SemVer.");
    }
    const result = await this.#client.checkForUpdates();
    const version = result?.updateInfo?.version ?? "";
    if (!version) return null;
    if (!isValidSemVer(version)) {
      throw new Error("Update feed version is missing or invalid.");
    }
    if (!isStrictlyNewerVersion(version, this.#currentVersion)) {
      return null;
    }
    const notes = result?.updateInfo?.releaseNotes;
    return {
      version,
      notes: typeof notes === "string" ? notes : undefined,
    };
  }

  async download(
    release: UpdateFeedRelease,
    onProgress: (percent: number) => void,
  ): Promise<{ path: string }> {
    this.#configure();
    if (!isValidSemVer(release.version)) {
      throw new Error("Update release version is invalid.");
    }
    const listener = (info: ElectronUpdaterProgress) => {
      const percent = Number(info.percent);
      if (Number.isFinite(percent)) {
        onProgress(Math.max(0, Math.min(99, Math.floor(percent))));
      }
    };
    this.#client.on("download-progress", listener);
    try {
      const paths = await this.#client.downloadUpdate();
      onProgress(100);
      const path = paths?.[0];
      if (
        typeof path !== "string" ||
        !path ||
        path.trim() !== path ||
        path.includes("\0")
      ) {
        throw new Error("Update download produced no package path.");
      }
      return { path };
    } finally {
      this.#client.removeListener("download-progress", listener);
    }
  }
}

/** Production installer: prepares quitAndInstall; never claims scheduling otherwise. */
export class NativePlatformInstaller implements PlatformInstaller {
  readonly #client: ElectronUpdaterClient;
  #invoked = false;

  constructor(client: ElectronUpdaterClient) {
    this.#client = client;
  }

  prepareInstall(
    packagePath: string,
    release: UpdateFeedRelease,
  ): Promise<PreparedPlatformInstall> {
    if (
      !packagePath ||
      packagePath.trim() !== packagePath ||
      packagePath.includes("\0")
    ) {
      return Promise.reject(new Error("Invalid update package path."));
    }
    if (!isValidSemVer(release.version)) {
      return Promise.reject(new Error("Invalid update release version."));
    }
    return Promise.resolve({
      packagePath,
      packageIdentity: `electron-updater:${release.version}:${packagePath}`,
      stagedPath: null,
      unsigned: !hasSigningCredentials(),
      invoke: () => {
        if (this.#invoked) {
          throw new Error("quitAndInstall may only be invoked once.");
        }
        this.#invoked = true;
        // Native contract: void return; inspect acceptance probe immediately.
        this.#client.quitAndInstall(false, true);
        if (this.#client.wasInstallInvocationAccepted?.() === false) {
          throw new Error("Native updater rejected quitAndInstall invocation.");
        }
      },
    });
  }
}

/** Inactive feed: never reports up-to-date success. */
export class InactiveUpdateAdapter implements UpdateFeedAdapter {
  readonly kind: UpdateFeedKind = "none";

  check(): Promise<UpdateFeedRelease | null> {
    return Promise.reject(new Error("No update feed is configured."));
  }

  download(): Promise<{ path: string }> {
    return Promise.reject(new Error("No update feed is configured."));
  }
}

export class FixtureFeedAdapter implements UpdateFeedAdapter {
  readonly kind: UpdateFeedKind = "fixture";
  readonly #feedPath: string | null;
  readonly #currentVersion: string;

  constructor(feedPath: string | null, currentVersion: string) {
    this.#feedPath = feedPath;
    this.#currentVersion = currentVersion;
  }

  async check(): Promise<UpdateFeedRelease | null> {
    if (!this.#feedPath) return null;
    const raw = await readFile(this.#feedPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const version = typeof parsed.version === "string" ? parsed.version : "";
    if (!isValidSemVer(version)) {
      throw new Error("Update feed version is missing or invalid.");
    }
    if (!isValidSemVer(this.#currentVersion)) {
      throw new Error("Current application version is not valid SemVer.");
    }
    if (!isStrictlyNewerVersion(version, this.#currentVersion)) {
      return null;
    }
    return {
      version,
      notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
      url: typeof parsed.url === "string" ? parsed.url : undefined,
      sha256: typeof parsed.sha256 === "string" ? parsed.sha256 : undefined,
    };
  }

  download(
    release: UpdateFeedRelease,
    onProgress: (percent: number) => void,
  ): Promise<{ path: string }> {
    onProgress(10);
    onProgress(55);
    onProgress(100);
    const token = createHash("sha256")
      .update(release.version)
      .digest("hex")
      .slice(0, 12);
    return Promise.resolve({ path: `fixture-update-${token}.pkg` });
  }
}

/**
 * Bounded JSON HTTP adapter kept for deterministic fixture/unit tests.
 * Production createDefaultUpdateManager does not select this for HTTP feeds.
 */
export class HttpFeedAdapter implements UpdateFeedAdapter {
  readonly kind: UpdateFeedKind = "http";
  readonly #feedUrl: string;
  readonly #currentVersion: string;
  readonly #fetchText: typeof fetchTextBounded;
  readonly #downloadFile: typeof downloadFileBounded;

  constructor(
    feedUrl: string,
    currentVersion: string,
    options?: {
      fetchText?: typeof fetchTextBounded;
      downloadFile?: typeof downloadFileBounded;
    },
  ) {
    this.#feedUrl = feedUrl;
    this.#currentVersion = currentVersion;
    this.#fetchText = options?.fetchText ?? fetchTextBounded;
    this.#downloadFile = options?.downloadFile ?? downloadFileBounded;
  }

  async check(): Promise<UpdateFeedRelease | null> {
    assertHttpUrl(this.#feedUrl);
    const body = await this.#fetchText(this.#feedUrl, {
      maxBytes: HTTP_FEED_MAX_BYTES,
      timeoutMs: HTTP_FEED_TIMEOUT_MS,
      maxRedirects: HTTP_FEED_MAX_REDIRECTS,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("Update feed is not valid JSON.");
    }
    if (!isRecord(parsed)) {
      throw new Error("Update feed payload is not an object.");
    }
    const version = typeof parsed.version === "string" ? parsed.version : "";
    if (!isValidSemVer(version)) {
      throw new Error("Update feed version is missing or invalid.");
    }
    if (!isValidSemVer(this.#currentVersion)) {
      throw new Error("Current application version is not valid SemVer.");
    }
    if (!isStrictlyNewerVersion(version, this.#currentVersion)) {
      return null;
    }
    const packageUrl =
      typeof parsed.url === "string"
        ? parsed.url
        : typeof parsed.packageUrl === "string"
          ? parsed.packageUrl
          : "";
    if (!packageUrl) {
      throw new Error("Update feed is missing a package URL.");
    }
    assertHttpUrl(packageUrl);
    const sha256 =
      typeof parsed.sha256 === "string"
        ? parsed.sha256.trim().toLowerCase()
        : undefined;
    if (sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error("Update feed sha256 is invalid.");
    }
    return {
      version,
      notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
      url: packageUrl,
      ...(sha256 === undefined ? {} : { sha256 }),
    };
  }

  async download(
    release: UpdateFeedRelease,
    onProgress: (percent: number) => void,
  ): Promise<{ path: string }> {
    if (!release.url) {
      throw new Error("Update package URL is missing.");
    }
    assertHttpUrl(release.url);
    const dir = join(tmpdir(), `translunar-update-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const target = join(dir, `package-${sanitizeVersion(release.version)}.bin`);
    await this.#downloadFile(release.url, target, {
      maxBytes: HTTP_PACKAGE_MAX_BYTES,
      timeoutMs: HTTP_FEED_TIMEOUT_MS,
      maxRedirects: HTTP_FEED_MAX_REDIRECTS,
      onProgress,
    });
    if (release.sha256) {
      const digest = createHash("sha256")
        .update(await readFile(target))
        .digest("hex");
      if (digest !== release.sha256) {
        throw new Error(
          "Downloaded update package failed sha256 verification.",
        );
      }
    }
    return { path: target };
  }
}

/** Fixture installer: JSON marker only here — never used for production HTTP. */
export class FixturePlatformInstaller implements PlatformInstaller {
  readonly #stageRoot: string;

  constructor(stageRoot: string) {
    this.#stageRoot = stageRoot;
  }

  async prepareInstall(
    packagePath: string,
    release: UpdateFeedRelease,
  ): Promise<PreparedPlatformInstall> {
    await mkdir(this.#stageRoot, { recursive: true });
    const stagedPath = join(
      this.#stageRoot,
      `fixture-${sanitizeVersion(release.version)}.staged`,
    );
    await writeFile(
      stagedPath,
      JSON.stringify(
        {
          packagePath,
          version: release.version,
          stagedAtMs: Date.now(),
        },
        null,
        2,
      ),
      "utf8",
    );
    return {
      packagePath: stagedPath,
      packageIdentity: `fixture:${release.version}:${stagedPath}`,
      stagedPath,
      unsigned: !hasSigningCredentials(),
      invoke: () => {
        // Fixture path does not invoke a real OS installer.
      },
    };
  }
}

export class UpdateManager {
  #mode: UpdateMode;
  #status: UpdateServiceStatus = "idle";
  #available: UpdateFeedRelease | null = null;
  #packagePath: string | null = null;
  #lastCheckedAtMs: number | null = null;
  #lastError: string | null = null;
  #downloadPercent: number | null = null;
  #deferredUntilMs: number | null;
  #unsigned = true;
  #installLedger: UpdateInstallLedger;
  /** FIFO tail so check/download/install/reconcile/rollback/openInstaller never overlap. */
  #activeAction: Promise<void> = Promise.resolve();
  #recoveryBusy = false;
  readonly #adapter: UpdateFeedAdapter;
  readonly #installer: PlatformInstaller;
  readonly #hooks: UpdateManagerHooks;
  readonly #currentVersion: string;
  readonly #feedUrl: string | null;
  readonly #feedKind: UpdateFeedKind;

  constructor(options: {
    adapter: UpdateFeedAdapter;
    installer: PlatformInstaller;
    hooks: UpdateManagerHooks;
    mode?: UpdateMode;
    deferredUntilMs?: number | null;
    currentVersion?: string;
    feedUrl?: string | null;
    feedKind?: UpdateFeedKind;
    installLedger?: UpdateInstallLedger | null;
  }) {
    this.#adapter = options.adapter;
    this.#installer = options.installer;
    this.#hooks = options.hooks;
    this.#mode = options.mode ?? "manual";
    this.#deferredUntilMs = options.deferredUntilMs ?? null;
    this.#currentVersion = options.currentVersion ?? app.getVersion();
    this.#feedUrl = options.feedUrl ?? null;
    this.#feedKind = options.feedKind ?? options.adapter.kind;
    if (
      options.installLedger &&
      options.installLedger.feedKind !== this.#feedKind
    ) {
      this.#installLedger = {
        ...emptyInstallLedger(this.#feedKind),
        rollbackRequired: true,
      };
      this.#lastError =
        "Persisted update ledger does not match the configured update feed.";
    } else {
      this.#installLedger = options.installLedger
        ? {
            ...emptyInstallLedger(this.#feedKind),
            ...options.installLedger,
            feedKind: this.#feedKind,
            ...(this.#feedKind === "http" ? { stagedPath: null } : {}),
          }
        : emptyInstallLedger(this.#feedKind);
    }
    if (this.#mode === "disabled") this.#status = "disabled";
    else if (this.#installLedger.pendingRestart) {
      this.#status = "pending-restart";
    } else if (this.#installLedger.rollbackRequired) {
      this.#status = "rollback-required";
    }
  }

  get feedKind(): UpdateFeedKind {
    return this.#feedKind;
  }

  get currentVersion(): string {
    return this.#currentVersion;
  }

  snapshot(): UpdateStatusSnapshot {
    const packagePath =
      this.#installLedger.packagePath ?? this.#installLedger.stagedPath;
    return {
      status: this.#status,
      mode: this.#mode,
      currentVersion: this.#currentVersion,
      availableVersion: this.#available?.version ?? null,
      feedUrl: this.#feedUrl,
      deferredUntilMs: this.#deferredUntilMs,
      lastCheckedAtMs: this.#lastCheckedAtMs,
      lastError: this.#lastError,
      downloadPercent: this.#downloadPercent,
      requiresBackup: true,
      unsigned: this.#unsigned,
      feedKind: this.#feedKind,
      installLedger: { ...this.#installLedger },
      canRollback:
        this.#status === "rollback-required" &&
        Boolean(this.#installLedger.backupPath) &&
        !this.#recoveryBusy &&
        !(
          this.#installLedger.lastRecoveryAction === "rollback" &&
          this.#installLedger.lastRecoveryOutcome === "succeeded"
        ),
      canOpenInstaller:
        (this.#status === "rollback-required" ||
          this.#status === "pending-restart") &&
        Boolean(packagePath) &&
        !this.#recoveryBusy &&
        !(
          this.#installLedger.lastRecoveryAction === "open_installer" &&
          this.#installLedger.lastRecoveryOutcome === "succeeded"
        ),
      recoveryBusy: this.#recoveryBusy,
    };
  }

  setMode(mode: UpdateMode): UpdateStatusSnapshot {
    this.#mode = mode;
    if (mode === "disabled") {
      this.#status = "disabled";
      this.#available = null;
    } else if (this.#status === "disabled") {
      this.#status = "idle";
    }
    return this.#emit();
  }

  defer(untilMs: number): UpdateStatusSnapshot {
    if (!Number.isSafeInteger(untilMs) || untilMs < 0) {
      throw new Error("Invalid update defer time.");
    }
    this.#deferredUntilMs = untilMs;
    this.#status = "deferred";
    return this.#emit();
  }

  clearDefer(): UpdateStatusSnapshot {
    this.#deferredUntilMs = null;
    if (this.#status === "deferred") {
      this.#status = this.#mode === "disabled" ? "disabled" : "idle";
    }
    return this.#emit();
  }

  /**
   * Serialize public async actions. A rejected action must not poison later work.
   */
  #enqueueAction<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#activeAction.then(operation, operation);
    this.#activeAction = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #requireValidatedBackup(backupPath: string): Promise<void> {
    if (!this.#hooks.validateBackup) {
      throw new Error("Pre-update backup validation is unavailable.");
    }
    const result = await this.#hooks.validateBackup(backupPath);
    if (!result.ok) {
      throw new Error(
        result.message ?? "Pre-update backup verification failed.",
      );
    }
  }

  async #requireValidatedPackage(packagePath: string): Promise<void> {
    const validate = this.#hooks.validatePackage ?? defaultPackageValidation;
    const result = await validate(packagePath);
    if (!result.ok) {
      throw new Error(
        result.message ?? "Downloaded update package failed validation.",
      );
    }
  }

  async check(options?: { manual?: boolean }): Promise<UpdateStatusSnapshot> {
    return this.#enqueueAction(() => this.#checkUnlocked(options));
  }

  async #checkUnlocked(options?: {
    manual?: boolean;
  }): Promise<UpdateStatusSnapshot> {
    if (this.#mode === "disabled" && !options?.manual) {
      this.#status = "disabled";
      return this.#emit();
    }
    if (
      this.#deferredUntilMs &&
      Date.now() < this.#deferredUntilMs &&
      !options?.manual
    ) {
      this.#status = "deferred";
      return this.#emit();
    }
    this.#status = "checking";
    this.#lastError = null;
    this.#emit();
    try {
      const release = await this.#adapter.check();
      this.#lastCheckedAtMs = Date.now();
      if (!release) {
        this.#available = null;
        this.#status = "idle";
      } else if (
        !isStrictlyNewerVersion(release.version, this.#currentVersion)
      ) {
        this.#available = null;
        this.#status = "idle";
        this.#lastError = null;
      } else {
        this.#available = release;
        this.#status = "available";
      }
      return this.#emit();
    } catch (error) {
      this.#status = "failed";
      this.#lastError =
        error instanceof Error ? error.message : "Update check failed.";
      return this.#emit();
    }
  }

  async download(): Promise<UpdateStatusSnapshot> {
    return this.#enqueueAction(() => this.#downloadUnlocked());
  }

  async #downloadUnlocked(): Promise<UpdateStatusSnapshot> {
    if (!this.#available) {
      this.#status = "failed";
      this.#lastError = "No update is available to download.";
      return this.#emit();
    }
    this.#status = "downloading";
    this.#downloadPercent = 0;
    this.#emit();
    try {
      const result = await this.#adapter.download(
        this.#available,
        (percent) => {
          this.#downloadPercent = percent;
          this.#emit();
        },
      );
      this.#packagePath = result.path;
      this.#status = "ready";
      this.#downloadPercent = 100;
      return this.#emit();
    } catch (error) {
      this.#status = "failed";
      this.#lastError =
        error instanceof Error ? error.message : "Download failed.";
      return this.#emit();
    }
  }

  /**
   * Prepare + accept ledger, then invoke the platform installer once.
   * Never claims installed until reconcilePendingInstall after restart.
   */
  async install(options?: {
    allowWithUnsavedDrafts?: boolean;
  }): Promise<UpdateStatusSnapshot> {
    return this.#enqueueAction(() => this.#installUnlocked(options));
  }

  async #installUnlocked(options?: {
    allowWithUnsavedDrafts?: boolean;
  }): Promise<UpdateStatusSnapshot> {
    if (this.#status !== "ready" || !this.#packagePath || !this.#available) {
      this.#status = "failed";
      this.#lastError = "Update package is not ready.";
      return this.#emit();
    }
    if (
      !options?.allowWithUnsavedDrafts &&
      (await this.#hooks.hasUnsavedDrafts())
    ) {
      this.#status = "failed";
      this.#lastError =
        "Unsaved editor drafts are present; save or discard before installing.";
      return this.#emit();
    }
    const targetVersion = this.#available.version;
    const packagePath = this.#packagePath;
    const pathExists = this.#hooks.pathExists ?? defaultPathExists;
    let invocationAttempted = false;
    if (this.#feedKind === "http" && !(await pathExists(packagePath))) {
      this.#status = "failed";
      this.#lastError = "Downloaded update package is missing on disk.";
      return this.#emit();
    }
    try {
      await this.#requireValidatedPackage(packagePath);
    } catch (error) {
      this.#status = "failed";
      this.#lastError =
        error instanceof Error
          ? error.message
          : "Downloaded update package failed validation.";
      this.#installLedger = {
        ...this.#installLedger,
        claimedInstalled: false,
      };
      return this.#emit();
    }
    this.#status = "installing";
    // 1) initial target/previous/package identity
    this.#installLedger = {
      ...emptyInstallLedger(this.#feedKind),
      packagePath,
      packageIdentity: `${targetVersion}:${packagePath}`,
      installStartedAtMs: Date.now(),
      claimedInstalled: false,
      installInvocationAccepted: false,
      rollbackRequired: false,
      pendingRestart: false,
      targetVersion,
      previousVersion: this.#currentVersion,
    };
    await this.#persistLedger();
    this.#emit();
    try {
      // 2) create and verify workspace backup
      const backup = await this.#hooks.createBackup();
      const backupPath = backup?.path?.trim() ?? "";
      if (!backupPath) {
        throw new Error("Pre-update backup did not return a path.");
      }
      if (!(await pathExists(backupPath))) {
        throw new Error("Pre-update backup path is missing after creation.");
      }
      // Fail closed when backup validation is missing or returns invalid.
      await this.#requireValidatedBackup(backupPath);
      this.#installLedger = {
        ...this.#installLedger,
        backupCreatedAtMs: Date.now(),
        backupPath,
      };
      await this.#persistLedger();
      this.#emit();

      // 3) prepare native / fixture invocation
      const prepared = await this.#installer.prepareInstall(
        packagePath,
        this.#available,
      );
      this.#unsigned = prepared.unsigned;

      // 4) accept invocation + pending-restart before invoke
      this.#installLedger = {
        ...this.#installLedger,
        packagePath: prepared.packagePath,
        packageIdentity: prepared.packageIdentity,
        stagedPath: prepared.stagedPath,
        installFinishedAtMs: Date.now(),
        installInvocationAccepted: true,
        pendingRestart: true,
        claimedInstalled: false,
        rollbackRequired: false,
      };
      this.#status = "pending-restart";
      this.#packagePath = null;
      await this.#persistLedger();
      this.#emit();

      // 5) invoke exactly once (native quitAndInstall is synchronous void)
      try {
        invocationAttempted = true;
        prepared.invoke();
      } catch (error) {
        this.#status = "rollback-required";
        this.#installLedger = {
          ...this.#installLedger,
          rollbackRequired: true,
          claimedInstalled: false,
          pendingRestart: false,
          installInvocationAccepted: false,
          installFinishedAtMs:
            this.#installLedger.installFinishedAtMs ?? Date.now(),
        };
        this.#lastError =
          error instanceof Error
            ? error.message
            : "Update install invocation failed.";
        await this.#persistLedger();
        return this.#emit();
      }
      return this.#emit();
    } catch (error) {
      this.#status = invocationAttempted ? "rollback-required" : "failed";
      this.#installLedger = {
        ...this.#installLedger,
        rollbackRequired: invocationAttempted,
        claimedInstalled: false,
        pendingRestart: false,
        installInvocationAccepted: false,
        installFinishedAtMs:
          this.#installLedger.installFinishedAtMs ?? Date.now(),
      };
      this.#lastError =
        error instanceof Error ? error.message : "Update install failed.";
      await this.#persistLedger();
      return this.#emit();
    }
  }

  /**
   * Claim installed only when running version equals target and health passes.
   */
  async reconcilePendingInstall(): Promise<UpdateStatusSnapshot> {
    return this.#enqueueAction(() => this.#reconcilePendingInstallUnlocked());
  }

  async #reconcilePendingInstallUnlocked(): Promise<UpdateStatusSnapshot> {
    if (!this.#installLedger.pendingRestart) {
      return this.#emit();
    }
    const target = this.#installLedger.targetVersion;
    this.#lastError = null;

    const backupPath = this.#installLedger.backupPath;
    const packagePath =
      this.#installLedger.packagePath ?? this.#installLedger.stagedPath;
    const pathExists = this.#hooks.pathExists ?? defaultPathExists;

    let missingMaterial = false;
    let materialError: string | null = null;

    if (!this.#installLedger.installInvocationAccepted) {
      missingMaterial = true;
      materialError =
        "Update install invocation was not accepted before restart. Manual recovery is available.";
    } else if (!backupPath || !(await pathExists(backupPath))) {
      missingMaterial = true;
      materialError =
        "Update recovery material is missing after restart. Manual recovery is available.";
    } else {
      try {
        await this.#requireValidatedBackup(backupPath);
      } catch (error) {
        missingMaterial = true;
        materialError =
          error instanceof Error
            ? error.message
            : "Pre-update backup verification failed after restart.";
      }
    }

    // HTTP/native electron-updater may consume the downloaded package during
    // quit/restart. Fixture/manual flows must still retain package material.
    if (!missingMaterial && this.#feedKind !== "http") {
      if (!packagePath || !(await pathExists(packagePath))) {
        missingMaterial = true;
        materialError =
          "Update recovery material is missing after restart. Manual recovery is available.";
      } else {
        try {
          await this.#requireValidatedPackage(packagePath);
        } catch (error) {
          missingMaterial = true;
          materialError =
            error instanceof Error
              ? error.message
              : "Update package validation failed after restart.";
        }
      }
    }

    if (missingMaterial || !target || this.#currentVersion !== target) {
      this.#status = "rollback-required";
      this.#installLedger = {
        ...this.#installLedger,
        pendingRestart: false,
        rollbackRequired: true,
        claimedInstalled: false,
        healthCheckedAtMs: Date.now(),
      };
      this.#lastError = missingMaterial
        ? (materialError ??
          "Update recovery material is missing after restart. Manual recovery is available.")
        : "Application version did not match the update target after restart. Manual recovery is available.";
      await this.#persistLedger();
      return this.#emit();
    }

    const healthy = await this.#hooks.healthCheck();
    this.#installLedger = {
      ...this.#installLedger,
      healthCheckedAtMs: Date.now(),
    };
    if (!healthy) {
      this.#status = "rollback-required";
      this.#installLedger = {
        ...this.#installLedger,
        pendingRestart: false,
        rollbackRequired: true,
        claimedInstalled: false,
      };
      this.#lastError =
        "Post-update health check failed. Manual recovery is available.";
      await this.#persistLedger();
      return this.#emit();
    }

    this.#installLedger = {
      ...this.#installLedger,
      pendingRestart: false,
      claimedInstalled: true,
      rollbackRequired: false,
    };
    this.#status = "idle";
    this.#available = null;
    this.#packagePath = null;
    await this.#persistLedger();
    await this.#hooks.onInstalled?.({
      version: this.#currentVersion,
      ledger: { ...this.#installLedger },
    });
    return this.#emit();
  }

  async rollback(): Promise<UpdateStatusSnapshot> {
    return this.#enqueueAction(() => this.#rollbackUnlocked());
  }

  async #rollbackUnlocked(): Promise<UpdateStatusSnapshot> {
    if (this.#recoveryBusy) {
      return this.#emit();
    }
    if (
      this.#installLedger.lastRecoveryAction === "rollback" &&
      this.#installLedger.lastRecoveryOutcome === "succeeded"
    ) {
      this.#status = "idle";
      return this.#emit();
    }
    const backupPath = this.#installLedger.backupPath;
    if (!backupPath || this.#status !== "rollback-required") {
      this.#lastError =
        "No verified pre-update backup is available to restore.";
      return this.#emit();
    }
    if (!this.#hooks.restoreFromBackup) {
      this.#lastError =
        "Workspace rollback is unavailable in this environment.";
      return this.#emit();
    }
    try {
      await this.#requireValidatedBackup(backupPath);
    } catch (error) {
      this.#lastError =
        error instanceof Error
          ? error.message
          : "Pre-update backup verification failed before rollback.";
      return this.#emit();
    }
    this.#recoveryBusy = true;
    this.#emit();
    try {
      const result = await this.#hooks.restoreFromBackup(backupPath);
      if (!result.ok) {
        throw new Error(result.message ?? "Workspace rollback failed.");
      }
      this.#installLedger = {
        ...this.#installLedger,
        lastRecoveryAction: "rollback",
        lastRecoveryAtMs: Date.now(),
        lastRecoveryOutcome: "succeeded",
        rollbackRequired: false,
        pendingRestart: false,
        claimedInstalled: false,
      };
      this.#status = "idle";
      this.#lastError = null;
      await this.#persistLedger();
      if (!this.#installLedger.recoveryHistoryRecorded) {
        this.#installLedger = {
          ...this.#installLedger,
          recoveryHistoryRecorded: true,
        };
        await this.#persistLedger();
        await this.#hooks.onRecovery?.({
          action: "rollback",
          outcome: "succeeded",
          version: this.#installLedger.targetVersion ?? this.#currentVersion,
        });
      }
      return this.#emit();
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Workspace rollback failed.";
      this.#installLedger = {
        ...this.#installLedger,
        lastRecoveryAction: "rollback",
        lastRecoveryAtMs: Date.now(),
        lastRecoveryOutcome: "failed",
        rollbackRequired: true,
      };
      this.#status = "rollback-required";
      this.#lastError = detail;
      await this.#persistLedger();
      await this.#hooks.onRecovery?.({
        action: "rollback",
        outcome: "failed",
        version: this.#installLedger.targetVersion ?? this.#currentVersion,
        detail,
      });
      return this.#emit();
    } finally {
      this.#recoveryBusy = false;
      this.#emit();
    }
  }

  async openInstaller(): Promise<UpdateStatusSnapshot> {
    return this.#enqueueAction(() => this.#openInstallerUnlocked());
  }

  async #openInstallerUnlocked(): Promise<UpdateStatusSnapshot> {
    if (this.#recoveryBusy) {
      return this.#emit();
    }
    if (
      this.#installLedger.lastRecoveryAction === "open_installer" &&
      this.#installLedger.lastRecoveryOutcome === "succeeded"
    ) {
      return this.#emit();
    }
    const packagePath =
      this.#installLedger.packagePath ?? this.#installLedger.stagedPath;
    if (!packagePath) {
      this.#lastError = "No downloaded update package is available to open.";
      return this.#emit();
    }
    if (!this.#hooks.openPath) {
      this.#lastError =
        "Opening installers is unavailable in this environment.";
      return this.#emit();
    }
    this.#recoveryBusy = true;
    this.#emit();
    try {
      const pathExists = this.#hooks.pathExists ?? defaultPathExists;
      if (!(await pathExists(packagePath))) {
        throw new Error("Downloaded update package is missing on disk.");
      }
      await this.#requireValidatedPackage(packagePath);
      const openError = await this.#hooks.openPath(packagePath);
      if (openError) {
        throw new Error(openError);
      }
      this.#installLedger = {
        ...this.#installLedger,
        lastRecoveryAction: "open_installer",
        lastRecoveryAtMs: Date.now(),
        lastRecoveryOutcome: "succeeded",
      };
      // Manual open is never installation proof.
      this.#installLedger = {
        ...this.#installLedger,
        claimedInstalled: false,
      };
      await this.#persistLedger();
      await this.#hooks.onRecovery?.({
        action: "open_installer",
        outcome: "succeeded",
        version: this.#installLedger.targetVersion ?? this.#currentVersion,
      });
      return this.#emit();
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Failed to open the update package.";
      this.#installLedger = {
        ...this.#installLedger,
        lastRecoveryAction: "open_installer",
        lastRecoveryAtMs: Date.now(),
        lastRecoveryOutcome: "failed",
      };
      this.#lastError = detail;
      await this.#persistLedger();
      await this.#hooks.onRecovery?.({
        action: "open_installer",
        outcome: "failed",
        version: this.#installLedger.targetVersion ?? this.#currentVersion,
        detail,
      });
      return this.#emit();
    } finally {
      this.#recoveryBusy = false;
      this.#emit();
    }
  }

  async #persistLedger(): Promise<void> {
    await this.#hooks.persistLedger?.({ ...this.#installLedger });
  }

  #emit(): UpdateStatusSnapshot {
    const snapshot = this.snapshot();
    this.#hooks.onStatus?.(snapshot);
    return snapshot;
  }
}

export function createDefaultUpdateManager(options: {
  hooks: UpdateManagerHooks;
  mode?: UpdateMode;
  deferredUntilMs?: number | null;
  feedUrl?: string | null;
  installLedger?: UpdateInstallLedger | null;
  stageRoot?: string;
  currentVersion?: string;
  installer?: PlatformInstaller;
  electronUpdaterClient?: ElectronUpdaterClient;
  isPackaged?: boolean;
  platform?: string;
  adapter?: UpdateFeedAdapter;
}): UpdateManager {
  const feedUrl =
    options.feedUrl ??
    process.env.TRANSLUNAR_UPDATE_FEED_URL ??
    process.env.TRANSLUNAR_UPDATE_FEED ??
    null;
  const currentVersion = options.currentVersion ?? app.getVersion();
  const stageRoot =
    options.stageRoot ??
    join(tmpdir(), `translunar-update-stage-${process.pid}`);
  const isPackaged = options.isPackaged ?? app.isPackaged;
  const platform = options.platform ?? process.platform;

  let adapter: UpdateFeedAdapter;
  let feedKind: UpdateFeedKind;
  let installer: PlatformInstaller;

  if (options.adapter) {
    adapter = options.adapter;
    feedKind = options.adapter.kind;
    installer = options.installer ?? new FixturePlatformInstaller(stageRoot);
  } else if (feedUrl && /^https?:\/\//iu.test(feedUrl)) {
    const client =
      options.electronUpdaterClient ?? createLazyElectronUpdaterClient();
    adapter = new NativeElectronUpdaterAdapter({
      client,
      feedUrl,
      currentVersion,
      isPackaged,
      platform,
    });
    feedKind = "http";
    installer = options.installer ?? new NativePlatformInstaller(client);
  } else if (feedUrl) {
    adapter = new FixtureFeedAdapter(feedUrl, currentVersion);
    feedKind = "fixture";
    installer = options.installer ?? new FixturePlatformInstaller(stageRoot);
  } else {
    adapter = new InactiveUpdateAdapter();
    feedKind = "none";
    installer = options.installer ?? new FixturePlatformInstaller(stageRoot);
  }

  return new UpdateManager({
    adapter,
    installer,
    hooks: options.hooks,
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.deferredUntilMs === undefined
      ? {}
      : { deferredUntilMs: options.deferredUntilMs }),
    ...(options.installLedger === undefined
      ? {}
      : { installLedger: options.installLedger }),
    currentVersion,
    feedUrl,
    feedKind,
  });
}

export function assertHttpUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Update URL is not absolute.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Update URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Update URL must not embed credentials.");
  }
}

function sanitizeVersion(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._+-]/gu, "_");
}

export async function fetchTextBounded(
  url: string,
  options: { maxBytes: number; timeoutMs: number; maxRedirects: number },
): Promise<string> {
  const buffer = await requestBounded(url, {
    ...options,
    onProgress: undefined,
  });
  return buffer.toString("utf8");
}

export async function downloadFileBounded(
  url: string,
  destination: string,
  options: {
    maxBytes: number;
    timeoutMs: number;
    maxRedirects: number;
    onProgress?: (percent: number) => void;
  },
): Promise<void> {
  const buffer = await requestBounded(url, options);
  await writeFile(destination, buffer);
  options.onProgress?.(100);
}

async function requestBounded(
  url: string,
  options: {
    maxBytes: number;
    timeoutMs: number;
    maxRedirects: number;
    onProgress?: ((percent: number) => void) | undefined;
  },
  redirectsLeft = options.maxRedirects,
): Promise<Buffer> {
  assertHttpUrl(url);
  return new Promise<Buffer>((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.get(
      url,
      {
        headers: {
          Accept: "application/json, application/octet-stream, */*",
          "User-Agent": "Translunar-CAT-Updater/0.1",
        },
        timeout: options.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (
          status >= 300 &&
          status < 400 &&
          typeof response.headers.location === "string"
        ) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(new Error("Update feed exceeded redirect limit."));
            return;
          }
          const next = new URL(response.headers.location, url).toString();
          void requestBounded(next, options, redirectsLeft - 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Update feed HTTP ${String(status)}.`));
          return;
        }
        const lengthHeader = response.headers["content-length"];
        const contentLength =
          typeof lengthHeader === "string" ? Number(lengthHeader) : NaN;
        if (
          Number.isFinite(contentLength) &&
          contentLength > options.maxBytes
        ) {
          response.destroy();
          reject(new Error("Update response exceeds size limit."));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > options.maxBytes) {
            response.destroy();
            reject(new Error("Update response exceeds size limit."));
            return;
          }
          chunks.push(buf);
          if (
            options.onProgress &&
            Number.isFinite(contentLength) &&
            contentLength > 0
          ) {
            options.onProgress(
              Math.min(99, Math.floor((total / contentLength) * 100)),
            );
          }
        });
        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
        response.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("Update request timed out."));
    });
    request.on("error", reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
