import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  defaultProductShellSettings,
  defaultTutorialState,
  type AppLocale,
  type BackupHistoryEntry,
  type ProductShellSettings,
  type ShellLocalePreferencePatch,
  type TutorialState,
  type UpdateFeedKind,
  type UpdateHistoryEntry,
  type UpdateInstallLedger,
  type UpdateMode,
  TUTORIAL_VERSION,
} from "../shared/product-shell.js";

const MAX_HISTORY = 20;

export class ShellSettingsStore {
  readonly #path: string;
  #cache: ProductShellSettings | null = null;
  /** FIFO tail so each public read/modify/write is atomic relative to others. */
  #queue: Promise<void> = Promise.resolve();

  constructor(settingsPath: string) {
    this.#path = settingsPath;
  }

  get path(): string {
    return this.#path;
  }

  async load(): Promise<ProductShellSettings> {
    return this.#enqueue(() => this.#loadUnlocked());
  }

  async save(next: ProductShellSettings): Promise<ProductShellSettings> {
    return this.#enqueue(() => this.#saveUnlocked(next));
  }

  async update(
    patch: Partial<ProductShellSettings>,
  ): Promise<ProductShellSettings> {
    return this.#enqueue(async () => {
      const current = await this.#loadUnlocked();
      return this.#saveUnlocked({
        ...current,
        ...patch,
        tutorial: patch.tutorial
          ? sanitizeTutorial(patch.tutorial)
          : current.tutorial,
        backupHistory: patch.backupHistory
          ? sanitizeBackupHistory(patch.backupHistory)
          : current.backupHistory,
        updateHistory: patch.updateHistory
          ? sanitizeUpdateHistory(patch.updateHistory)
          : current.updateHistory,
        installLedger:
          patch.installLedger === undefined
            ? current.installLedger
            : sanitizeInstallLedger(patch.installLedger),
      });
    });
  }

  async pushBackup(entry: BackupHistoryEntry): Promise<ProductShellSettings> {
    return this.#enqueue(async () => {
      const current = await this.#loadUnlocked();
      const backupHistory = [entry, ...current.backupHistory].slice(
        0,
        MAX_HISTORY,
      );
      return this.#saveUnlocked({ ...current, backupHistory });
    });
  }

  async pushUpdate(entry: UpdateHistoryEntry): Promise<ProductShellSettings> {
    return this.#enqueue(async () => {
      const current = await this.#loadUnlocked();
      const updateHistory = [entry, ...current.updateHistory].slice(
        0,
        MAX_HISTORY,
      );
      return this.#saveUnlocked({ ...current, updateHistory });
    });
  }

  /**
   * Chain an operation after the current tail. A rejected operation must not
   * poison later work, so the tail always settles successfully.
   */
  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #loadUnlocked(): Promise<ProductShellSettings> {
    if (this.#cache) return structuredClone(this.#cache);
    try {
      const raw = await readFile(this.#path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      this.#cache = sanitizeSettings(parsed);
    } catch {
      this.#cache = defaultProductShellSettings();
    }
    return structuredClone(this.#cache);
  }

  async #saveUnlocked(
    next: ProductShellSettings,
  ): Promise<ProductShellSettings> {
    const sanitized = sanitizeSettings(next);
    await mkdir(dirname(this.#path), { recursive: true });
    const temp = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
      await rename(temp, this.#path);
      this.#cache = sanitized;
      return structuredClone(sanitized);
    } finally {
      try {
        await unlink(temp);
      } catch {
        // ENOENT is expected after a successful rename; do not mask an
        // original write/rename failure with best-effort cleanup.
      }
    }
  }
}

export function shellSettingsPath(userDataPath: string): string {
  return join(userDataPath, "product-shell-settings.json");
}

/**
 * Runtime parser for the renderer-owned shell settings IPC surface.
 * Accepts only `{ locale: "en-US" | "zh-CN" | null }` — rejects missing/extra keys.
 */
export function parseShellLocalePreferencePatch(
  value: unknown,
): ShellLocalePreferencePatch {
  if (!isRecord(value)) {
    throw new Error("Invalid shell settings patch.");
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "locale") {
    throw new Error(
      "Shell settings patch may only include the locale preference.",
    );
  }
  const locale = value.locale;
  if (locale === null) {
    return { locale: null };
  }
  if (!isLocale(locale)) {
    throw new Error("Invalid locale preference.");
  }
  return { locale };
}

export function sanitizeSettings(value: unknown): ProductShellSettings {
  const base = defaultProductShellSettings();
  if (!isRecord(value)) return base;
  return {
    locale: isLocale(value.locale) ? value.locale : null,
    updateMode: isUpdateMode(value.updateMode) ? value.updateMode : "manual",
    deferredUntilMs:
      typeof value.deferredUntilMs === "number" &&
      Number.isFinite(value.deferredUntilMs)
        ? value.deferredUntilMs
        : null,
    tutorial: sanitizeTutorial(value.tutorial),
    dataDirectoryPath:
      typeof value.dataDirectoryPath === "string" &&
      value.dataDirectoryPath.trim()
        ? value.dataDirectoryPath
        : null,
    backupHistory: sanitizeBackupHistory(value.backupHistory),
    updateHistory: sanitizeUpdateHistory(value.updateHistory),
    installLedger: sanitizeInstallLedger(value.installLedger),
  };
}

export function sanitizeInstallLedger(
  value: unknown,
): UpdateInstallLedger | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;
  const feedKind: UpdateFeedKind = isFeedKind(value.feedKind)
    ? value.feedKind
    : "none";
  return {
    feedKind,
    backupCreatedAtMs: nullableNumber(value.backupCreatedAtMs),
    backupPath: typeof value.backupPath === "string" ? value.backupPath : null,
    installStartedAtMs: nullableNumber(value.installStartedAtMs),
    installFinishedAtMs: nullableNumber(value.installFinishedAtMs),
    healthCheckedAtMs: nullableNumber(value.healthCheckedAtMs),
    rollbackRequired: value.rollbackRequired === true,
    packagePath:
      typeof value.packagePath === "string" ? value.packagePath : null,
    packageIdentity:
      typeof value.packageIdentity === "string" ? value.packageIdentity : null,
    installInvocationAccepted: value.installInvocationAccepted === true,
    claimedInstalled: value.claimedInstalled === true,
    pendingRestart: value.pendingRestart === true,
    targetVersion:
      typeof value.targetVersion === "string" ? value.targetVersion : null,
    previousVersion:
      typeof value.previousVersion === "string" ? value.previousVersion : null,
    stagedPath: typeof value.stagedPath === "string" ? value.stagedPath : null,
    lastRecoveryAction:
      value.lastRecoveryAction === "rollback" ||
      value.lastRecoveryAction === "open_installer"
        ? value.lastRecoveryAction
        : null,
    lastRecoveryAtMs: nullableNumber(value.lastRecoveryAtMs),
    lastRecoveryOutcome:
      value.lastRecoveryOutcome === "succeeded" ||
      value.lastRecoveryOutcome === "failed"
        ? value.lastRecoveryOutcome
        : null,
    recoveryHistoryRecorded: value.recoveryHistoryRecorded === true,
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isFeedKind(value: unknown): value is UpdateFeedKind {
  return value === "fixture" || value === "http" || value === "none";
}

function sanitizeTutorial(value: unknown): TutorialState {
  const base = defaultTutorialState();
  if (!isRecord(value)) return base;
  const step = isTutorialStep(value.step) ? value.step : base.step;
  return {
    version:
      typeof value.version === "number" && value.version > 0
        ? value.version
        : TUTORIAL_VERSION,
    step,
    skipped: value.skipped === true,
    completed: value.completed === true,
    updatedAtMs:
      typeof value.updatedAtMs === "number" &&
      Number.isFinite(value.updatedAtMs)
        ? value.updatedAtMs
        : Date.now(),
  };
}

function sanitizeBackupHistory(value: unknown): BackupHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({
      id: stringField(entry.id),
      destinationPath: stringField(entry.destinationPath),
      createdAtMs: Number(entry.createdAtMs ?? 0),
      schemaVersion: Number(entry.schemaVersion ?? 0),
      engineVersion: stringField(entry.engineVersion),
      fileCount: Number(entry.fileCount ?? 0),
    }))
    .filter((entry) => entry.id && entry.destinationPath)
    .slice(0, MAX_HISTORY);
}

function sanitizeUpdateHistory(value: unknown): UpdateHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry): UpdateHistoryEntry => {
      const status: UpdateHistoryEntry["status"] =
        entry.status === "installed" ||
        entry.status === "failed" ||
        entry.status === "rolled_back" ||
        entry.status === "manual_recovery"
          ? entry.status
          : "failed";
      return {
        id: stringField(entry.id),
        version: stringField(entry.version),
        status,
        atMs: Number(entry.atMs ?? 0),
        ...(typeof entry.detail === "string" ? { detail: entry.detail } : {}),
      };
    })
    .filter((entry) => entry.id && entry.version)
    .slice(0, MAX_HISTORY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isLocale(value: unknown): value is AppLocale {
  return value === "en-US" || value === "zh-CN";
}

function isUpdateMode(value: unknown): value is UpdateMode {
  return value === "automatic" || value === "manual" || value === "disabled";
}

function isTutorialStep(value: unknown): value is TutorialState["step"] {
  return (
    value === "welcome" ||
    value === "create" ||
    value === "import" ||
    value === "edit" ||
    value === "qa" ||
    value === "export" ||
    value === "complete"
  );
}
