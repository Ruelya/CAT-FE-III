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

/**
 * Commands the application menu can dispatch to the renderer. Every command
 * maps onto an action the workbench already exposes (button or shortcut);
 * the menu never grows behavior of its own.
 */
export type MenuCommand =
  | "import-document"
  | "export-document"
  | "open-project-settings"
  | "close-project"
  | "open-command-palette"
  | "open-preview"
  | "open-concordance"
  | "focus-filter"
  | "open-find"
  | "open-replace"
  | "find-next"
  | "find-prev"
  | "confirm-segment"
  | "confirm-segment-any"
  | "confirm-segment-stay"
  | "show-dock-memory"
  | "show-dock-term"
  | "show-dock-qa"
  | "show-dock-ai";

/**
 * Renderer-reported state that drives menu item enablement, so the menu
 * stays honest: items are disabled when no project/document is open.
 */
export interface MenuContext {
  projectOpen: boolean;
  documentOpen: boolean;
}

export interface DesktopApi {
  invoke(method: string, params: unknown): Promise<EngineInvokeResponse>;
  engineStatus(): Promise<EngineStatusPayload>;
  /**
   * Manual relaunch after the engine parked in `down` (crash budget
   * exhausted, spawn failure, or failed handshake). Resolves with the
   * status right after the new spawn attempt; readiness still arrives
   * through onEngineStatus.
   */
  relaunchEngine(): Promise<EngineStatusPayload>;
  onEngineStatus(listener: (status: EngineStatusPayload) => void): () => void;
  onNotification(
    listener: (notification: EngineNotificationPayload) => void,
  ): () => void;
  chooseSourceFile(): Promise<string | null>;
  chooseExportPath(defaultName: string): Promise<string | null>;
  /** TM exchange files (TMX/CSV/TSV) — dedicated filter, not the document one. */
  chooseTmImportFile(): Promise<string | null>;
  chooseTmExportPath(defaultName: string): Promise<string | null>;
  /** Termbase exchange files (CSV/TSV/TBX). */
  chooseTermbaseImportFile(): Promise<string | null>;
  chooseTermbaseExportPath(defaultName: string): Promise<string | null>;
  /** SRX segmentation ruleset for document.import. */
  chooseSrxFile(): Promise<string | null>;
  renderDocxPreview(documentId: string): Promise<DocxPreviewResponse>;
  /** Application menu clicks arrive here as workbench commands. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  /** Report open-project/document state so menu enablement stays honest. */
  setMenuContext(context: MenuContext): void;
}

export const IPC_CHANNELS = {
  invoke: "tl:engine:invoke",
  statusGet: "tl:engine:status:get",
  statusEvent: "tl:engine:status",
  relaunch: "tl:engine:relaunch",
  notification: "tl:engine:notification",
  chooseSource: "tl:dialog:choose-source",
  chooseExport: "tl:dialog:choose-export",
  chooseTmImport: "tl:dialog:choose-tm-import",
  chooseTmExport: "tl:dialog:choose-tm-export",
  chooseTermbaseImport: "tl:dialog:choose-termbase-import",
  chooseTermbaseExport: "tl:dialog:choose-termbase-export",
  chooseSrx: "tl:dialog:choose-srx",
  previewDocx: "tl:preview:docx",
  menuCommand: "tl:menu:command",
  menuContext: "tl:menu:context",
} as const;

declare global {
  interface Window {
    tl: DesktopApi;
  }
}
