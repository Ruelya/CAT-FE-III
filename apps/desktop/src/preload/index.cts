import electron = require("electron");

import type {
  EngineMethod,
  EngineParams,
  EngineResult,
} from "@translunar/contracts";
import type {
  DesktopApi,
  DesktopEngineInvokeResponse,
  WindowChromePlatform,
} from "../shared/desktop-api.js";
import type {
  ShellLocalePreferencePatch,
  TutorialState,
  UpdateMode,
} from "../shared/product-shell.js";

function resolveWindowChromePlatform(platform: string): WindowChromePlatform {
  return platform === "darwin" ? "macos" : "custom";
}

const IPC_CHANNELS = {
  invoke: "translunar:engine:invoke",
  selectSource: "translunar:dialog:source-docx",
  selectSources: "translunar:dialog:source-documents",
  selectSourceFolder: "translunar:dialog:source-folder",
  selectProjectArchive: "translunar:dialog:project-archive",
  selectProjectArchiveDestination:
    "translunar:dialog:project-archive-destination",
  selectExport: "translunar:dialog:export-docx",
  selectInteropInput: "translunar:dialog:interop-input",
  selectTaskPackageInput: "translunar:dialog:task-package-input",
  selectCorpusInput: "translunar:dialog:corpus-input",
  selectExchangeInput: "translunar:dialog:exchange-input",
  readManagedSource: "translunar:preview:managed-source",
  selectPluginPackage: "translunar:dialog:plugin-package",
  issuePluginPanelSession: "translunar:plugin:panel:issue",
  revokePluginPanelSession: "translunar:plugin:panel:revoke",
  pluginPanelRevoked: "translunar:plugin:panel:revoked",
  restartEngine: "translunar:engine:restart",
  setAiCredential: "translunar:ai:credential:set",
  editorCommand: "translunar:editor:command",
  getSystemLocale: "translunar:shell:system-locale",
  getShellSettings: "translunar:shell:settings:get",
  updateShellSettings: "translunar:shell:settings:update",
  getDataDirectoryStatus: "translunar:shell:data-dir:status",
  selectDataDirectory: "translunar:shell:data-dir:select",
  validateDataDirectory: "translunar:shell:data-dir:validate",
  migrateDataDirectory: "translunar:shell:data-dir:migrate",
  selectBackupDestination: "translunar:shell:backup:select-destination",
  createWorkspaceBackup: "translunar:shell:backup:create",
  selectRestoreSource: "translunar:shell:restore:select",
  previewRestore: "translunar:shell:restore:preview",
  restoreWorkspaceBackup: "translunar:shell:restore:apply",
  getDraftJournal: "translunar:shell:draft:list",
  writeDraftJournal: "translunar:shell:draft:write",
  clearDraftJournal: "translunar:shell:draft:clear",
  getUpdateStatus: "translunar:shell:update:status",
  setUpdateMode: "translunar:shell:update:mode",
  checkForUpdates: "translunar:shell:update:check",
  deferUpdate: "translunar:shell:update:defer",
  downloadUpdate: "translunar:shell:update:download",
  installUpdate: "translunar:shell:update:install",
  rollbackUpdate: "translunar:shell:update:rollback",
  openUpdateInstaller: "translunar:shell:update:open-installer",
  getTutorialState: "translunar:shell:tutorial:get",
  updateTutorialState: "translunar:shell:tutorial:update",
  openExampleProject: "translunar:shell:example:open",
  engineStatus: "translunar:engine:status",
  engineReconnected: "translunar:engine:reconnected",
  minimizeWindow: "translunar:window:minimize",
  maximizeWindow: "translunar:window:maximize",
  closeWindow: "translunar:window:close",
  isWindowMaximized: "translunar:window:is-maximized",
} as const;

async function invokeEngine<Method extends EngineMethod>(
  method: Method,
  params: EngineParams<Method>,
): Promise<EngineResult<Method>> {
  const response = (await electron.ipcRenderer.invoke(
    IPC_CHANNELS.invoke,
    method,
    params,
  )) as unknown;
  if (!isEngineInvokeResponse<EngineResult<Method>>(response)) {
    throw new Error("Engine returned an invalid response envelope.");
  }
  if (!response.ok) {
    // A plain object preserves the typed code/data across contextBridge cloning.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return Promise.reject(response.error);
  }
  return response.result;
}

function isEngineInvokeResponse<Result>(
  value: unknown,
): value is DesktopEngineInvokeResponse<Result> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === true) return "result" in record;
  if (
    record.ok !== false ||
    typeof record.error !== "object" ||
    record.error === null
  ) {
    return false;
  }
  const error = record.error as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string";
}

