/** Contract between the preload bridge and the renderer. */

export interface EngineRpcErrorShape {
  code: string;
  message: string;
}

export type EngineInvokeResponse =
  { ok: true; result: unknown } | { ok: false; error: EngineRpcErrorShape };

export type EngineLifecycleState = "starting" | "ready" | "restarting" | "down";

export interface EngineStatusPayload {
  state: EngineLifecycleState;
  pid?: number;
  restarts: number;
  engineVersion?: string;
  lastError?: string;
}

export interface EngineNotificationPayload {
  method: string;
  params: unknown;
}

/**
 * Result of rendering the current draft into the real export pipeline:
 * the DOCX bytes are produced by `document.export` against a temp path,
 * so the preview shows exactly what the exported file would contain.
 */
export type DocxPreviewResponse =
  | { ok: true; data: ArrayBuffer; translatedSegments: number }
  | { ok: false; error: EngineRpcErrorShape };

export interface DesktopApi {
  invoke(method: string, params: unknown): Promise<EngineInvokeResponse>;
  engineStatus(): Promise<EngineStatusPayload>;
  onEngineStatus(listener: (status: EngineStatusPayload) => void): () => void;
  onNotification(
    listener: (notification: EngineNotificationPayload) => void,
  ): () => void;
  chooseSourceFile(): Promise<string | null>;
  chooseExportPath(defaultName: string): Promise<string | null>;
  /** File picker for TM exchange files (TMX / CSV / TSV). */
  chooseTmFile(): Promise<string | null>;
  /** File picker for termbase exchange files (CSV / TSV / TBX). */
  chooseTermFile(): Promise<string | null>;
  renderDocxPreview(documentId: string): Promise<DocxPreviewResponse>;
}

export const IPC_CHANNELS = {
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

declare global {
  interface Window {
    tl: DesktopApi;
  }
}
