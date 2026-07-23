import electron = require("electron");

import type { DesktopApi } from "../shared/desktop-api.js";

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
  restartEngine: "translunar:engine:restart",
  setAiCredential: "translunar:ai:credential:set",
  editorCommand: "translunar:editor:command",
} as const;

const api: DesktopApi = {
  invoke: (method, params) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.invoke, method, params),
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
};

electron.contextBridge.exposeInMainWorld("translunar", api);
