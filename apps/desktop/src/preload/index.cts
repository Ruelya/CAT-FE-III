import electron = require("electron");

import type { DesktopApi } from "../shared/desktop-api.js";

const IPC_CHANNELS = {
  invoke: "translunar:engine:invoke",
  selectSource: "translunar:dialog:source-docx",
  selectExport: "translunar:dialog:export-docx",
  restartEngine: "translunar:engine:restart",
} as const;

const api: DesktopApi = {
  invoke: (method, params) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.invoke, method, params),
  selectSourceDocument: () =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectSource),
  selectExportPath: (suggestedName) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.selectExport, suggestedName),
  restartEngine: () => electron.ipcRenderer.invoke(IPC_CHANNELS.restartEngine),
};

electron.contextBridge.exposeInMainWorld("translunar", api);
