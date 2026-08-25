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

export interface DesktopApi {
  invoke(method: string, params: unknown): Promise<EngineInvokeResponse>;
  engineStatus(): Promise<EngineStatusPayload>;
  onEngineStatus(listener: (status: EngineStatusPayload) => void): () => void;
  onNotification(
    listener: (notification: EngineNotificationPayload) => void,
  ): () => void;
  chooseSourceFile(): Promise<string | null>;
  chooseExportPath(defaultName: string): Promise<string | null>;
}

export const IPC_CHANNELS = {
  invoke: "tl:engine:invoke",
  statusGet: "tl:engine:status:get",
  statusEvent: "tl:engine:status",
  notification: "tl:engine:notification",
  chooseSource: "tl:dialog:choose-source",
  chooseExport: "tl:dialog:choose-export",
} as const;

declare global {
  interface Window {
    tl: DesktopApi;
  }
}