const api: DesktopApi = {
  invoke: invokeEngine,
  selectSourceDocument: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectSource),
  selectSourceDocuments: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectSources),
  selectSourceFolder: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectSourceFolder),
  selectProjectArchive: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectProjectArchive),
  selectProjectArchiveDestination: (suggestedName) =>
    electron.ipcRenderer.invoke(
      IPC_CHANNELS.selectProjectArchiveDestination,
      suggestedName,
    ),
  selectExportPath: (suggestedName) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectExport, suggestedName),
  selectInteropInput: (kind) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectInteropInput, kind),
  selectTaskPackageInput: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectTaskPackageInput),
  selectCorpusInput: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectCorpusInput),
  selectExchangeInput: (kind) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectExchangeInput, kind),
  readManagedSource: (request) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.readManagedSource, request),
  selectPluginPackage: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectPluginPackage),
  issuePluginPanelSession: (request) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.issuePluginPanelSession, request),
  revokePluginPanelSession: (sessionId) =>
    electron.ipcRenderer.invoke(
      IPC_CHANNELS.revokePluginPanelSession,
      sessionId,
    ),
  onPluginPanelRevoked: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      pluginId: string | null,
    ) => listener(pluginId);
    electron.ipcRenderer.on(IPC_CHANNELS.pluginPanelRevoked, handler);
    return () =>
      electron.ipcRenderer.removeListener(
        IPC_CHANNELS.pluginPanelRevoked,
        handler,
      );
  },
  resolveDroppedPaths: (files) =>
    files
      .slice(0, 500)
      .map((file) => electron.webUtils.getPathForFile(file))
      .filter((path) => path.length > 0),
  restartEngine: () => electron.ipcRenderer.invoke(IPC_CHANNELS.restartEngine),
  setAiCredential: (profileId, secret) =>
    electron.ipcRenderer.invoke(
      IPC_CHANNELS.setAiCredential,
      profileId,
      secret,
    ),
  onEditorCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, commandId: string) =>
      listener(commandId);
    electron.ipcRenderer.on(IPC_CHANNELS.editorCommand, handler);
    return () =>
      electron.ipcRenderer.removeListener(IPC_CHANNELS.editorCommand, handler);
  },
  getSystemLocale: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.getSystemLocale),
  getShellSettings: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.getShellSettings),
  updateShellSettings: (patch: ShellLocalePreferencePatch) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.updateShellSettings, patch),
  getDataDirectoryStatus: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.getDataDirectoryStatus),
  selectDataDirectory: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectDataDirectory),
  validateDataDirectory: (path) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.validateDataDirectory, path),
  migrateDataDirectory: (path) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.migrateDataDirectory, path),
  selectBackupDestination: (suggestedName) =>
    electron.ipcRenderer.invoke(
      IPC_CHANNELS.selectBackupDestination,
      suggestedName,
    ),
  createWorkspaceBackup: (destinationPath) =>
    electron.ipcRenderer.invoke(
      IPC_CHANNELS.createWorkspaceBackup,
      destinationPath,
    ),
  selectRestoreSource: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectRestoreSource),
  previewRestore: (path) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.previewRestore, path),
  restoreWorkspaceBackup: (params) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.restoreWorkspaceBackup, params),
  getDraftJournal: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.getDraftJournal),
  writeDraftJournal: (record) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.writeDraftJournal, record),
  clearDraftJournal: (segmentIds) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.clearDraftJournal, segmentIds),
  getUpdateStatus: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.getUpdateStatus),
  setUpdateMode: (mode: UpdateMode) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.setUpdateMode, mode),
  checkForUpdates: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  deferUpdate: (untilMs) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.deferUpdate, untilMs),
  downloadUpdate: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate),
  installUpdate: () => electron.ipcRenderer.invoke(IPC_CHANNELS.installUpdate),
  rollbackUpdate: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.rollbackUpdate),
  openUpdateInstaller: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.openUpdateInstaller),
  getTutorialState: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.getTutorialState),
  updateTutorialState: (patch: Partial<TutorialState>) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.updateTutorialState, patch),
  openExampleProject: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.openExampleProject),
  onEngineReconnected: (listener) => {
    const handler = () => listener();
    electron.ipcRenderer.on(IPC_CHANNELS.engineReconnected, handler);
    return () =>
      electron.ipcRenderer.removeListener(
        IPC_CHANNELS.engineReconnected,
        handler,
      );
  },
  onEngineStatus: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        type: "reconnecting" | "reconnected" | "failed";
        attempt?: number;
        message?: string;
      },
    ) => listener(payload);
    electron.ipcRenderer.on(IPC_CHANNELS.engineStatus, handler);
    return () =>
      electron.ipcRenderer.removeListener(IPC_CHANNELS.engineStatus, handler);
  },
  minimizeWindow: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.minimizeWindow),
  maximizeWindow: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.maximizeWindow),
  closeWindow: () => electron.ipcRenderer.invoke(IPC_CHANNELS.closeWindow),
  isWindowMaximized: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.isWindowMaximized),
  getWindowChromePlatform: () => resolveWindowChromePlatform(process.platform),
};

electron.contextBridge.exposeInMainWorld("translunar", api);
