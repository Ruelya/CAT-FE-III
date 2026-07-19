import electron = require("electron");

import type { DesktopApi } from "../shared/desktop-api.js";

const IPC_CHANNELS = {
  invoke: "translunar:engine:invoke",
  selectSource: "translunar:dialog:source-docx",
  selectExport: "translunar:dialog:export-docx",
  restartEngine: "translunar:engine:restart",
  editorCommand: "translunar:editor:command",
} as const;

const api: DesktopApi = {
  invoke: (method, params) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.invoke, method, params),
  selectSourceDocument: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectSource),
  selectExportPath: (suggestedName) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectExport, suggestedName),
  restartEngine: () => electron.ipcRenderer.invoke(IPC_CHANNELS.restartEngine),
  onEditorCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, commandId: string) =>
      listener(commandId);
    electron.ipcRenderer.on(IPC_CHANNELS.editorCommand, handler);
    return () =>
      electron.ipcRenderer.removeListener(IPC_CHANNELS.editorCommand, handler);
  },
};

electron.contextBridge.exposeInMainWorld("translunar", api);
