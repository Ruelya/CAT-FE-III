import electron = require("electron");

import type {
  DesktopApi,
  DocxPreviewResponse,
  EngineInvokeResponse,
  EngineNotificationPayload,
  EngineStatusPayload,
} from "../shared/desktop-api.js";

const CHANNELS = {
  invoke: "tl:engine:invoke",
  statusGet: "tl:engine:status:get",
  statusEvent: "tl:engine:status",
  notification: "tl:engine:notification",
  chooseSource: "tl:dialog:choose-source",
  chooseExport: "tl:dialog:choose-export",
  chooseTm: "tl:dialog:choose-tm",
  chooseTerm: "tl:dialog:choose-term",
  previewDocx: "tl:preview:docx",
} as const;

const api: DesktopApi = {
  invoke(method, params): Promise<EngineInvokeResponse> {
    return electron.ipcRenderer.invoke(
      CHANNELS.invoke,
      method,
      params,
    ) as Promise<EngineInvokeResponse>;
  },
  engineStatus(): Promise<EngineStatusPayload> {
    return electron.ipcRenderer.invoke(
      CHANNELS.statusGet,
    ) as Promise<EngineStatusPayload>;
  },
  onEngineStatus(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: EngineStatusPayload,
    ) => listener(status);
    electron.ipcRenderer.on(CHANNELS.statusEvent, handler);
    return () => electron.ipcRenderer.off(CHANNELS.statusEvent, handler);
  },
  onNotification(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      notification: EngineNotificationPayload,
    ) => listener(notification);
    electron.ipcRenderer.on(CHANNELS.notification, handler);
    return () => electron.ipcRenderer.off(CHANNELS.notification, handler);
  },
  chooseSourceFile(): Promise<string | null> {
    return electron.ipcRenderer.invoke(CHANNELS.chooseSource) as Promise<
      string | null
    >;
  },
  chooseExportPath(defaultName: string): Promise<string | null> {
    return electron.ipcRenderer.invoke(
      CHANNELS.chooseExport,
      defaultName,
    ) as Promise<string | null>;
  },
  chooseTmFile(): Promise<string | null> {
    return electron.ipcRenderer.invoke(CHANNELS.chooseTm) as Promise<
      string | null
    >;
  },
  chooseTermFile(): Promise<string | null> {
    return electron.ipcRenderer.invoke(CHANNELS.chooseTerm) as Promise<
      string | null
    >;
  },
  renderDocxPreview(documentId: string): Promise<DocxPreviewResponse> {
    return electron.ipcRenderer.invoke(
      CHANNELS.previewDocx,
      documentId,
    ) as Promise<DocxPreviewResponse>;
  },
};

electron.contextBridge.exposeInMainWorld("tl", api);
