import type {
  EngineMethod,
  EngineParams,
  EngineResult,
} from "@translunar/contracts";

import type {
  ManagedSourceBytes,
  ManagedSourceRequest,
} from "./managed-source.js";
import type {
  DataDirectoryMigrationResult,
  DataDirectoryStatus,
  DataDirectoryValidation,
  DraftJournalRecord,
  DraftJournalSnapshot,
  ExampleProjectResult,
  ProductShellSettings,
  RestoreApplyParams,
  ShellLocalePreferencePatch,
  ShellActionResult,
  TutorialState,
  UpdateMode,
  UpdateStatusSnapshot,
} from "./product-shell.js";

export interface DesktopEngineError {
  code: string;
  message: string;
  data?: unknown;
}

export type DesktopEngineInvokeResponse<Result = unknown> =
  { ok: true; result: Result } | { ok: false; error: DesktopEngineError };

export interface PluginPanelSessionRequest {
  pluginId: string;
  contributionId: string;
  revision: number;
}

export interface PluginPanelSession {
  sessionId: string;
  url: string;
  expiresAtMs: number;
  revision: number;
  bridgeVersion: 1;
}

/**
 * Title-strip platform branch.
 * - `macos`: native traffic lights via hiddenInset (renderer omits custom controls).
 * - `custom`: Windows / Linux / other fallback with renderer-owned window controls.
 */
export type WindowChromePlatform = "macos" | "custom";

export type LayoutDocumentType = "word" | "cell" | "slide";

export interface LayoutPreviewSink {
  outputPath: string;
}

export interface LayoutPreviewSession {
  fileUrl: string;
  docsUrl: string | null;
  token: string | null;
  documentType: LayoutDocumentType;
  fileType: string;
  title: string;
  key: string;
}

export interface DesktopApi {
  invoke<Method extends EngineMethod>(
    method: Method,
    params: EngineParams<Method>,
  ): Promise<EngineResult<Method>>;
  selectSourceDocument(): Promise<string | null>;
  selectSourceDocuments(): Promise<string[]>;
  selectSourceFolder(): Promise<string | null>;
  selectProjectArchive(): Promise<string | null>;
  selectProjectArchiveDestination(
    suggestedName: string,
  ): Promise<string | null>;
  selectExportPath(suggestedName: string): Promise<string | null>;
  selectInteropInput(kind: "review" | "table"): Promise<string | null>;
  selectTaskPackageInput(): Promise<string | null>;
  selectCorpusInput(): Promise<string | null>;
  /** Open a TMX/TBX/CSV/TSV exchange file for memory or termbase import. */
  selectExchangeInput(kind: "tm" | "termbase"): Promise<string | null>;
  /**
   * Read the engine-managed import copy as bytes.
   * Main resolves `{dataDir}/sources/{documentId}.{ext}` only.
   * The renderer never receives the filesystem path.
   */
  readManagedSource(
    request: ManagedSourceRequest,
  ): Promise<ManagedSourceBytes | null>;
  selectPluginPackage(): Promise<string | null>;
  issuePluginPanelSession(
    request: PluginPanelSessionRequest,
  ): Promise<PluginPanelSession>;
  revokePluginPanelSession(sessionId: string): Promise<boolean>;
  onPluginPanelRevoked(listener: (pluginId: string | null) => void): () => void;
  resolveDroppedPaths(files: readonly File[]): string[];
  restartEngine(): Promise<void>;
  setAiCredential(profileId: string, secret: string): Promise<void>;
  onEditorCommand(listener: (commandId: string) => void): () => void;

  // Product shell surface
  getSystemLocale(): Promise<string>;
  getShellSettings(): Promise<ProductShellSettings>;
  updateShellSettings(
    patch: ShellLocalePreferencePatch,
  ): Promise<ProductShellSettings>;
  getDataDirectoryStatus(): Promise<DataDirectoryStatus>;
  selectDataDirectory(): Promise<string | null>;
  validateDataDirectory(path: string): Promise<DataDirectoryValidation>;
  migrateDataDirectory(path: string): Promise<DataDirectoryMigrationResult>;
  selectBackupDestination(suggestedName?: string): Promise<string | null>;
  createWorkspaceBackup(
    destinationPath?: string | null,
  ): Promise<ShellActionResult>;
  selectRestoreSource(): Promise<string | null>;
  previewRestore(path: string): Promise<ShellActionResult>;
  restoreWorkspaceBackup(
    params: RestoreApplyParams,
  ): Promise<DataDirectoryMigrationResult>;
  getDraftJournal(): Promise<DraftJournalSnapshot>;
  writeDraftJournal(record: {
    projectId: string;
    documentId: string;
    segmentId: string;
    expectedRevision: number;
    targetText: string;
  }): Promise<DraftJournalSnapshot>;
  clearDraftJournal(segmentIds?: string[]): Promise<DraftJournalSnapshot>;
  getUpdateStatus(): Promise<UpdateStatusSnapshot>;
  setUpdateMode(mode: UpdateMode): Promise<UpdateStatusSnapshot>;
  checkForUpdates(): Promise<UpdateStatusSnapshot>;
  deferUpdate(untilMs: number): Promise<UpdateStatusSnapshot>;
  downloadUpdate(): Promise<UpdateStatusSnapshot>;
  installUpdate(): Promise<UpdateStatusSnapshot>;
  rollbackUpdate(): Promise<UpdateStatusSnapshot>;
  openUpdateInstaller(): Promise<UpdateStatusSnapshot>;
  getTutorialState(): Promise<TutorialState>;
  updateTutorialState(patch: Partial<TutorialState>): Promise<TutorialState>;
  openExampleProject(): Promise<ExampleProjectResult>;
  onEngineReconnected(listener: () => void): () => void;
  onEngineStatus(
    listener: (payload: {
      type: "reconnecting" | "reconnected" | "failed";
      attempt?: number;
      message?: string;
    }) => void,
  ): () => void;

  // Window chrome (custom title bar) — narrow surface only
  minimizeWindow(): Promise<void>;
  /** Toggle maximize when normal / restore when maximized; returns resulting state. */
  maximizeWindow(): Promise<boolean>;
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  /** Sync platform capability for native vs custom control branch. */
  getWindowChromePlatform(): WindowChromePlatform;
  createLayoutPreviewSink(input: { fileType: string }): Promise<LayoutPreviewSink>;
  publishLayoutPreview(input: {
    outputPath: string;
    title: string;
    fileType: string;
  }): Promise<LayoutPreviewSession>;
  revokeLayoutPreview(): Promise<void>;
}

export type {
  DraftJournalRecord,
  ProductShellSettings,
  ShellLocalePreferencePatch,
  TutorialState,
};
