import type {
  Document,
  GlobalSearchHit,
  Project,
  ProjectAnalyticsSummary,
  ProjectBatchImportResult,
  ProjectTemplate,
  QaGateResult,
  QaIssueView,
  QaRun,
  RecycleEntry,
  SegmentCounts,
  SegmentEditorRow,
  TemplateDependencyDiagnostic,
} from "@translunar/contracts";

import type { DraftJournalRecord } from "../../shared/product-shell";
import type { UiError } from "../lib/errors";
import type { SegmentIntel } from "./segment-intel";
import type { SessionIdentity } from "./session";
import type {
  AiControlSection,
  CollaborationSection,
  P4ProjectContext,
  P4ReturnTarget,
  PluginsSection,
  SettingsSection,
} from "./p4-route-context";

export type EngineConnectionStatus =
  | "unknown"
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | "failed";

export type AssetHubSection =
  "tm" | "termbase" | "alignment" | "corpus" | "catalog" | "curation";

export type {
  AiControlSection,
  CollaborationSection,
  P4ProjectContext,
  P4ReturnTarget,
  PluginsSection,
  SettingsSection,
};

export type SurfaceKind =
  | "boot"
  | "recovery"
  | "welcome"
  | "projects"
  | "create-project"
  | "import-document"
  | "workbench"
  | "qa"
  | "export"
  | "templates"
  | "recycle"
  | "search"
  | "insights"
  | "assets"
  | "ai-control"
  | "plugins"
  | "collaboration"
  | "settings";

export type ProjectListLifecycle = "active" | "archived";

/**
 * Who the Engine records as responsible for a desktop action.
 *
 * This build is single-user by design, so there is nobody else it could be,
 * and prompting for a name on every waiver would be friction with no
 * information behind it. The Engine's own audit trail uses the same string.
 */
export const DESKTOP_ACTOR = "desktop";

