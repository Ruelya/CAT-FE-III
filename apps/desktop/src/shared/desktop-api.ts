import type {
  EngineMethod,
  EngineParams,
  EngineResult,
} from "@translunar/contracts";

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
  selectPluginPackage(): Promise<string | null>;
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
}

export type {
  DraftJournalRecord,
  ProductShellSettings,
  ShellLocalePreferencePatch,
  TutorialState,
};
