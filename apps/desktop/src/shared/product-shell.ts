/** Shared product-shell types crossing the main/preload/renderer boundary. */

export type AppLocale = "en-US" | "zh-CN";

/** Renderer may only mutate the user-owned locale preference via shell settings IPC. */
export interface ShellLocalePreferencePatch {
  locale: AppLocale | null;
}

export type UpdateMode = "automatic" | "manual" | "disabled";

export type TutorialStep =
  "welcome" | "create" | "import" | "edit" | "qa" | "export" | "complete";

export interface TutorialState {
  version: number;
  step: TutorialStep;
  skipped: boolean;
  completed: boolean;
  updatedAtMs: number;
}

export interface BackupHistoryEntry {
  id: string;
  destinationPath: string;
  createdAtMs: number;
  schemaVersion: number;
  engineVersion: string;
  fileCount: number;
}

export interface UpdateHistoryEntry {
  id: string;
  version: string;
  status: "installed" | "failed" | "rolled_back" | "manual_recovery";
  atMs: number;
  detail?: string;
}

export interface ProductShellSettings {
  locale: AppLocale | null;
  updateMode: UpdateMode;
  deferredUntilMs: number | null;
  tutorial: TutorialState;
  dataDirectoryPath: string | null;
  backupHistory: BackupHistoryEntry[];
  updateHistory: UpdateHistoryEntry[];
  /** Durable install ledger across restart (pending-restart / rollback). */
  installLedger: UpdateInstallLedger | null;
}

export interface DataDirectoryStatus {
  path: string;
  absolutePath: string;
  exists: boolean;
  writable: boolean;
  freeBytes: number | null;
  freeBytesLabel: string;
  isTestOverride: boolean;
  healthy: boolean | null;
  schemaVersion: number | null;
}

export interface DataDirectoryValidation {
  ok: boolean;
  path: string;
  code?: string | undefined;
  message?: string | undefined;
  freeBytes?: number | undefined;
}

export type DataDirectoryMigrationPhase =
  | "ready"
  | "validating"
  | "staging-copy"
  | "health-check"
  | "stopping-engine"
  | "swapping"
  | "restarting-engine"
  | "committed"
  | "rollback";

export interface DataDirectoryMigrationResult {
  ok: boolean;
  phase: DataDirectoryMigrationPhase;
  sourcePath: string;
  targetPath: string;
  /**
   * Actual workspace path the Engine and shell treat as live after this
   * operation. May differ from sourcePath/targetPath on fallback rollback.
   */
  activePath: string;
  message?: string | undefined;
  code?: string | undefined;
}

export interface DraftJournalRecord {
  projectId: string;
  documentId: string;
  segmentId: string;
  expectedRevision: number;
  targetText: string;
  updatedAtMs: number;
  checksum: string;
}

export interface DraftJournalSnapshot {
  path: string;
  records: DraftJournalRecord[];
  totalBytes: number;
}

export type UpdateServiceStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "deferred"
  | "disabled"
  | "failed"
  | "installing"
  | "pending-restart"
  | "rollback-required";

export type UpdateFeedKind = "fixture" | "http" | "none";

export interface UpdateInstallLedger {
  feedKind: UpdateFeedKind;
  backupCreatedAtMs: number | null;
  /** Verified pre-update workspace backup path. */
  backupPath: string | null;
  installStartedAtMs: number | null;
  installFinishedAtMs: number | null;
  healthCheckedAtMs: number | null;
  rollbackRequired: boolean;
  packagePath: string | null;
  packageIdentity: string | null;
  /** True only after prepare succeeded and before/after invoke was accepted. */
  installInvocationAccepted: boolean;
  claimedInstalled: boolean;
  /** True after staged install, until post-restart reconcile claims or rolls back. */
  pendingRestart: boolean;
  targetVersion: string | null;
  previousVersion: string | null;
  stagedPath: string | null;
  lastRecoveryAction: "rollback" | "open_installer" | null;
  lastRecoveryAtMs: number | null;
  lastRecoveryOutcome: "succeeded" | "failed" | null;
  /** Prevents duplicate updateHistory rows for idempotent recovery. */
  recoveryHistoryRecorded: boolean;
}

export interface UpdateStatusSnapshot {
  status: UpdateServiceStatus;
  mode: UpdateMode;
  currentVersion: string;
  availableVersion: string | null;
  feedUrl: string | null;
  deferredUntilMs: number | null;
  lastCheckedAtMs: number | null;
  lastError: string | null;
  downloadPercent: number | null;
  requiresBackup: boolean;
  unsigned: boolean;
  feedKind: UpdateFeedKind;
  installLedger: UpdateInstallLedger;
  canRollback: boolean;
  canOpenInstaller: boolean;
  recoveryBusy: boolean;
}

export interface ShellActionResult {
  ok: boolean;
  code?: string | undefined;
  message?: string | undefined;
  data?: unknown;
}

export interface RestorePreviewSummary {
  path: string;
  formatVersion: number;
  schemaVersion: number;
  engineVersion: string;
  createdAtMs: number;
  fileCount: number;
  totalBytes: number;
  /** True only when main-process hash verification succeeded for every listed file. */
  hashesOk: boolean;
  /** True only when backup format/schema is compatible with the live Engine. */
  compatible: boolean;
  freeBytes: number | null;
  freeBytesLabel: string;
  /**
   * Opaque, single-use confirmation token issued by main after a successful
   * preview. Bound to the canonical backup path and validated manifest/hash
   * fingerprint. Required by restore apply; never invent in the renderer.
   */
  confirmationToken: string;
}

/** Renderer/main restore apply payload — path must match the token binding. */
export interface RestoreApplyParams {
  path: string;
  confirmationToken: string;
}

export interface ExampleProjectResult {
  ok: boolean;
  projectId?: string | undefined;
  documentId?: string | undefined;
  message?: string | undefined;
  code?: string | undefined;
}

export const TUTORIAL_VERSION = 1;

export function defaultTutorialState(now = Date.now()): TutorialState {
  return {
    version: TUTORIAL_VERSION,
    step: "welcome",
    skipped: false,
    completed: false,
    updatedAtMs: now,
  };
}

export function defaultProductShellSettings(): ProductShellSettings {
  return {
    locale: null,
    updateMode: "manual",
    deferredUntilMs: null,
    tutorial: defaultTutorialState(),
    dataDirectoryPath: null,
    backupHistory: [],
    updateHistory: [],
    installLedger: null,
  };
}