export interface SessionContext {
  session: SessionIdentity;
  project: Project;
  document: Document;
  /** Engine-ordered active project documents (presentation cache). */
  documents: Document[];
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
  | { kind: "welcome"; error?: UiError | null; pendingExample?: boolean }
  | {
      kind: "projects";
      projects: Project[];
      lifecycle: ProjectListLifecycle;
      total: number;
      offset: number;
      limit: number;
      error?: UiError | null;
      loading?: boolean;
      pendingExample?: boolean;
      actionError?: UiError | null;
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
      templateDiagnostics?: TemplateDependencyDiagnostic[] | null;
      batchResult?: ProjectBatchImportResult | null;
    }
  | {
      kind: "workbench";
      ctx: SessionContext;
      activeSegmentId: string | null;
      focusSegmentId: string | null;
      /** Results for the segment under the caret; see state/segment-intel.ts. */
      intel: SegmentIntel;
      tmCollapsed: boolean;
      transitionError: UiError | null;
      pendingConfirm: boolean;
      switchPending?: boolean;
      batchResult?: ProjectBatchImportResult | null;
      addFilesPending?: boolean;
      /**
       * What the last confirmation did to segments other than the one the
       * translator was looking at. The Engine propagates a confirmed target to
       * repeated source text; saying so is the difference between leverage and
       * a document that quietly filled itself in.
       */
      propagatedFrom?: { segmentId: string; count: number } | null;
      /**
       * Open QA findings per segment, for the row marks and the QA filter.
       * Refreshed whenever the document changes or a run completes; a stale
       * mark is worse than none because it sends a reviewer to a clean row.
       */
      qaCounts?: Readonly<Record<string, number>>;
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
    }
  | {
      kind: "templates";
      items: ProjectTemplate[];
      total: number;
      offset: number;
      limit: number;
      loading: boolean;
      error: UiError | null;
      pending: boolean;
      selected: ProjectTemplate | null;
      mode: "list" | "create" | "edit" | "use";
    }
  | {
      kind: "recycle";
      items: RecycleEntry[];
      total: number;
      offset: number;
      limit: number;
      loading: boolean;
      error: UiError | null;
      pending: boolean;
    }
  | {
      kind: "search";
      /** Last successfully committed query projection. */
      submittedQuery: string;
      /** Query currently in flight (not yet committed). */
      pendingQuery: string | null;
      items: GlobalSearchHit[];
      total: number;
      offset: number;
      limit: number;
      loading: boolean;
      error: UiError | null;
      navigationError: UiError | null;
    }
  | {
      kind: "insights";
      projectId: string;
      projectName: string;
      returnTo: "workbench" | "projects";
      session: SessionIdentity | null;
      analytics: ProjectAnalyticsSummary | null;
      documents: Document[];
      loading: boolean;
      error: UiError | null;
    }
  | {
      kind: "assets";
      projectId: string;
      projectName: string;
      sourceLocale: string;
      targetLocale: string;
      returnTo: "workbench" | "projects";
      session: SessionIdentity | null;
      section: AssetHubSection;
    }
  | {
      kind: "ai-control";
      returnTarget: P4ReturnTarget;
      context: P4ProjectContext | null;
      section: AiControlSection;
    }
  | {
      kind: "plugins";
      returnTarget: P4ReturnTarget;
      context: P4ProjectContext | null;
      section: PluginsSection;
    }
  | {
      kind: "collaboration";
      returnTarget: P4ReturnTarget;
      context: P4ProjectContext;
      section: CollaborationSection;
    }
  | {
      kind: "settings";
      returnTarget: P4ReturnTarget;
      context: P4ProjectContext | null;
      section: SettingsSection;
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
  /**
   * Merge one dock's results into the intelligence record.
   *
   * The docks answer in whatever order the Engine gets to them, so each result
   * has to be merged against the state as it is at the moment it lands.
   * Read-modify-write from a snapshot taken before the request went out means
   * whichever dock answers last erases the other one.
   */
  | {
      type: "PATCH_SEGMENT_INTEL";
      segmentId: string;
      patch: Partial<Pick<SegmentIntel, "tm" | "terms" | "concordance">>;
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
    }
  | {
      type: "PATCH_TEMPLATES";
      patch: Partial<Extract<AppSurface, { kind: "templates" }>>;
    }
  | {
      type: "PATCH_RECYCLE";
      patch: Partial<Extract<AppSurface, { kind: "recycle" }>>;
    }
  | {
      type: "PATCH_SEARCH";
      patch: Partial<Extract<AppSurface, { kind: "search" }>>;
    }
  | {
      type: "PATCH_INSIGHTS";
      patch: Partial<Extract<AppSurface, { kind: "insights" }>>;
    }
  | {
      type: "PATCH_ASSETS";
      patch: Partial<Extract<AppSurface, { kind: "assets" }>>;
    }
  | {
      type: "PATCH_WELCOME";
      patch: Partial<Extract<AppSurface, { kind: "welcome" }>>;
    }
  | {
      type: "PATCH_AI_CONTROL";
      patch: Partial<Extract<AppSurface, { kind: "ai-control" }>>;
    }
  | {
      type: "PATCH_PLUGINS";
      patch: Partial<Extract<AppSurface, { kind: "plugins" }>>;
    }
  | {
      type: "PATCH_COLLABORATION";
      patch: Partial<Extract<AppSurface, { kind: "collaboration" }>>;
    }
  | {
      type: "PATCH_SETTINGS";
      patch: Partial<Extract<AppSurface, { kind: "settings" }>>;
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
    case "PATCH_SEGMENT_INTEL": {
      if (state.surface.kind !== "workbench") return state;
      // A late answer about a segment the translator has already left is not
      // an answer, it is noise.
      if (state.surface.activeSegmentId !== action.segmentId) return state;
      return {
        ...state,
        surface: {
          ...state.surface,
          intel: {
            ...state.surface.intel,
            segmentId: action.segmentId,
            ...action.patch,
          },
        },
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
    case "PATCH_TEMPLATES": {
      if (state.surface.kind !== "templates") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "templates" },
      };
    }
    case "PATCH_RECYCLE": {
      if (state.surface.kind !== "recycle") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "recycle" },
      };
    }
    case "PATCH_SEARCH": {
      if (state.surface.kind !== "search") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "search" },
      };
    }
    case "PATCH_INSIGHTS": {
      if (state.surface.kind !== "insights") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "insights" },
      };
    }
    case "PATCH_ASSETS": {
      if (state.surface.kind !== "assets") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "assets" },
      };
    }
    case "PATCH_WELCOME": {
      if (state.surface.kind !== "welcome") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "welcome" },
      };
    }
    case "PATCH_AI_CONTROL": {
      if (state.surface.kind !== "ai-control") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "ai-control" },
      };
    }
    case "PATCH_PLUGINS": {
      if (state.surface.kind !== "plugins") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "plugins" },
      };
    }
    case "PATCH_COLLABORATION": {
      if (state.surface.kind !== "collaboration") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "collaboration" },
      };
    }
    case "PATCH_SETTINGS": {
      if (state.surface.kind !== "settings") return state;
      return {
        ...state,
        surface: { ...state.surface, ...action.patch, kind: "settings" },
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
