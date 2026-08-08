import type {
  Document,
  Project,
  QaGateResult,
  QaIssueView,
  QaRun,
  SegmentCounts,
  SegmentEditorRow,
  TmEntry,
} from "@translunar/contracts";

import type { DraftJournalRecord } from "../../shared/product-shell";
import type { UiError } from "../lib/errors";
import type { SessionIdentity } from "./session";

export type EngineConnectionStatus =
  | "unknown"
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | "failed";

export type SurfaceKind =
  | "boot"
  | "recovery"
  | "welcome"
  | "projects"
  | "create-project"
  | "import-document"
  | "workbench"
  | "qa"
  | "export";

export interface SessionContext {
  session: SessionIdentity;
  project: Project;
  document: Document;
  rows: SegmentEditorRow[];
  counts: SegmentCounts | null;
}

export type AppSurface =
  | { kind: "boot"; message?: string; error?: UiError | null }
  | {
      kind: "recovery";
      mode: "recoverable" | "stale";
      records: DraftJournalRecord[];
      session: SessionIdentity | null;
      reason?: string;
      error?: UiError | null;
    }
  | { kind: "welcome" }
  | {
      kind: "projects";
      projects: Project[];
      error?: UiError | null;
      loading?: boolean;
    }
  | {
      kind: "create-project";
      error?: UiError | null;
      pending?: boolean;
    }
  | {
      kind: "import-document";
      projectId: string;
      projectName: string;
      error?: UiError | null;
      pending?: boolean;
    }
  | {
      kind: "workbench";
      ctx: SessionContext;
      activeSegmentId: string | null;
      focusSegmentId: string | null;
      tmMatches: TmEntry[];
      tmLoading: boolean;
      tmError: UiError | null;
      tmCollapsed: boolean;
      transitionError: UiError | null;
      pendingConfirm: boolean;
    }
  | {
      kind: "qa";
      ctx: SessionContext;
      issues: QaIssueView[];
      /** False until a successful authoritative qa.issue.list response. */
      issuesLoaded: boolean;
      run: QaRun | null;
      loading: boolean;
      error: UiError | null;
    }
  | {
      kind: "export";
      ctx: SessionContext;
      gate: QaGateResult | null;
      loading: boolean;
      exporting: boolean;
      error: UiError | null;
      resultPath: string | null;
    };

export interface AppState {
  generation: number;
  engineStatus: EngineConnectionStatus;
  engineMessage: string | null;
  surface: AppSurface;
  bootError: UiError | null;
  mutationsEnabled: boolean;
}

export type AppAction =
  | { type: "BOOT_START"; generation: number }
  | {
      type: "ENGINE_STATUS";
      status: EngineConnectionStatus;
      message?: string | null;
    }
  | { type: "SET_SURFACE"; surface: AppSurface }
  | { type: "SET_BOOT_ERROR"; error: UiError | null }
  | { type: "SET_MUTATIONS_ENABLED"; enabled: boolean }
  | {
      type: "PATCH_WORKBENCH";
      patch: Partial<Extract<AppSurface, { kind: "workbench" }>>;
    }
  | { type: "PATCH_QA"; patch: Partial<Extract<AppSurface, { kind: "qa" }>> }
  | {
      type: "PATCH_EXPORT";
      patch: Partial<Extract<AppSurface, { kind: "export" }>>;
    }
  | {
      type: "PATCH_PROJECTS";
      patch: Partial<Extract<AppSurface, { kind: "projects" }>>;
    }
  | {
      type: "PATCH_IMPORT";
      patch: Partial<Extract<AppSurface, { kind: "import-document" }>>;
    }
  | {
      type: "PATCH_CREATE";
      patch: Partial<Extract<AppSurface, { kind: "create-project" }>>;
    }
  | {
      type: "PATCH_RECOVERY";
      patch: Partial<Extract<AppSurface, { kind: "recovery" }>>;
    };

export function createInitialState(): AppState {
  return {
    generation: 0,
    engineStatus: "connecting",
    engineMessage: null,
    surface: { kind: "boot", message: "Starting" },
    bootError: null,
    mutationsEnabled: false,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "BOOT_START":
      // Full cold boot only — reconnect/retry on a hydrated surface must not
      // replace content via this action (see rehydrate path in controller).
      return {
        ...state,
        generation: action.generation,
        engineStatus: "connecting",
        bootError: null,
        mutationsEnabled: false,
        surface: { kind: "boot", message: "Starting" },
      };
    case "ENGINE_STATUS":
      return {
        ...state,
        engineStatus: action.status,
        engineMessage: action.message ?? null,
        mutationsEnabled:
          action.status === "connected" ? state.mutationsEnabled : false,
      };
    case "SET_SURFACE":
      return { ...state, surface: action.surface };
    case "SET_BOOT_ERROR":
      return {
        ...state,
        bootError: action.error,
        surface: {
          kind: "boot",
          message: action.error?.message ?? "Engine unavailable",
          error: action.error,
        },
        mutationsEnabled: false,
      };
    case "SET_MUTATIONS_ENABLED":
      return { ...state, mutationsEnabled: action.enabled };
    case "PATCH_WORKBENCH": {
      if (state.surface.kind !== "workbench") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "workbench" },
      };
    }
    case "PATCH_QA": {
      if (state.surface.kind !== "qa") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "qa" },
      };
    }
    case "PATCH_EXPORT": {
      if (state.surface.kind !== "export") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "export" },
      };
    }
    case "PATCH_PROJECTS": {
      if (state.surface.kind !== "projects") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "projects" },
      };
    }
    case "PATCH_IMPORT": {
      if (state.surface.kind !== "import-document") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "import-document" },
      };
    }
    case "PATCH_CREATE": {
      if (state.surface.kind !== "create-project") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "create-project" },
      };
    }
    case "PATCH_RECOVERY": {
      if (state.surface.kind !== "recovery") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "recovery" },
      };
    }
    default:
      return state;
  }
}

export const TM_PANEL_PREF_KEY = "translunar.renderer.tm-panel.v1";

export function readTmCollapsed(
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  try {
    return storage.getItem(TM_PANEL_PREF_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function writeTmCollapsed(
  collapsed: boolean,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(TM_PANEL_PREF_KEY, collapsed ? "collapsed" : "open");
}
