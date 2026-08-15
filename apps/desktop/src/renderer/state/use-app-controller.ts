import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  Document,
  GlobalSearchHit,
  Project,
  Segment,
  SegmentCounts,
  SegmentEditorRow,
  TmMatch,
} from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { desktopApi, initializeEngine, invokeEngine } from "../lib/rpc";
import {
  shouldBlockConfirm,
  createCompositionState,
  onCompositionEnd,
  onCompositionStart,
  type CompositionState,
} from "../lib/ime";
import { resolveOpenProjectRoute } from "../routes/resolveSurface";
import {
  appReducer,
  createInitialState,
  readTmCollapsed,
  writeTmCollapsed,
  type AiControlSection,
  type AppState,
  type AssetHubSection,
  type CollaborationSection,
  type PluginsSection,
  type ProjectListLifecycle,
  type SessionContext,
  type SettingsSection,
} from "./app-state";
import {
  collaborationAvailable,
  defaultAiSection,
  resolveP4ReturnTarget,
  resolveP4RouteContext,
} from "./p4-route-context";
import {
  confirmModeFromEvent,
  nextSegmentAfterConfirm,
} from "./confirm-advance";
import {
  canStoreTerm,
  concordanceQueryFor,
  readSegmentSelection,
  type SegmentSelection,
} from "./editor-selection";
import { countsFromEditorRows } from "./editor-operations";
import { EMPTY_SEGMENT_INTEL, type SegmentIntel } from "./segment-intel";
// AppState imported for FeatureOp origin typing.
import {
  aggregateProjectDocuments,
  chooseImportOpenDocumentId,
  DOCUMENT_PAGE_LIMIT,
  resolvePostDeleteDocumentRoute,
} from "./document-navigation";
import { classifyDraftJournal, probesFromRows } from "./draft-recovery";
import { SaveCoordinator } from "./save-coordinator";
import { classifySearchHit, trimSearchQuery } from "./search-navigation";
import {
  clearSessionStorage,
  makeSession,
  readSessionFromStorage,
  writeSessionToStorage,
  type SessionIdentity,
} from "./session";
import {
  createTemplateDefinition,
  isBuiltInTemplate,
  mergeTemplateDefinition,
  type P1TemplateDefaults,
} from "./template-definition";

const PAGE_LIMIT = 200;
const PROJECT_PAGE_LIMIT = 50;
const TEMPLATE_PAGE_LIMIT = 50;
const RECYCLE_PAGE_LIMIT = 50;
const SEARCH_PAGE_LIMIT = 25;

type SurfaceKindName = AppState["surface"]["kind"];

interface FeatureOp {
  generation: number;
  opId: number;
  /** When set, the live surface must still match before committing. */
  origin: SurfaceKindName | null;
}

function snapshotActiveDraft(saveCoordinator: SaveCoordinator): {
  segmentId: string;
  draftTarget: string;
  expectedRevision: number;
  editGeneration: number;
} | null {
  const active = saveCoordinator.active;
  if (!active) return null;
  if (!saveCoordinator.isDirty() && !active.isComposing) return null;
  return {
    segmentId: active.segmentId,
    draftTarget: active.draftTarget,
    expectedRevision: active.expectedRevision,
    editGeneration: active.editGeneration,
  };
}

async function listProjectsPage(
  lifecycle: ProjectListLifecycle = "active",
  offset = 0,
  limit = PROJECT_PAGE_LIMIT,
): Promise<{
  items: Project[];
  total: number;
  offset: number;
  limit: number;
}> {
  const page = await invokeEngine("project.list", {
    limit,
    offset,
    lifecycle,
  });
  return {
    items: page.items,
    total: page.total,
    offset: page.offset ?? offset,
    limit: page.limit || limit,
  };
}

async function listAllDocuments(projectId: string): Promise<Document[]> {
  const result = await aggregateProjectDocuments(
    projectId,
    async (id, offset, limit) => {
      const page = await invokeEngine("document.list", {
        projectId: id,
        limit,
        offset,
      });
      return {
        items: page.items,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
      };
    },
    { limit: DOCUMENT_PAGE_LIMIT },
  );
  if (!result.ok) {
    throw Object.assign(new Error(result.error.message), {
      code: result.error.code,
    });
  }
  return result.documents;
}

async function listAllEditorRows(documentId: string): Promise<{
  rows: SegmentEditorRow[];
  total: number;
}> {
  const rows: SegmentEditorRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await invokeEngine("segment.editor.list", {
      documentId,
      limit: PAGE_LIMIT,
      offset,
      sort: "ordinal",
    });
    rows.push(...page.items);
    if (rows.length >= page.total || page.items.length === 0) {
      return { rows, total: page.total };
    }
    offset += page.items.length;
  }
}

function countsFromRows(rows: SegmentEditorRow[]): SegmentCounts {
  let confirmed = 0;
  let draft = 0;
  let untranslated = 0;
  for (const row of rows) {
    const state = row.segment.state;
    if (state === "confirmed") confirmed += 1;
    else if (state === "draft") draft += 1;
    else untranslated += 1;
  }
  return {
    confirmed,
    draft,
    untranslated,
    total: rows.length,
    openIssues: 0,
  };
}

function replaceRow(
  rows: SegmentEditorRow[],
  segment: Segment,
): SegmentEditorRow[] {
  return rows.map((row) =>
    row.segment.id === segment.id ? { ...row, segment } : row,
  );
}

export interface AppController {
  state: AppState;
  saveTick: number;
  composition: CompositionState;
  saveCoordinator: SaveCoordinator;
  /** Bumps on reconnect / feature invalidation for editor & asset op tokens. */
  featureGeneration: number;
  commands: {
    retryBoot: () => void;
    restartEngine: () => Promise<void>;
    recoverDraft: () => Promise<void>;
    discardDraft: () => Promise<void>;
    goCreateProject: () => void;
    goHome: () => Promise<void>;
    createProject: (input: {
      name: string;
      domain: string;
      sourceLocale: string;
      targetLocale: string;
    }) => Promise<void>;
    openProject: (projectId: string) => Promise<void>;
    importDocument: () => Promise<void>;
    selectSegment: (segmentId: string) => Promise<void>;
    updateTargetDraft: (text: string) => void;
    compositionStart: () => void;
    compositionEnd: () => void;
    confirmSegment: (event?: {
      isComposing?: boolean;
      keyCode?: number;
      which?: number;
      altKey?: boolean;
      shiftKey?: boolean;
    }) => Promise<void>;
    toggleTmPanel: () => void;
    applyTmMatch: (match: TmMatch) => void;
    insertAtCaret: (text: string) => void;
    runConcordance: (query?: string, selection?: SegmentSelection) => void;
    quickAddTerm: (selection: SegmentSelection) => Promise<void>;
    copySourceToTarget: () => void;
    clearTarget: () => void;
    goQa: () => Promise<void>;
    runQa: () => Promise<void>;
    jumpToIssue: (segmentId: string) => Promise<void>;
    goExport: () => Promise<void>;
    checkGateAndExport: () => Promise<void>;
    backToWorkbench: (focusSegmentId?: string | null) => Promise<void>;
    // P1
    switchDocument: (documentId: string) => Promise<void>;
    addFiles: () => Promise<void>;
    dismissBatchSummary: () => void;
    openExample: () => Promise<void>;
    goSearch: () => Promise<void>;
    runSearch: (query: string) => Promise<void>;
    searchPage: (offset: number) => Promise<void>;
    activateSearchHit: (hit: GlobalSearchHit) => Promise<void>;
    goInsights: (projectId?: string) => Promise<void>;
    refreshInsights: () => Promise<void>;
    backFromInsights: () => Promise<void>;
    goAssets: (projectId?: string) => Promise<void>;
    setAssetsSection: (section: AssetHubSection) => void;
    backFromAssets: () => Promise<void>;
    goAiControl: (section?: AiControlSection) => Promise<void>;
    setAiControlSection: (section: AiControlSection) => void;
    goPlugins: (section?: PluginsSection) => Promise<void>;
    setPluginsSection: (section: PluginsSection) => void;
    goCollaboration: (section?: CollaborationSection) => Promise<void>;
    setCollaborationSection: (section: CollaborationSection) => void;
    goSettings: (section?: SettingsSection) => Promise<void>;
    setSettingsSection: (section: SettingsSection) => void;
    backFromP4: () => Promise<void>;
    /** After workspace restore: clear session and cold-route from Engine/shell. */
    coldRouteAfterRestore: () => Promise<void>;
    /** Apply authoritative editor rows after P2 mutations. */
    applyWorkbenchRows: (input: {
      rows: SegmentEditorRow[];
      counts: SegmentCounts | null;
      activeSegmentId: string | null;
      focusSegmentId: string | null;
    }) => void;
    refreshWorkbenchRows: (focusSegmentId?: string | null) => Promise<void>;
    flushOrStay: () => Promise<boolean>;
    goTemplates: () => Promise<void>;
    templatesPage: (offset: number) => Promise<void>;
    templateCreateStart: () => void;
    templateEditStart: (templateId: string, revision: number) => Promise<void>;
    templateUseStart: (templateId: string, revision: number) => Promise<void>;
    templateCancelMode: () => void;
    templateCreate: (input: {
      name: string;
      description: string;
      defaults: P1TemplateDefaults;
    }) => Promise<void>;
    templateUpdate: (input: {
      templateId: string;
      expectedRevision: number;
      name: string;
      description: string;
      defaults: P1TemplateDefaults;
    }) => Promise<void>;
    templateDelete: (
      templateId: string,
      expectedRevision: number,
    ) => Promise<boolean>;
    createFromTemplate: (input: {
      templateId: string;
      templateRevision: number;
      name: string;
      sourceLocale: string;
      targetLocale: string;
      domain: string;
    }) => Promise<void>;
    goRecycle: () => Promise<void>;
    recyclePage: (offset: number) => Promise<void>;
    recycleRestore: (entryId: string) => Promise<boolean>;
    recyclePurge: (entryId: string) => Promise<boolean>;
    setProjectListLifecycle: (lifecycle: ProjectListLifecycle) => Promise<void>;
    projectsPage: (offset: number) => Promise<void>;
    beginEditProject: (projectId: string) => Promise<Project | null>;
    updateProject: (input: {
      projectId: string;
      expectedRevision: number;
      name: string;
      domain: string;
      sourceLocale: string;
      targetLocale: string;
      configuration: Project["configuration"];
    }) => Promise<boolean>;
    setProjectLifecycle: (
      projectId: string,
      expectedRevision: number,
      lifecycle: "active" | "archived",
    ) => Promise<boolean>;
    recycleProject: (
      projectId: string,
      expectedRevision: number,
      reason: string,
    ) => Promise<boolean>;
    recycleActiveDocument: (reason: string) => Promise<boolean>;
  };
}

export function useAppController(): AppController {
  const [state, dispatch] = useReducer(
    appReducer,
    undefined,
    createInitialState,
  );
  const [saveTick, setSaveTick] = useState(0);
  const [featureGeneration, setFeatureGeneration] = useState(0);
  const generationRef = useRef(0);
  const openProjectOpRef = useRef(0);
  const qaLoadOpRef = useRef(0);
  const switchDocOpRef = useRef(0);
  const importOpRef = useRef(0);
  const exampleOpRef = useRef(0);
  const searchOpRef = useRef(0);
  const insightsOpRef = useRef(0);
  const assetsOpRef = useRef(0);
  const templatesOpRef = useRef(0);
  const recycleOpRef = useRef(0);
  const lifecycleOpRef = useRef(0);
  /** Synchronous guard so double-activation cannot race React re-render. */
  const addFilesGuardRef = useRef(false);
  const rehydrateRef = useRef<((gen: number) => Promise<void>) | null>(null);
  const compositionRef = useRef(createCompositionState());
  /**
   * Pending multi-record recovery drafts retained until each segment is visited
   * and its matching domain save succeeds. Not limited to the active segment.
   */
  const pendingRecoveredRef = useRef<{
    drafts: Map<string, string>;
    revisions: Map<string, number>;
  }>({ drafts: new Map(), revisions: new Map() });
  const saveCoordinator = useMemo(
    () =>
      new SaveCoordinator({
        onChange: () => setSaveTick((n) => n + 1),
      }),
    [],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const isCurrent = useCallback((generation: number) => {
    return generationRef.current === generation;
  }, []);

  const invalidateFeatureOps = useCallback(() => {
    openProjectOpRef.current += 1;
    qaLoadOpRef.current += 1;
    switchDocOpRef.current += 1;
    importOpRef.current += 1;
    exampleOpRef.current += 1;
    searchOpRef.current += 1;
    insightsOpRef.current += 1;
    assetsOpRef.current += 1;
    templatesOpRef.current += 1;
    recycleOpRef.current += 1;
    lifecycleOpRef.current += 1;
    setFeatureGeneration((n) => n + 1);
  }, []);

  const beginOp = useCallback(
    (
      ref: { current: number },
      origin: SurfaceKindName | null = null,
    ): FeatureOp => ({
      generation: generationRef.current,
      opId: ++ref.current,
      origin,
    }),
    [],
  );

  const isOpCurrent = useCallback((op: FeatureOp, ref: { current: number }) => {
    if (generationRef.current !== op.generation) return false;
    if (ref.current !== op.opId) return false;
    if (op.origin !== null && stateRef.current.surface.kind !== op.origin) {
      return false;
    }
    return true;
  }, []);

  const hydrateSession = useCallback(
    async (session: SessionIdentity): Promise<SessionContext> => {
      const snapshot = await invokeEngine("project.get", {
        projectId: session.projectId,
      });
      const document = await invokeEngine("document.get", {
        documentId: session.documentId,
      });
      if (document.projectId !== session.projectId) {
        throw Object.assign(new Error("Document does not belong to project."), {
          code: "SESSION_INVALID",
        });
      }
      const documents = await listAllDocuments(session.projectId);
      if (!documents.some((d) => d.id === document.id)) {
        // Document must be in the authoritative active list — never fabricate.
        throw Object.assign(
          new Error("Document is not in the active project document list."),
          { code: "SESSION_STALE" },
        );
      }
      const { rows } = await listAllEditorRows(session.documentId);
      const counts = snapshot.counts ?? countsFromRows(rows);
      return {
        session,
        project: snapshot.project,
        document,
        documents,
        rows,
        counts,
      };
    },
    [],
  );

  const mergePendingRecovered = useCallback(
    (
      drafts?: Map<string, string>,
      revisions?: Map<string, number>,
      replace = false,
    ) => {
      if (replace) {
        pendingRecoveredRef.current.drafts = new Map(drafts ?? []);
        pendingRecoveredRef.current.revisions = new Map(revisions ?? []);
        return;
      }
      if (drafts) {
        for (const [id, text] of drafts) {
          pendingRecoveredRef.current.drafts.set(id, text);
        }
      }
      if (revisions) {
        for (const [id, rev] of revisions) {
          pendingRecoveredRef.current.revisions.set(id, rev);
        }
      }
    },
    [],
  );

  const attachSegmentWithPending = useCallback(
    (
      ctx: SessionContext,
      segmentId: string,
      engineTarget: string,
      engineRevision: number,
    ) => {
      const pendingDraft = pendingRecoveredRef.current.drafts.get(segmentId);
      const pendingRevision =
        pendingRecoveredRef.current.revisions.get(segmentId);
      saveCoordinator.attachSegment({
        segmentId,
        documentId: ctx.document.id,
        projectId: ctx.project.id,
        engineTarget,
        expectedRevision:
          pendingRevision !== undefined ? pendingRevision : engineRevision,
        ...(pendingDraft !== undefined ? { initialDraft: pendingDraft } : {}),
      });
    },
    [saveCoordinator],
  );

  const enterWorkbench = useCallback(
    (
      ctx: SessionContext,
      options?: {
        focusSegmentId?: string | null;
        recoveredDrafts?: Map<string, string>;
        /** When recovering, prefer journaled expectedRevision over Engine rewrite. */
        recoveredRevisions?: Map<string, number>;
        /** Replace (true) vs merge (false) pending multi-record recovery maps. */
        replacePendingRecovered?: boolean;
        persistSession?: boolean;
      },
    ) => {
      const firstId = ctx.rows[0]?.segment.id ?? null;
      const activeSegmentId = options?.focusSegmentId ?? firstId;
      const tmCollapsed = readTmCollapsed();
      if (options?.recoveredDrafts || options?.recoveredRevisions) {
        mergePendingRecovered(
          options.recoveredDrafts,
          options.recoveredRevisions,
          options.replacePendingRecovered === true,
        );
      }
      dispatch({
        type: "SET_SURFACE",
        surface: {
          kind: "workbench",
          ctx,
          activeSegmentId,
          focusSegmentId: options?.focusSegmentId ?? null,
          intel: EMPTY_SEGMENT_INTEL,
          tmCollapsed,
          transitionError: null,
          pendingConfirm: false,
          switchPending: false,
          addFilesPending: false,
          batchResult: null,
        },
      });
      dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
      if (options?.persistSession !== false) {
        writeSessionToStorage(ctx.session);
      }
      if (activeSegmentId) {
        const row = ctx.rows.find((r) => r.segment.id === activeSegmentId);
        if (row) {
          attachSegmentWithPending(
            ctx,
            row.segment.id,
            row.segment.targetText,
            row.segment.revision,
          );
        }
      } else {
        saveCoordinator.clearActive();
      }
    },
    [attachSegmentWithPending, mergePendingRecovered, saveCoordinator],
  );

  const resolveHome = useCallback(
    async (lifecycle: ProjectListLifecycle = "active") => {
      const page = await listProjectsPage(lifecycle, 0, PROJECT_PAGE_LIMIT);
      if (page.total === 0 && lifecycle === "active") {
        dispatch({ type: "SET_SURFACE", surface: { kind: "welcome" } });
      } else {
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "projects",
            projects: page.items,
            lifecycle,
            total: page.total,
            offset: page.offset,
            limit: page.limit,
          },
        });
      }
      dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
    },
    [],
  );

  const boot = useCallback(
    async (generation: number) => {
      dispatch({ type: "BOOT_START", generation });
      try {
        await initializeEngine();
        if (!isCurrent(generation)) return;

        dispatch({ type: "ENGINE_STATUS", status: "connected" });

        const journal = await desktopApi().getDraftJournal();
        const sessionParse = readSessionFromStorage();
        let candidate: SessionIdentity | null = sessionParse.ok
          ? sessionParse.session
          : null;

        const classification = classifyDraftJournal(
          journal,
          candidate ??
            (journal.records[0]
              ? {
                  version: 1,
                  projectId: journal.records[0].projectId,
                  documentId: journal.records[0].documentId,
                }
              : null),
        );

        if (classification.kind === "recoverable") {
          // Validate session + every journaled segment/revision before Recover.
          try {
            const ctx = await hydrateSession(classification.session);
            if (!isCurrent(generation)) return;
            const validated = classifyDraftJournal(
              journal,
              classification.session,
              probesFromRows(ctx.rows),
            );
            if (validated.kind === "recoverable") {
              dispatch({
                type: "SET_SURFACE",
                surface: {
                  kind: "recovery",
                  mode: "recoverable",
                  records: validated.records,
                  session: validated.session,
                  ...(validated.staleRecords.length > 0
                    ? {
                        reason: `${validated.staleRecords.length} journal record(s) are stale and will be ignored.`,
                      }
                    : {}),
                },
              });
              dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
              return;
            }
            // Segment missing or revision mismatch — stale, not recoverable.
            dispatch({
              type: "SET_SURFACE",
              surface: {
                kind: "recovery",
                mode: "stale",
                records: classification.records,
                session: classification.session,
                reason:
                  validated.kind === "stale"
                    ? validated.reason
                    : "Draft journal is no longer recoverable.",
              },
            });
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            return;
          } catch (error) {
            const ui = toUiError(error);
            if (ui.kind === "transport") {
              if (!isCurrent(generation)) return;
              dispatch({ type: "SET_BOOT_ERROR", error: ui });
              return;
            }
            // Domain invalid — treat as stale recovery.
            if (!isCurrent(generation)) return;
            dispatch({
              type: "SET_SURFACE",
              surface: {
                kind: "recovery",
                mode: "stale",
                records: classification.records,
                session: classification.session,
                reason: ui.message,
              },
            });
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            return;
          }
        }

        if (classification.kind === "stale") {
          if (!isCurrent(generation)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "recovery",
              mode: "stale",
              records: classification.records,
              session: null,
              reason: classification.reason,
            },
          });
          dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
          return;
        }

        // Empty journal path: validate session or go home.
        if (candidate) {
          try {
            const ctx = await hydrateSession(candidate);
            if (!isCurrent(generation)) return;
            enterWorkbench(ctx, { persistSession: true });
            return;
          } catch (error) {
            const ui = toUiError(error);
            if (ui.kind === "transport") {
              if (!isCurrent(generation)) return;
              dispatch({ type: "SET_BOOT_ERROR", error: ui });
              return;
            }
            clearSessionStorage();
            candidate = null;
          }
        } else if (!sessionParse.ok && sessionParse.reason !== "missing") {
          clearSessionStorage();
        }

        if (!isCurrent(generation)) return;
        await resolveHome();
      } catch (error) {
        if (!isCurrent(generation)) return;
        dispatch({
          type: "ENGINE_STATUS",
          status: "failed",
          message: toUiError(error).message,
        });
        dispatch({ type: "SET_BOOT_ERROR", error: toUiError(error) });
      }
    },
    [enterWorkbench, hydrateSession, isCurrent, resolveHome],
  );

  // Startup + engine status subscriptions (Strict Mode safe).
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    void boot(generation);

    const unsubStatus = desktopApi().onEngineStatus((payload) => {
      if (payload.type === "reconnecting") {
        dispatch({
          type: "ENGINE_STATUS",
          status: "reconnecting",
          message: payload.message ?? `Reconnecting (${payload.attempt ?? 0})`,
        });
        dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: false });
      } else if (payload.type === "failed") {
        dispatch({
          type: "ENGINE_STATUS",
          status: "failed",
          message: payload.message ?? "Engine failed",
        });
        dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: false });
      } else if (payload.type === "reconnected") {
        dispatch({
          type: "ENGINE_STATUS",
          status: "connected",
          message: null,
        });
      }
    });

    const rehydrateHydratedSurface = async (gen: number) => {
      dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: false });
      dispatch({
        type: "ENGINE_STATUS",
        status: "connecting",
        message: "Rehydrating",
      });
      /** Local flag — stateRef lags until React re-renders after dispatch. */
      let revalidationOk = false;
      try {
        await initializeEngine();
        if (!isCurrent(gen)) return;
        const current = stateRef.current.surface;
        if (
          current.kind === "workbench" ||
          current.kind === "qa" ||
          current.kind === "export"
        ) {
          // Snapshot dirty draft before rehydrate so reconnect cannot drop it.
          const draftSnap =
            current.kind === "workbench"
              ? snapshotActiveDraft(saveCoordinator)
              : null;
          const focusId =
            current.kind === "workbench" ? current.activeSegmentId : null;
          const ctx = await hydrateSession(current.ctx.session);
          if (!isCurrent(gen)) return;
          if (current.kind === "workbench") {
            const recoveredDrafts = new Map<string, string>();
            if (draftSnap) {
              recoveredDrafts.set(draftSnap.segmentId, draftSnap.draftTarget);
            }
            enterWorkbench(ctx, {
              focusSegmentId: focusId ?? draftSnap?.segmentId ?? null,
              ...(recoveredDrafts.size > 0 ? { recoveredDrafts } : {}),
              persistSession: true,
            });
            revalidationOk = true;
          } else if (current.kind === "qa") {
            // Refresh QA issues on reconnect; do not invent empty success.
            dispatch({
              type: "SET_SURFACE",
              surface: {
                ...current,
                ctx,
                loading: true,
                error: null,
              },
            });
            try {
              const issues = await invokeEngine("qa.issue.list", {
                projectId: ctx.project.id,
                documentId: ctx.document.id,
                limit: PAGE_LIMIT,
                offset: 0,
              });
              if (!isCurrent(gen)) return;
              if (stateRef.current.surface.kind !== "qa") return;
              dispatch({
                type: "PATCH_QA",
                patch: {
                  issues: issues.items,
                  issuesLoaded: true,
                  loading: false,
                  error: null,
                },
              });
              dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
              revalidationOk = true;
            } catch (error) {
              if (!isCurrent(gen)) return;
              if (stateRef.current.surface.kind !== "qa") return;
              dispatch({
                type: "PATCH_QA",
                patch: {
                  loading: false,
                  error: toUiError(error),
                },
              });
              // Keep mutations disabled until a successful revalidation.
            }
          } else {
            dispatch({
              type: "SET_SURFACE",
              surface: {
                ...current,
                ctx,
              },
            });
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            revalidationOk = true;
          }
        } else if (current.kind === "insights") {
          try {
            if (current.session) {
              await hydrateSession(current.session);
            } else {
              await invokeEngine("project.get", {
                projectId: current.projectId,
              });
            }
            if (!isCurrent(gen)) return;
            const analytics = await invokeEngine("project.analytics.get", {
              projectId: current.projectId,
            });
            const documents = await listAllDocuments(current.projectId);
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind !== "insights") return;
            dispatch({
              type: "PATCH_INSIGHTS",
              patch: {
                analytics,
                documents,
                loading: false,
                error: null,
              },
            });
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            revalidationOk = true;
          } catch (error) {
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind === "insights") {
              dispatch({
                type: "PATCH_INSIGHTS",
                patch: { loading: false, error: toUiError(error) },
              });
            }
            // Keep mutations disabled until a successful revalidation.
          }
        } else if (current.kind === "projects") {
          try {
            const page = await listProjectsPage(
              current.lifecycle,
              current.offset,
              current.limit || PROJECT_PAGE_LIMIT,
            );
            if (!isCurrent(gen)) return;
            dispatch({
              type: "SET_SURFACE",
              surface: {
                kind: "projects",
                projects: page.items,
                lifecycle: current.lifecycle,
                total: page.total,
                offset: page.offset,
                limit: page.limit,
              },
            });
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            revalidationOk = true;
          } catch (error) {
            if (!isCurrent(gen)) return;
            dispatch({
              type: "PATCH_PROJECTS",
              patch: { loading: false, error: toUiError(error) },
            });
            // Keep mutations disabled until a successful revalidation.
          }
        } else if (current.kind === "templates") {
          try {
            const page = await invokeEngine("project.template.list", {
              limit: current.limit,
              offset: current.offset,
            });
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind !== "templates") return;
            dispatch({
              type: "PATCH_TEMPLATES",
              patch: {
                items: page.items,
                total: page.total,
                loading: false,
                error: null,
              },
            });
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            revalidationOk = true;
          } catch (error) {
            if (!isCurrent(gen)) return;
            dispatch({
              type: "PATCH_TEMPLATES",
              patch: { loading: false, error: toUiError(error) },
            });
            // Keep mutations disabled until a successful revalidation.
          }
        } else if (current.kind === "recycle") {
          try {
            const page = await invokeEngine("recycle.list", {
              limit: current.limit,
              offset: current.offset,
            });
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind !== "recycle") return;
            dispatch({
              type: "PATCH_RECYCLE",
              patch: {
                items: page.items,
                total: page.total,
                loading: false,
                error: null,
              },
            });
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            revalidationOk = true;
          } catch (error) {
            if (!isCurrent(gen)) return;
            dispatch({
              type: "PATCH_RECYCLE",
              patch: { loading: false, error: toUiError(error) },
            });
            // Keep mutations disabled until a successful revalidation.
          }
        } else if (current.kind === "search" && current.submittedQuery) {
          try {
            const page = await invokeEngine("search.global", {
              text: current.submittedQuery,
              includeRecycled: false,
              offset: current.offset,
              limit: current.limit,
            });
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind !== "search") return;
            dispatch({
              type: "PATCH_SEARCH",
              patch: {
                items: page.items,
                total: page.total,
                loading: false,
                error: null,
                pendingQuery: null,
              },
            });
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            revalidationOk = true;
          } catch (error) {
            if (!isCurrent(gen)) return;
            dispatch({
              type: "PATCH_SEARCH",
              patch: {
                loading: false,
                error: toUiError(error),
                pendingQuery: current.submittedQuery,
              },
            });
            // Keep mutations disabled until a successful revalidation.
          }
        } else if (current.kind === "boot" || current.kind === "recovery") {
          await boot(gen);
          revalidationOk = true;
        } else if (current.kind === "assets") {
          // Revalidate project + session identity before Asset Hub mutations resume.
          try {
            const project = await invokeEngine("project.get", {
              projectId: current.projectId,
            });
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind !== "assets") return;
            let session = current.session;
            if (session) {
              try {
                await hydrateSession(session);
              } catch {
                // Workbench session may be gone; keep Assets project-scoped.
                session = null;
              }
            }
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind !== "assets") return;
            dispatch({
              type: "SET_SURFACE",
              surface: {
                ...current,
                projectName: project.project.name,
                sourceLocale: project.project.sourceLocale,
                targetLocale: project.project.targetLocale,
                session,
              },
            });
            // Bump feature generation so useAssetController invalidates tokens
            // and reloads the active section before mutations are re-enabled.
            invalidateFeatureOps();
            // Allow React to process generation + section reload scheduling.
            await Promise.resolve();
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind !== "assets") return;
            // Authoritative section list for the active section (shared RPC).
            const section = current.section;
            if (section === "tm") {
              await invokeEngine("tm.library.list", {
                projectId: current.projectId,
                offset: 0,
                limit: 50,
              });
            } else if (section === "termbase") {
              await invokeEngine("termbase.list", {
                projectId: current.projectId,
                offset: 0,
                limit: 50,
              });
            } else if (section === "alignment") {
              await invokeEngine("alignment.session.list", {
                projectId: current.projectId,
                offset: 0,
                limit: 25,
              });
            } else if (section === "corpus") {
              await invokeEngine("corpus.list", {
                projectId: current.projectId,
                offset: 0,
                limit: 25,
              });
            } else if (section === "catalog") {
              await invokeEngine("asset.catalog.list", {
                projectId: current.projectId,
                offset: 0,
                limit: 25,
              });
            } else if (section === "curation") {
              await invokeEngine("tm.library.list", {
                projectId: current.projectId,
                offset: 0,
                limit: 50,
              });
            }
            if (!isCurrent(gen)) return;
            if (stateRef.current.surface.kind !== "assets") return;
            dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
            revalidationOk = true;
          } catch (error) {
            if (!isCurrent(gen)) return;
            dispatch({
              type: "ENGINE_STATUS",
              status: "failed",
              message: toUiError(error).message,
            });
            // Keep mutations disabled until a successful revalidation.
          }
        } else {
          dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
          revalidationOk = true;
        }
        if (!isCurrent(gen)) return;
        if (revalidationOk) {
          dispatch({ type: "ENGINE_STATUS", status: "connected" });
        } else {
          // Feature revalidation failed: keep mutations off and expose Retry.
          dispatch({
            type: "ENGINE_STATUS",
            status: "failed",
            message: "Revalidation failed",
          });
        }
      } catch (error) {
        if (!isCurrent(gen)) return;
        dispatch({
          type: "ENGINE_STATUS",
          status: "failed",
          message: toUiError(error).message,
        });
      }
    };

    rehydrateRef.current = rehydrateHydratedSurface;

    const unsubReconnect = desktopApi().onEngineReconnected(() => {
      generationRef.current += 1;
      invalidateFeatureOps();
      const gen = generationRef.current;
      void rehydrateHydratedSurface(gen);
    });

    return () => {
      rehydrateRef.current = null;
      unsubStatus();
      unsubReconnect();
    };
  }, [
    boot,
    enterWorkbench,
    hydrateSession,
    invalidateFeatureOps,
    isCurrent,
    saveCoordinator,
  ]);

  // Exact TM lookup when active segment changes on workbench.
  // Every intelligence dock answers a question about the segment under the
  // caret, so they are all driven from one place, cancelled together, and only
  // ever committed when the answer still belongs to the segment that asked.
  useEffect(() => {
    const surface = state.surface;
    if (surface.kind !== "workbench") return;
    const segmentId = surface.activeSegmentId;
    if (!segmentId) return;
    const row = surface.ctx.rows.find((r) => r.segment.id === segmentId);
    if (!row) return;
    let cancelled = false;
    const projectId = surface.ctx.project.id;
    const sourceLocale = surface.ctx.project.sourceLocale;
    const targetLocale = surface.ctx.project.targetLocale;
    const sourceText = row.segment.sourceText;

    const stillCurrent = () => {
      if (cancelled) return false;
      const current = stateRef.current.surface;
      return (
        current.kind === "workbench" && current.activeSegmentId === segmentId
      );
    };

    dispatch({
      type: "PATCH_WORKBENCH",
      patch: {
        intel: {
          segmentId,
          tm: { matches: [], loading: true, error: null },
          terms: { matches: [], loading: true, error: null },
          // Concordance is driven by the translator, so moving segment clears
          // the previous answer rather than silently re-running it against a
          // phrase from a sentence they have left.
          concordance: { query: "", hits: [], loading: false, error: null },
        },
      },
    });

    const patchIntel = (
      part: Partial<Pick<SegmentIntel, "tm" | "terms" | "concordance">>,
    ) => {
      if (!stillCurrent()) return;
      dispatch({ type: "PATCH_SEGMENT_INTEL", segmentId, patch: part });
    };

    void (async () => {
      try {
        // Fuzzy, not just exact: the whole point of a memory is the sentence
        // that is nearly right, and this project already had the search.
        const result = await invokeEngine("tm.search", {
          projectId,
          sourceLocale,
          targetLocale,
          query: sourceText,
          offset: 0,
          limit: 9,
        });
        patchIntel({
          tm: { matches: result.matches, loading: false, error: null },
        });
      } catch (error) {
        patchIntel({
          tm: { matches: [], loading: false, error: toUiError(error) },
        });
      }
    })();

    void (async () => {
      try {
        const result = await invokeEngine("term.search", {
          projectId,
          text: sourceText,
          offset: 0,
          limit: 40,
        });
        patchIntel({
          terms: { matches: result.matches, loading: false, error: null },
        });
      } catch (error) {
        patchIntel({
          terms: { matches: [], loading: false, error: toUiError(error) },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    state.surface.kind === "workbench" ? state.surface.activeSegmentId : null,
    state.surface.kind === "workbench" ? state.surface.ctx.document.id : null,
  ]);

  // Drop pending recovery once the matching segment has been saved to Engine.
  useEffect(() => {
    const active = saveCoordinator.active;
    if (!active) return;
    if (
      active.editGeneration === active.savedGeneration &&
      active.draftTarget === active.engineTarget &&
      active.saveState === "idle"
    ) {
      pendingRecoveredRef.current.drafts.delete(active.segmentId);
      pendingRecoveredRef.current.revisions.delete(active.segmentId);
    }
  }, [saveTick, saveCoordinator]);

  const flushOrStay = useCallback(async (): Promise<boolean> => {
    try {
      const flushResult = await saveCoordinator.flush();
      // Apply one-shot flush acknowledgement only — never sticky reapplication.
      const updated = flushResult.updatedSegment;
      if (updated && stateRef.current.surface.kind === "workbench") {
        const rows = replaceRow(stateRef.current.surface.ctx.rows, updated);
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: {
            ctx: {
              ...stateRef.current.surface.ctx,
              rows,
              counts: countsFromRows(rows),
            },
            transitionError: null,
          },
        });
      }
      return true;
    } catch (error) {
      const ui =
        error &&
        typeof error === "object" &&
        "uiError" in error &&
        (error as { uiError?: UiError }).uiError
          ? (error as { uiError: UiError }).uiError
          : toUiError(error, "Save failed");
      if (stateRef.current.surface.kind === "workbench") {
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: { transitionError: ui },
        });
      }
      return false;
    }
  }, [saveCoordinator]);

  const commands = useMemo<AppController["commands"]>(() => {
    return {
      retryBoot: () => {
        generationRef.current += 1;
        const gen = generationRef.current;
        const surface = stateRef.current.surface;
        // Hydrated surfaces retain content — never BOOT_START over them.
        if (
          surface.kind === "workbench" ||
          surface.kind === "qa" ||
          surface.kind === "export" ||
          surface.kind === "insights" ||
          surface.kind === "projects" ||
          surface.kind === "templates" ||
          surface.kind === "recycle" ||
          surface.kind === "search"
        ) {
          const rehydrate = rehydrateRef.current;
          if (rehydrate) {
            void rehydrate(gen);
            return;
          }
        }
        void boot(gen);
      },

      restartEngine: async () => {
        dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: false });
        dispatch({
          type: "ENGINE_STATUS",
          status: "connecting",
          message: "Restarting engine",
        });
        try {
          await desktopApi().restartEngine();
        } catch (error) {
          dispatch({
            type: "ENGINE_STATUS",
            status: "failed",
            message: toUiError(error).message,
          });
          dispatch({ type: "SET_BOOT_ERROR", error: toUiError(error) });
        }
      },

      recoverDraft: async () => {
        const surface = stateRef.current.surface;
        if (surface.kind !== "recovery" || surface.mode !== "recoverable") {
          return;
        }
        if (!surface.session) return;
        try {
          const ctx = await hydrateSession(surface.session);
          // Re-validate every record against Engine before applying drafts.
          const validated = classifyDraftJournal(
            { path: "", records: surface.records, totalBytes: 0 },
            surface.session,
            probesFromRows(ctx.rows),
          );
          if (validated.kind !== "recoverable") {
            dispatch({
              type: "SET_SURFACE",
              surface: {
                kind: "recovery",
                mode: "stale",
                records: surface.records,
                session: surface.session,
                reason:
                  validated.kind === "stale"
                    ? validated.reason
                    : "Draft journal is no longer recoverable.",
              },
            });
            return;
          }
          const drafts = new Map(
            validated.records.map((r) => [r.segmentId, r.targetText]),
          );
          const revisions = new Map(
            validated.records.map((r) => [r.segmentId, r.expectedRevision]),
          );
          enterWorkbench(ctx, {
            recoveredDrafts: drafts,
            recoveredRevisions: revisions,
            replacePendingRecovered: true,
            persistSession: true,
            focusSegmentId: validated.records[0]?.segmentId ?? null,
          });
        } catch (error) {
          dispatch({
            type: "PATCH_RECOVERY",
            patch: { error: toUiError(error) },
          });
        }
      },

      discardDraft: async () => {
        const surface = stateRef.current.surface;
        if (surface.kind !== "recovery") return;
        try {
          await desktopApi().clearDraftJournal();
          pendingRecoveredRef.current.drafts.clear();
          pendingRecoveredRef.current.revisions.clear();
          generationRef.current += 1;
          await boot(generationRef.current);
        } catch (error) {
          dispatch({
            type: "PATCH_RECOVERY",
            patch: { error: toUiError(error) },
          });
        }
      },

      goCreateProject: () => {
        if (!stateRef.current.mutationsEnabled) return;
        dispatch({
          type: "SET_SURFACE",
          surface: { kind: "create-project" },
        });
      },

      goHome: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (
          surface.kind === "workbench" ||
          surface.kind === "qa" ||
          surface.kind === "export" ||
          (surface.kind === "insights" && surface.returnTo === "workbench") ||
          (surface.kind === "assets" && surface.returnTo === "workbench")
        ) {
          if (surface.kind === "workbench") {
            const ok = await flushOrStay();
            if (!ok) return;
          }
          // Intentional leave of Workbench-scoped session (incl. Assets-from-WB).
          clearSessionStorage();
          saveCoordinator.clearActive();
        }
        // Abandon in-flight feature loaders so they cannot resurrect surfaces.
        invalidateFeatureOps();
        try {
          await resolveHome();
        } catch (error) {
          dispatch({ type: "SET_BOOT_ERROR", error: toUiError(error) });
        }
      },

      createProject: async (input) => {
        if (!stateRef.current.mutationsEnabled) return;
        if (stateRef.current.surface.kind !== "create-project") return;
        dispatch({
          type: "PATCH_CREATE",
          patch: { pending: true, error: null },
        });
        try {
          const project = await invokeEngine("project.create", {
            name: input.name.trim(),
            domain: input.domain.trim(),
            sourceLocale: input.sourceLocale.trim(),
            targetLocale: input.targetLocale.trim(),
          });
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "import-document",
              projectId: project.id,
              projectName: project.name,
            },
          });
        } catch (error) {
          dispatch({
            type: "PATCH_CREATE",
            patch: { pending: false, error: toUiError(error) },
          });
        }
      },

      openProject: async (projectId) => {
        if (!stateRef.current.mutationsEnabled) return;
        if (stateRef.current.surface.kind !== "projects") return;
        if (stateRef.current.surface.loading) return;
        const op = beginOp(openProjectOpRef, "projects");
        dispatch({
          type: "PATCH_PROJECTS",
          patch: { loading: true, error: null },
        });
        try {
          const snapshot = await invokeEngine("project.get", { projectId });
          if (!isOpCurrent(op, openProjectOpRef)) return;
          const documents = await listAllDocuments(projectId);
          if (!isOpCurrent(op, openProjectOpRef)) return;
          const route = resolveOpenProjectRoute(documents);
          if (route.kind === "import") {
            dispatch({
              type: "SET_SURFACE",
              surface: {
                kind: "import-document",
                projectId: snapshot.project.id,
                projectName: snapshot.project.name,
              },
            });
            return;
          }
          const session = makeSession(projectId, route.documentId);
          const ctx = await hydrateSession(session);
          if (!isOpCurrent(op, openProjectOpRef)) return;
          enterWorkbench(ctx, { persistSession: true });
        } catch (error) {
          if (!isOpCurrent(op, openProjectOpRef)) return;
          if (stateRef.current.surface.kind === "projects") {
            dispatch({
              type: "PATCH_PROJECTS",
              patch: { loading: false, error: toUiError(error) },
            });
          }
        }
      },

      importDocument: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "import-document") return;
        if (surface.pending) return;
        const opId = ++importOpRef.current;
        dispatch({
          type: "PATCH_IMPORT",
          patch: { pending: true, error: null },
        });
        try {
          const paths = await desktopApi().selectSourceDocuments();
          if (importOpRef.current !== opId) return;
          if (!paths || paths.length === 0) {
            dispatch({
              type: "PATCH_IMPORT",
              patch: { pending: false, error: null },
            });
            return;
          }
          const batch = await invokeEngine("project.batchImport", {
            projectId: surface.projectId,
            atomicity: "bestEffort",
            items: paths.map((path) => ({ path })),
          });
          if (importOpRef.current !== opId) return;
          if (batch.succeeded <= 0) {
            dispatch({
              type: "PATCH_IMPORT",
              patch: {
                pending: false,
                batchResult: batch,
                error: {
                  code: "IMPORT_FAILED",
                  message: "Import failed for all files.",
                  kind: "domain",
                },
              },
            });
            return;
          }
          const documents = await listAllDocuments(surface.projectId);
          if (importOpRef.current !== opId) return;
          const openId = chooseImportOpenDocumentId({
            projectId: surface.projectId,
            diagnostics: batch.items,
            documents,
          });
          if (!openId) {
            dispatch({
              type: "PATCH_IMPORT",
              patch: {
                pending: false,
                batchResult: batch,
                error: {
                  code: "IMPORT_NO_DOCUMENT",
                  message: "Import succeeded without a usable document.",
                  kind: "domain",
                },
              },
            });
            return;
          }
          const session = makeSession(surface.projectId, openId);
          const ctx = await hydrateSession(session);
          if (importOpRef.current !== opId) return;
          enterWorkbench(ctx, { persistSession: true });
          dispatch({
            type: "PATCH_WORKBENCH",
            patch: { batchResult: batch },
          });
        } catch (error) {
          if (importOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_IMPORT",
            patch: { pending: false, error: toUiError(error) },
          });
        }
      },

      selectSegment: async (segmentId) => {
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        if (surface.activeSegmentId === segmentId) return;
        if (!stateRef.current.mutationsEnabled) return;
        if (surface.pendingConfirm) return;
        if (saveCoordinator.active?.isComposing) return;
        const ok = await flushOrStay();
        if (!ok) return;
        const row = surface.ctx.rows.find((r) => r.segment.id === segmentId);
        if (!row) return;
        // Refresh rows after flush
        const current =
          stateRef.current.surface.kind === "workbench"
            ? stateRef.current.surface
            : surface;
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: {
            activeSegmentId: segmentId,
            focusSegmentId: segmentId,
            transitionError: null,
          },
        });
        const engineRow =
          current.ctx.rows.find((r) => r.segment.id === segmentId)?.segment ??
          row.segment;
        attachSegmentWithPending(
          current.ctx,
          engineRow.id,
          engineRow.targetText,
          engineRow.revision,
        );
      },

      updateTargetDraft: (text) => {
        if (!stateRef.current.mutationsEnabled) return;
        saveCoordinator.updateDraft(text);
      },

      compositionStart: () => {
        onCompositionStart(compositionRef.current);
        saveCoordinator.setComposing(true);
      },

      compositionEnd: () => {
        onCompositionEnd(compositionRef.current);
        saveCoordinator.setComposing(false);
      },

      confirmSegment: async (event) => {
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        if (!stateRef.current.mutationsEnabled) return;
        const mode = confirmModeFromEvent(event);
        if (
          shouldBlockConfirm(
            compositionRef.current,
            event,
            surface.pendingConfirm,
          )
        ) {
          return;
        }
        if (saveCoordinator.active?.isComposing) return;
        const segmentId = surface.activeSegmentId;
        if (!segmentId) return;
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: { pendingConfirm: true, transitionError: null },
        });
        try {
          const flushResult = await saveCoordinator.flush();
          if (flushResult.updatedSegment) {
            // Consume one-shot flush ack into rows before confirm.
            if (stateRef.current.surface.kind === "workbench") {
              const rows = replaceRow(
                stateRef.current.surface.ctx.rows,
                flushResult.updatedSegment,
              );
              dispatch({
                type: "PATCH_WORKBENCH",
                patch: {
                  ctx: {
                    ...stateRef.current.surface.ctx,
                    rows,
                    counts: countsFromRows(rows),
                  },
                },
              });
            }
          }
          const active = saveCoordinator.active;
          // Confirm only when flush fully serialized the latest draft generation.
          // Typing during flush must not produce a stale confirm or focus advance.
          const flushStable =
            active?.segmentId === segmentId &&
            !active.isComposing &&
            active.editGeneration === active.savedGeneration &&
            active.draftTarget === active.engineTarget &&
            active.saveState !== "error" &&
            active.saveState !== "saving" &&
            active.saveState !== "scheduled";
          if (!flushStable) {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: { pendingConfirm: false, transitionError: null },
            });
            return;
          }
          // Bind confirm to this exact edit generation only after the invariant holds.
          const boundGeneration = active.editGeneration;
          const revision = active.expectedRevision;
          const result = await invokeEngine("segment.confirm", {
            segmentId,
            expectedRevision: revision,
          });
          // Re-fetch authoritative editor list
          const documentId =
            stateRef.current.surface.kind === "workbench"
              ? stateRef.current.surface.ctx.document.id
              : surface.ctx.document.id;
          const { rows } = await listAllEditorRows(documentId);
          const nextSurface = stateRef.current.surface;
          if (nextSurface.kind !== "workbench") {
            return;
          }
          const counts = result.counts ?? countsFromRows(rows);
          const confirmedRow = rows.find((r) => r.segment.id === segmentId);
          const stillOnSegment = nextSurface.activeSegmentId === segmentId;
          const activeNow = saveCoordinator.active;
          const generationUnchanged =
            stillOnSegment &&
            activeNow?.segmentId === segmentId &&
            activeNow.editGeneration === boundGeneration &&
            activeNow.savedGeneration === boundGeneration &&
            activeNow.draftTarget === activeNow.engineTarget;

          if (!stillOnSegment) {
            // User navigated away; merge rows only, do not steal active edit.
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: {
                ctx: {
                  ...nextSurface.ctx,
                  rows,
                  counts,
                },
                pendingConfirm: false,
              },
            });
            return;
          }

          if (!generationUnchanged) {
            // Newer local draft exists — retain it, do not advance focus.
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: {
                ctx: {
                  ...nextSurface.ctx,
                  rows,
                  counts,
                },
                pendingConfirm: false,
                transitionError: null,
              },
            });
            if (confirmedRow && activeNow?.segmentId === segmentId) {
              saveCoordinator.applyEngineSegment(confirmedRow.segment);
            }
            return;
          }

          // Where to go next is the translator's rhythm, not document order:
          // Ctrl+Enter skips what is already done, Alt walks strictly forward,
          // Shift holds position.
          const advanceTo = nextSegmentAfterConfirm(rows, segmentId, mode);
          const nextRow = advanceTo
            ? (rows.find((r) => r.segment.id === advanceTo) ?? null)
            : null;
          const nextId = nextRow?.segment.id ?? segmentId;
          dispatch({
            type: "PATCH_WORKBENCH",
            patch: {
              ctx: {
                ...nextSurface.ctx,
                rows,
                counts,
              },
              activeSegmentId: nextId,
              focusSegmentId: nextId,
              pendingConfirm: false,
              // Say what the confirmation did beyond this segment. Silent
              // propagation is how a document ends up full of drafts nobody
              // knows arrived.
              propagatedFrom:
                result.propagated && result.propagated.length > 0
                  ? {
                      segmentId,
                      count: result.propagated.length,
                    }
                  : null,
            },
          });
          // Confirmed segment is durable; drop any pending recovery for it.
          pendingRecoveredRef.current.drafts.delete(segmentId);
          pendingRecoveredRef.current.revisions.delete(segmentId);
          if (nextRow) {
            attachSegmentWithPending(
              nextSurface.ctx,
              nextRow.segment.id,
              nextRow.segment.targetText,
              nextRow.segment.revision,
            );
          }
        } catch (error) {
          if (stateRef.current.surface.kind === "workbench") {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: {
                pendingConfirm: false,
                transitionError: toUiError(error),
              },
            });
          }
        }
      },

      // A match a translator can read but not use is worse than no match: it
      // shows the answer and then asks them to retype it.
      applyTmMatch: (match) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        if (!surface.activeSegmentId) return;
        if (saveCoordinator.active?.isComposing) return;
        saveCoordinator.updateDraft(match.unit.targetText);
      },

      // Terms and placeables go in where the caret is, not at the end. The
      // editor owns the selection, so it is asked rather than guessed at.
      insertAtCaret: (text) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        const active = saveCoordinator.active;
        if (!active || active.isComposing) return;
        const element = document.querySelector<HTMLTextAreaElement>(
          `[data-testid="target-editor-${active.segmentId}"]`,
        );
        const current = active.draftTarget;
        const start = element?.selectionStart ?? current.length;
        const end = element?.selectionEnd ?? current.length;
        const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
        saveCoordinator.updateDraft(next);
        if (element) {
          const caret = start + text.length;
          // Restore focus and put the caret after what was inserted, so the
          // translator keeps typing instead of hunting for their place.
          requestAnimationFrame(() => {
            element.focus();
            element.setSelectionRange(caret, caret);
          });
        }
      },

      // Concordance answers a question the translator asks, so it runs on their
      // selection, not on whatever the caret happens to sit in.
      runConcordance: (query, selection) => {
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        const segmentId = surface.activeSegmentId;
        if (!segmentId) return;
        const row = surface.ctx.rows.find((r) => r.segment.id === segmentId);
        if (!row) return;
        const phrase = (
          query ??
          concordanceQueryFor(
            selection ?? readSegmentSelection(segmentId),
            row.segment.sourceText,
          )
        ).trim();
        if (!phrase) return;
        const projectId = surface.ctx.project.id;
        dispatch({
          type: "PATCH_SEGMENT_INTEL",
          segmentId,
          patch: {
            concordance: {
              query: phrase,
              hits: [],
              loading: true,
              error: null,
            },
          },
        });
        void (async () => {
          try {
            const result = await invokeEngine("tm.concordance", {
              projectId,
              query: phrase,
              side: "both",
              offset: 0,
              limit: 20,
            });
            dispatch({
              type: "PATCH_SEGMENT_INTEL",
              segmentId,
              patch: {
                concordance: {
                  query: phrase,
                  hits: result.hits,
                  loading: false,
                  error: null,
                },
              },
            });
          } catch (error) {
            dispatch({
              type: "PATCH_SEGMENT_INTEL",
              segmentId,
              patch: {
                concordance: {
                  query: phrase,
                  hits: [],
                  loading: false,
                  error: toUiError(error),
                },
              },
            });
          }
        })();
      },

      // The shortest path from deciding a translation to the termbase knowing
      // it. Anything longer and the asset never gets built.
      quickAddTerm: async (selection) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        const segmentId = surface.activeSegmentId;
        if (!segmentId) return;
        // The selection comes from the view, which remembers each side: the
        // source and the target can never be highlighted at the same instant.
        if (!canStoreTerm(selection)) return;
        const project = surface.ctx.project;
        try {
          const termbases = await invokeEngine("termbase.list", {
            projectId: project.id,
            offset: 0,
            limit: 50,
          });
          const writable = termbases.mounts.find(
            (mount) => mount.enabled && mount.mode === "write",
          );
          const termbaseId =
            writable?.termbaseId ?? termbases.items[0]?.id ?? null;
          if (!termbaseId) {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: {
                transitionError: {
                  kind: "domain",
                  code: "no_termbase",
                  message:
                    "This project has no writable termbase. Create one in Assets first.",
                },
              },
            });
            return;
          }
          await invokeEngine("term.upsert", {
            termbaseId,
            sourceLocale: project.sourceLocale,
            sourceTerm: selection.source,
            translations: [
              {
                locale: project.targetLocale,
                term: selection.target,
                preferred: true,
              },
            ],
          });
          // Re-ask the terminology dock so the new entry appears immediately:
          // sedimentation the translator cannot see is indistinguishable from
          // sedimentation that did not happen.
          const refreshed = await invokeEngine("term.search", {
            projectId: project.id,
            text:
              surface.ctx.rows.find((r) => r.segment.id === segmentId)?.segment
                .sourceText ?? selection.source,
            offset: 0,
            limit: 40,
          });
          dispatch({
            type: "PATCH_SEGMENT_INTEL",
            segmentId,
            patch: {
              terms: {
                matches: refreshed.matches,
                loading: false,
                error: null,
              },
            },
          });
        } catch (error) {
          dispatch({
            type: "PATCH_WORKBENCH",
            patch: { transitionError: toUiError(error) },
          });
        }
      },

      // Numbers, product codes and code-like sentences are faster to edit than
      // to retype, which is why every CAT tool binds this.
      copySourceToTarget: () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        const segmentId = surface.activeSegmentId;
        if (!segmentId) return;
        if (saveCoordinator.active?.isComposing) return;
        const row = surface.ctx.rows.find((r) => r.segment.id === segmentId);
        if (!row) return;
        saveCoordinator.updateDraft(row.segment.sourceText);
      },

      clearTarget: () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        if (!surface.activeSegmentId) return;
        if (saveCoordinator.active?.isComposing) return;
        saveCoordinator.updateDraft("");
      },

      toggleTmPanel: () => {
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        const next = !surface.tmCollapsed;
        writeTmCollapsed(next);
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: { tmCollapsed: next },
        });
      },

      goQa: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind === "workbench") {
          if (surface.pendingConfirm) return;
          if (saveCoordinator.active?.isComposing) return;
          const ok = await flushOrStay();
          if (!ok) return;
        } else if (surface.kind !== "export" && surface.kind !== "qa") {
          return;
        }
        const current = stateRef.current.surface;
        const ctx =
          current.kind === "workbench" ||
          current.kind === "export" ||
          current.kind === "qa"
            ? current.ctx
            : null;
        if (!ctx) return;
        const priorIssues = current.kind === "qa" ? current.issues : [];
        const priorLoaded =
          current.kind === "qa" ? current.issuesLoaded : false;
        const priorRun = current.kind === "qa" ? current.run : null;
        const loadOp = ++qaLoadOpRef.current;
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "qa",
            ctx,
            issues: priorIssues,
            issuesLoaded: priorLoaded,
            run: priorRun,
            loading: true,
            error: null,
          },
        });
        // Always fetch authoritative list on entry/re-entry.
        // Use SET_SURFACE (not PATCH_QA) so a sync Engine response cannot
        // race the reducer before surface.kind becomes "qa".
        try {
          const issues = await invokeEngine("qa.issue.list", {
            projectId: ctx.project.id,
            documentId: ctx.document.id,
            limit: PAGE_LIMIT,
            offset: 0,
          });
          if (qaLoadOpRef.current !== loadOp) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "qa",
              ctx,
              issues: issues.items,
              issuesLoaded: true,
              run: priorRun,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          if (qaLoadOpRef.current !== loadOp) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "qa",
              ctx,
              issues: priorIssues,
              issuesLoaded: priorLoaded,
              run: priorRun,
              loading: false,
              error: toUiError(error),
            },
          });
        }
      },

      runQa: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "qa") return;
        dispatch({
          type: "PATCH_QA",
          patch: { loading: true, error: null },
        });
        try {
          const run = await invokeEngine("qa.run", {
            projectId: surface.ctx.project.id,
            documentId: surface.ctx.document.id,
          });
          const issues = await invokeEngine("qa.issue.list", {
            projectId: surface.ctx.project.id,
            documentId: surface.ctx.document.id,
            limit: PAGE_LIMIT,
            offset: 0,
          });
          if (stateRef.current.surface.kind !== "qa") return;
          dispatch({
            type: "PATCH_QA",
            patch: {
              run,
              issues: issues.items,
              issuesLoaded: true,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          if (stateRef.current.surface.kind !== "qa") return;
          dispatch({
            type: "PATCH_QA",
            patch: { loading: false, error: toUiError(error) },
          });
        }
      },

      jumpToIssue: (segmentId) => {
        if (!stateRef.current.mutationsEnabled) return Promise.resolve();
        const surface = stateRef.current.surface;
        if (surface.kind !== "qa") return Promise.resolve();
        const exists = surface.ctx.rows.some((r) => r.segment.id === segmentId);
        if (!exists) return Promise.resolve();
        enterWorkbench(surface.ctx, {
          focusSegmentId: segmentId,
          persistSession: true,
        });
        return Promise.resolve();
      },

      goExport: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind === "workbench") {
          if (surface.pendingConfirm) return;
          if (saveCoordinator.active?.isComposing) return;
          const ok = await flushOrStay();
          if (!ok) return;
        }
        const current = stateRef.current.surface;
        let ctx: SessionContext | null = null;
        if (current.kind === "workbench") ctx = current.ctx;
        else if (current.kind === "qa") ctx = current.ctx;
        else if (current.kind === "export") ctx = current.ctx;
        if (!ctx) return;
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "export",
            ctx,
            gate: null,
            loading: false,
            exporting: false,
            error: null,
            resultPath: null,
          },
        });
      },

      checkGateAndExport: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "export") return;
        if (surface.exporting || surface.loading) return;
        dispatch({
          type: "PATCH_EXPORT",
          patch: { loading: true, error: null, resultPath: null },
        });
        try {
          const gate = await invokeEngine("qa.gate.check", {
            projectId: surface.ctx.project.id,
            documentId: surface.ctx.document.id,
          });
          if (stateRef.current.surface.kind !== "export") return;
          dispatch({
            type: "PATCH_EXPORT",
            patch: { gate, loading: false },
          });
          if (!gate.clear) {
            return;
          }
          dispatch({
            type: "PATCH_EXPORT",
            patch: { exporting: true },
          });
          const suggested = `${surface.ctx.document.name || "export"}.out`;
          const path = await desktopApi().selectExportPath(suggested);
          if (!path) {
            dispatch({
              type: "PATCH_EXPORT",
              patch: { exporting: false },
            });
            return;
          }
          const result = await invokeEngine("document.export", {
            documentId: surface.ctx.document.id,
            outputPath: path,
          });
          if (stateRef.current.surface.kind !== "export") return;
          dispatch({
            type: "PATCH_EXPORT",
            patch: {
              exporting: false,
              resultPath: result.outputPath,
              error: null,
            },
          });
        } catch (error) {
          if (stateRef.current.surface.kind !== "export") return;
          dispatch({
            type: "PATCH_EXPORT",
            patch: {
              loading: false,
              exporting: false,
              error: toUiError(error),
            },
          });
        }
      },

      backToWorkbench: async (focusSegmentId) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "qa" && surface.kind !== "export") return;
        try {
          const ctx = await hydrateSession(surface.ctx.session);
          enterWorkbench(ctx, {
            focusSegmentId:
              focusSegmentId ?? surface.ctx.rows[0]?.segment.id ?? null,
            persistSession: true,
          });
        } catch (error) {
          if (surface.kind === "qa") {
            dispatch({
              type: "PATCH_QA",
              patch: { error: toUiError(error) },
            });
          } else {
            dispatch({
              type: "PATCH_EXPORT",
              patch: { error: toUiError(error) },
            });
          }
        }
      },

      switchDocument: async (documentId) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        if (surface.ctx.document.id === documentId) return;
        if (surface.switchPending || surface.pendingConfirm) return;
        if (saveCoordinator.active?.isComposing) return;
        const opId = ++switchDocOpRef.current;
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: { switchPending: true, transitionError: null },
        });
        const ok = await flushOrStay();
        if (!ok) {
          if (switchDocOpRef.current === opId) {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: { switchPending: false },
            });
          }
          return;
        }
        try {
          const projectId = surface.ctx.project.id;
          const documents = await listAllDocuments(projectId);
          if (switchDocOpRef.current !== opId) return;
          if (!documents.some((d) => d.id === documentId)) {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: {
                switchPending: false,
                transitionError: {
                  code: "DOCUMENT_NOT_FOUND",
                  message: "Document is not in this project.",
                  kind: "domain",
                },
                ctx: { ...surface.ctx, documents },
              },
            });
            return;
          }
          const session = makeSession(projectId, documentId);
          const ctx = await hydrateSession(session);
          if (switchDocOpRef.current !== opId) return;
          enterWorkbench(ctx, { persistSession: true });
        } catch (error) {
          if (switchDocOpRef.current !== opId) return;
          if (stateRef.current.surface.kind === "workbench") {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: {
                switchPending: false,
                transitionError: toUiError(error),
              },
            });
          }
        }
      },

      addFiles: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return;
        if (
          surface.addFilesPending ||
          surface.switchPending ||
          addFilesGuardRef.current
        ) {
          return;
        }
        if (saveCoordinator.active?.isComposing) return;
        // Acquire command-owned pending/ref before the first await (flush).
        addFilesGuardRef.current = true;
        const op = beginOp(importOpRef, "workbench");
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: { addFilesPending: true, transitionError: null },
        });
        const ok = await flushOrStay();
        if (!ok) {
          addFilesGuardRef.current = false;
          if (isOpCurrent(op, importOpRef)) {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: { addFilesPending: false },
            });
          }
          return;
        }
        try {
          const paths = await desktopApi().selectSourceDocuments();
          if (!isOpCurrent(op, importOpRef)) return;
          if (!paths || paths.length === 0) {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: { addFilesPending: false },
            });
            return;
          }
          const projectId = surface.ctx.project.id;
          const batch = await invokeEngine("project.batchImport", {
            projectId,
            atomicity: "bestEffort",
            items: paths.map((path) => ({ path })),
          });
          if (!isOpCurrent(op, importOpRef)) return;
          let documents = surface.ctx.documents;
          if (batch.succeeded > 0) {
            documents = await listAllDocuments(projectId);
          }
          if (!isOpCurrent(op, importOpRef)) return;
          if (stateRef.current.surface.kind !== "workbench") return;
          dispatch({
            type: "PATCH_WORKBENCH",
            patch: {
              addFilesPending: false,
              batchResult: batch,
              ctx: {
                ...stateRef.current.surface.ctx,
                documents,
              },
              transitionError:
                batch.succeeded <= 0
                  ? {
                      code: "IMPORT_FAILED",
                      message: "Import failed for all files.",
                      kind: "domain",
                    }
                  : null,
            },
          });
        } catch (error) {
          if (!isOpCurrent(op, importOpRef)) return;
          if (stateRef.current.surface.kind === "workbench") {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: {
                addFilesPending: false,
                transitionError: toUiError(error),
              },
            });
          }
        } finally {
          if (isOpCurrent(op, importOpRef) || !addFilesGuardRef.current) {
            addFilesGuardRef.current = false;
          }
          // Always release the synchronous guard after this invocation ends.
          addFilesGuardRef.current = false;
        }
      },

      dismissBatchSummary: () => {
        const surface = stateRef.current.surface;
        if (surface.kind === "workbench") {
          dispatch({
            type: "PATCH_WORKBENCH",
            patch: { batchResult: null },
          });
        } else if (surface.kind === "import-document") {
          dispatch({
            type: "PATCH_IMPORT",
            patch: { batchResult: null },
          });
        }
      },

      openExample: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "welcome" && surface.kind !== "projects") return;
        if (
          (surface.kind === "welcome" && surface.pendingExample) ||
          (surface.kind === "projects" && surface.pendingExample)
        ) {
          return;
        }
        const origin = surface.kind;
        const op = beginOp(exampleOpRef, origin);
        if (surface.kind === "welcome") {
          dispatch({
            type: "PATCH_WELCOME",
            patch: { pendingExample: true, error: null },
          });
        } else {
          dispatch({
            type: "PATCH_PROJECTS",
            patch: { pendingExample: true, actionError: null },
          });
        }
        try {
          const result = await desktopApi().openExampleProject();
          if (!isOpCurrent(op, exampleOpRef)) return;
          if (!result.ok || !result.projectId) {
            const ui: UiError = {
              code: result.code ?? "EXAMPLE_FAILED",
              message: result.message ?? "Could not open example project.",
              kind: "domain",
            };
            if (stateRef.current.surface.kind === "welcome") {
              dispatch({
                type: "PATCH_WELCOME",
                patch: { pendingExample: false, error: ui },
              });
            } else if (stateRef.current.surface.kind === "projects") {
              dispatch({
                type: "PATCH_PROJECTS",
                patch: { pendingExample: false, actionError: ui },
              });
            }
            return;
          }
          const projectId = result.projectId;
          await invokeEngine("project.get", { projectId });
          if (!isOpCurrent(op, exampleOpRef)) return;
          let documentId = result.documentId ?? null;
          if (!documentId) {
            const documents = await listAllDocuments(projectId);
            if (!isOpCurrent(op, exampleOpRef)) return;
            if (documents.length === 0) {
              const snapshot = await invokeEngine("project.get", { projectId });
              if (!isOpCurrent(op, exampleOpRef)) return;
              dispatch({
                type: "SET_SURFACE",
                surface: {
                  kind: "import-document",
                  projectId,
                  projectName: snapshot.project.name,
                },
              });
              dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
              return;
            }
            documentId = documents[0]!.id;
          }
          const session = makeSession(projectId, documentId);
          const ctx = await hydrateSession(session);
          if (!isOpCurrent(op, exampleOpRef)) return;
          enterWorkbench(ctx, { persistSession: true });
        } catch (error) {
          if (!isOpCurrent(op, exampleOpRef)) return;
          const ui = toUiError(error);
          if (stateRef.current.surface.kind === "welcome") {
            dispatch({
              type: "PATCH_WELCOME",
              patch: { pendingExample: false, error: ui },
            });
          } else if (stateRef.current.surface.kind === "projects") {
            dispatch({
              type: "PATCH_PROJECTS",
              patch: { pendingExample: false, actionError: ui },
            });
          }
        }
      },

      goSearch: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind === "workbench") {
          if (surface.pendingConfirm || surface.switchPending) return;
          if (saveCoordinator.active?.isComposing) return;
          const ok = await flushOrStay();
          if (!ok) return;
        }
        invalidateFeatureOps();
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "search",
            submittedQuery: "",
            pendingQuery: null,
            items: [],
            total: 0,
            offset: 0,
            limit: SEARCH_PAGE_LIMIT,
            loading: false,
            error: null,
            navigationError: null,
          },
        });
      },

      runSearch: async (query) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "search") return;
        const text = trimSearchQuery(query);
        if (!text) return;
        const op = beginOp(searchOpRef, "search");
        // Do not replace submitted projection until a current success arrives.
        dispatch({
          type: "PATCH_SEARCH",
          patch: {
            loading: true,
            error: null,
            navigationError: null,
            pendingQuery: text,
          },
        });
        try {
          const page = await invokeEngine("search.global", {
            text,
            includeRecycled: false,
            offset: 0,
            limit: SEARCH_PAGE_LIMIT,
          });
          if (!isOpCurrent(op, searchOpRef)) return;
          dispatch({
            type: "PATCH_SEARCH",
            patch: {
              submittedQuery: text,
              pendingQuery: null,
              items: page.items,
              total: page.total,
              offset: 0,
              limit: page.limit || SEARCH_PAGE_LIMIT,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          if (!isOpCurrent(op, searchOpRef)) return;
          dispatch({
            type: "PATCH_SEARCH",
            patch: {
              loading: false,
              error: toUiError(error),
              // Keep pendingQuery so UI can attribute the failed attempt.
            },
          });
        }
      },

      searchPage: async (offset) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "search") return;
        if (!surface.submittedQuery) return;
        const op = beginOp(searchOpRef, "search");
        dispatch({
          type: "PATCH_SEARCH",
          patch: {
            loading: true,
            error: null,
            navigationError: null,
            pendingQuery: surface.submittedQuery,
          },
        });
        try {
          const page = await invokeEngine("search.global", {
            text: surface.submittedQuery,
            includeRecycled: false,
            offset,
            limit: surface.limit,
          });
          if (!isOpCurrent(op, searchOpRef)) return;
          dispatch({
            type: "PATCH_SEARCH",
            patch: {
              items: page.items,
              total: page.total,
              offset,
              pendingQuery: null,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          if (!isOpCurrent(op, searchOpRef)) return;
          dispatch({
            type: "PATCH_SEARCH",
            patch: { loading: false, error: toUiError(error) },
          });
        }
      },

      activateSearchHit: async (hit) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "search") return;
        const dest = classifySearchHit(hit);
        if (dest.kind === "invalid") {
          dispatch({
            type: "PATCH_SEARCH",
            patch: {
              navigationError: {
                code: "SEARCH_HIT_INVALID",
                message: dest.reason,
                kind: "domain",
              },
            },
          });
          return;
        }
        const op = beginOp(searchOpRef, "search");
        dispatch({
          type: "PATCH_SEARCH",
          patch: { navigationError: null, loading: true },
        });
        try {
          if (dest.kind === "project") {
            const snapshot = await invokeEngine("project.get", {
              projectId: dest.projectId,
            });
            if (!isOpCurrent(op, searchOpRef)) return;
            const documents = await listAllDocuments(dest.projectId);
            if (!isOpCurrent(op, searchOpRef)) return;
            const route = resolveOpenProjectRoute(documents);
            if (route.kind === "import") {
              dispatch({
                type: "SET_SURFACE",
                surface: {
                  kind: "import-document",
                  projectId: snapshot.project.id,
                  projectName: snapshot.project.name,
                },
              });
              return;
            }
            const session = makeSession(dest.projectId, route.documentId);
            const ctx = await hydrateSession(session);
            if (!isOpCurrent(op, searchOpRef)) return;
            enterWorkbench(ctx, { persistSession: true });
            return;
          }
          const session = makeSession(dest.projectId, dest.documentId);
          const ctx = await hydrateSession(session);
          if (!isOpCurrent(op, searchOpRef)) return;
          if (dest.kind === "segment") {
            const exists = ctx.rows.some(
              (r) => r.segment.id === dest.segmentId,
            );
            if (!exists) {
              dispatch({
                type: "PATCH_SEARCH",
                patch: {
                  loading: false,
                  navigationError: {
                    code: "SEGMENT_NOT_FOUND",
                    message: "Segment is no longer available.",
                    kind: "domain",
                  },
                },
              });
              return;
            }
            enterWorkbench(ctx, {
              focusSegmentId: dest.segmentId,
              persistSession: true,
            });
            return;
          }
          enterWorkbench(ctx, { persistSession: true });
        } catch (error) {
          if (!isOpCurrent(op, searchOpRef)) return;
          if (stateRef.current.surface.kind === "search") {
            dispatch({
              type: "PATCH_SEARCH",
              patch: {
                loading: false,
                navigationError: toUiError(error),
              },
            });
          }
        }
      },

      goInsights: async (projectId) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        let targetProjectId: string | undefined;
        let projectName: string;
        let returnTo: "workbench" | "projects";
        let session: SessionIdentity | null = null;

        if (
          surface.kind === "workbench" ||
          surface.kind === "qa" ||
          surface.kind === "export"
        ) {
          if (surface.kind === "workbench") {
            if (surface.pendingConfirm || surface.switchPending) return;
            if (saveCoordinator.active?.isComposing) return;
            const ok = await flushOrStay();
            if (!ok) return;
          }
          const current = stateRef.current.surface;
          if (
            current.kind !== "workbench" &&
            current.kind !== "qa" &&
            current.kind !== "export"
          ) {
            return;
          }
          targetProjectId = current.ctx.project.id;
          projectName = current.ctx.project.name;
          returnTo = "workbench";
          session = current.ctx.session;
        } else if (surface.kind === "projects" && projectId) {
          targetProjectId = projectId;
          const project = surface.projects.find((p) => p.id === projectId);
          projectName = project?.name ?? projectId;
          returnTo = "projects";
        } else if (surface.kind === "insights") {
          targetProjectId = surface.projectId;
          projectName = surface.projectName;
          returnTo = surface.returnTo;
          session = surface.session;
        } else {
          return;
        }
        if (!targetProjectId) return;

        invalidateFeatureOps();
        const op = beginOp(insightsOpRef, "insights");
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "insights",
            projectId: targetProjectId,
            projectName,
            returnTo,
            session,
            analytics: null,
            documents: [],
            loading: true,
            error: null,
          },
        });
        try {
          const snapshot = await invokeEngine("project.get", {
            projectId: targetProjectId,
          });
          if (!isOpCurrent(op, insightsOpRef)) return;
          const analytics = await invokeEngine("project.analytics.get", {
            projectId: targetProjectId,
          });
          const documents = await listAllDocuments(targetProjectId);
          if (!isOpCurrent(op, insightsOpRef)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "insights",
              projectId: targetProjectId,
              projectName: snapshot.project.name,
              returnTo,
              session,
              analytics,
              documents,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          if (!isOpCurrent(op, insightsOpRef)) return;
          if (stateRef.current.surface.kind === "insights") {
            dispatch({
              type: "PATCH_INSIGHTS",
              patch: { loading: false, error: toUiError(error) },
            });
          }
        }
      },

      refreshInsights: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "insights") return;
        const opId = ++insightsOpRef.current;
        dispatch({
          type: "PATCH_INSIGHTS",
          patch: { loading: true, error: null },
        });
        try {
          const analytics = await invokeEngine("project.analytics.get", {
            projectId: surface.projectId,
          });
          const documents = await listAllDocuments(surface.projectId);
          if (insightsOpRef.current !== opId) return;
          if (stateRef.current.surface.kind !== "insights") return;
          dispatch({
            type: "PATCH_INSIGHTS",
            patch: {
              analytics,
              documents,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          if (insightsOpRef.current !== opId) return;
          if (stateRef.current.surface.kind === "insights") {
            dispatch({
              type: "PATCH_INSIGHTS",
              patch: { loading: false, error: toUiError(error) },
            });
          }
        }
      },

      backFromInsights: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "insights") return;
        if (surface.returnTo === "workbench" && surface.session) {
          try {
            const ctx = await hydrateSession(surface.session);
            enterWorkbench(ctx, { persistSession: true });
          } catch (error) {
            dispatch({
              type: "PATCH_INSIGHTS",
              patch: { error: toUiError(error) },
            });
          }
          return;
        }
        await resolveHome();
      },

      goAssets: async (projectId) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        let targetProjectId: string | undefined;
        let projectName: string;
        let sourceLocale: string;
        let targetLocale: string;
        let returnTo: "workbench" | "projects";
        let session: SessionIdentity | null = null;

        if (
          surface.kind === "workbench" ||
          surface.kind === "qa" ||
          surface.kind === "export"
        ) {
          if (surface.kind === "workbench") {
            if (surface.pendingConfirm || surface.switchPending) return;
            if (saveCoordinator.active?.isComposing) return;
            const ok = await flushOrStay();
            if (!ok) return;
          }
          const current = stateRef.current.surface;
          if (
            current.kind !== "workbench" &&
            current.kind !== "qa" &&
            current.kind !== "export"
          ) {
            return;
          }
          targetProjectId = current.ctx.project.id;
          projectName = current.ctx.project.name;
          sourceLocale = current.ctx.project.sourceLocale;
          targetLocale = current.ctx.project.targetLocale;
          returnTo = "workbench";
          session = current.ctx.session;
        } else if (surface.kind === "projects" && projectId) {
          const project = surface.projects.find((p) => p.id === projectId);
          if (!project) return;
          targetProjectId = projectId;
          projectName = project.name;
          sourceLocale = project.sourceLocale;
          targetLocale = project.targetLocale;
          returnTo = "projects";
        } else if (surface.kind === "insights") {
          targetProjectId = surface.projectId;
          projectName = surface.projectName;
          sourceLocale = "en";
          targetLocale = "zh";
          returnTo = surface.returnTo;
          session = surface.session;
          try {
            const snapshot = await invokeEngine("project.get", {
              projectId: surface.projectId,
            });
            projectName = snapshot.project.name;
            sourceLocale = snapshot.project.sourceLocale;
            targetLocale = snapshot.project.targetLocale;
          } catch {
            // keep fallback locales; Asset hub reloads project on enter
          }
        } else if (surface.kind === "assets") {
          targetProjectId = surface.projectId;
          projectName = surface.projectName;
          sourceLocale = surface.sourceLocale;
          targetLocale = surface.targetLocale;
          returnTo = surface.returnTo;
          session = surface.session;
        } else {
          return;
        }
        if (!targetProjectId) return;

        invalidateFeatureOps();
        assetsOpRef.current += 1;
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "assets",
            projectId: targetProjectId,
            projectName,
            sourceLocale,
            targetLocale,
            returnTo,
            session,
            section: "tm",
          },
        });
      },

      setAssetsSection: (section) => {
        if (stateRef.current.surface.kind !== "assets") return;
        dispatch({
          type: "PATCH_ASSETS",
          patch: { section },
        });
      },

      backFromAssets: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "assets") return;
        invalidateFeatureOps();
        if (surface.returnTo === "workbench" && surface.session) {
          try {
            const ctx = await hydrateSession(surface.session);
            enterWorkbench(ctx, { persistSession: true });
          } catch (error) {
            dispatch({
              type: "PATCH_ASSETS",
              // Keep assets surface; surface has no error field — bounce via bootless toast on identity
              patch: {
                projectName: surface.projectName,
              },
            });
            void error;
            // Re-resolve home on hard failure
            await resolveHome();
          }
          return;
        }
        await resolveHome();
      },

      goAiControl: async (section) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind === "workbench") {
          if (surface.pendingConfirm || surface.switchPending) return;
          if (saveCoordinator.active?.isComposing) return;
          const ok = await flushOrStay();
          if (!ok) return;
        }
        const current = stateRef.current.surface;
        const context = resolveP4RouteContext(current);
        const returnTarget = resolveP4ReturnTarget(current);
        invalidateFeatureOps();
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "ai-control",
            returnTarget,
            context,
            section: section ?? defaultAiSection(context),
          },
        });
      },

      setAiControlSection: (section) => {
        if (stateRef.current.surface.kind !== "ai-control") return;
        dispatch({ type: "PATCH_AI_CONTROL", patch: { section } });
      },

      goPlugins: async (section) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind === "workbench") {
          if (surface.pendingConfirm || surface.switchPending) return;
          if (saveCoordinator.active?.isComposing) return;
          const ok = await flushOrStay();
          if (!ok) return;
        }
        const current = stateRef.current.surface;
        const context = resolveP4RouteContext(current);
        const returnTarget = resolveP4ReturnTarget(current);
        invalidateFeatureOps();
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "plugins",
            returnTarget,
            context,
            section: section ?? "installed",
          },
        });
      },

      setPluginsSection: (section) => {
        if (stateRef.current.surface.kind !== "plugins") return;
        dispatch({ type: "PATCH_PLUGINS", patch: { section } });
      },

      goCollaboration: async (section) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind === "workbench") {
          if (surface.pendingConfirm || surface.switchPending) return;
          if (saveCoordinator.active?.isComposing) return;
          const ok = await flushOrStay();
          if (!ok) return;
        }
        const current = stateRef.current.surface;
        const context = resolveP4RouteContext(current);
        if (!collaborationAvailable(context)) return;
        const returnTarget = resolveP4ReturnTarget(current);
        invalidateFeatureOps();
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "collaboration",
            returnTarget,
            context,
            section: section ?? "members",
          },
        });
      },

      setCollaborationSection: (section) => {
        if (stateRef.current.surface.kind !== "collaboration") return;
        dispatch({ type: "PATCH_COLLABORATION", patch: { section } });
      },

      goSettings: async (section) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind === "workbench") {
          if (surface.pendingConfirm || surface.switchPending) return;
          if (saveCoordinator.active?.isComposing) return;
          const ok = await flushOrStay();
          if (!ok) return;
        }
        const current = stateRef.current.surface;
        const context = resolveP4RouteContext(current);
        const returnTarget = resolveP4ReturnTarget(current);
        invalidateFeatureOps();
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "settings",
            returnTarget,
            context,
            section: section ?? "locale",
          },
        });
      },

      setSettingsSection: (section) => {
        if (stateRef.current.surface.kind !== "settings") return;
        dispatch({ type: "PATCH_SETTINGS", patch: { section } });
      },

      backFromP4: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (
          surface.kind !== "ai-control" &&
          surface.kind !== "plugins" &&
          surface.kind !== "collaboration" &&
          surface.kind !== "settings"
        ) {
          return;
        }
        invalidateFeatureOps();
        const target = surface.returnTarget;
        if (target.kind === "workbench") {
          try {
            const ctx = await hydrateSession(target.session);
            enterWorkbench(ctx, {
              persistSession: true,
              ...(target.activeSegmentId
                ? { focusSegmentId: target.activeSegmentId }
                : {}),
            });
          } catch (error) {
            const patchKey =
              surface.kind === "ai-control"
                ? ("PATCH_AI_CONTROL" as const)
                : surface.kind === "plugins"
                  ? ("PATCH_PLUGINS" as const)
                  : surface.kind === "collaboration"
                    ? ("PATCH_COLLABORATION" as const)
                    : ("PATCH_SETTINGS" as const);
            void patchKey;
            void error;
            await resolveHome();
          }
          return;
        }
        if (target.kind === "welcome") {
          dispatch({
            type: "SET_SURFACE",
            surface: { kind: "welcome", error: null },
          });
          return;
        }
        await resolveHome();
      },

      coldRouteAfterRestore: async () => {
        clearSessionStorage();
        saveCoordinator.clearActive();
        invalidateFeatureOps();
        try {
          await resolveHome();
        } catch (error) {
          dispatch({ type: "SET_BOOT_ERROR", error: toUiError(error) });
        }
      },

      applyWorkbenchRows: (input) => {
        if (stateRef.current.surface.kind !== "workbench") return;
        const ctx = stateRef.current.surface.ctx;
        const rows = input.rows;
        const counts = input.counts ?? countsFromEditorRows(rows);
        const activeId =
          input.activeSegmentId ?? stateRef.current.surface.activeSegmentId;
        const focusId = input.focusSegmentId ?? activeId;
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: {
            ctx: { ...ctx, rows, counts },
            activeSegmentId: activeId,
            focusSegmentId: focusId,
            transitionError: null,
          },
        });
        if (activeId) {
          const row = rows.find((r) => r.segment.id === activeId);
          if (row) {
            attachSegmentWithPending(
              { ...ctx, rows, counts },
              row.segment.id,
              row.segment.targetText,
              row.segment.revision,
            );
          }
        }
      },

      refreshWorkbenchRows: async (focusSegmentId) => {
        if (stateRef.current.surface.kind !== "workbench") return;
        const ctx = stateRef.current.surface.ctx;
        try {
          const { rows } = await listAllEditorRows(ctx.document.id);
          if (stateRef.current.surface.kind !== "workbench") return;
          if (stateRef.current.surface.ctx.document.id !== ctx.document.id) {
            return;
          }
          const counts = countsFromEditorRows(rows);
          const focus =
            focusSegmentId && rows.some((r) => r.segment.id === focusSegmentId)
              ? focusSegmentId
              : (stateRef.current.surface.activeSegmentId ??
                rows[0]?.segment.id ??
                null);
          dispatch({
            type: "PATCH_WORKBENCH",
            patch: {
              ctx: { ...ctx, rows, counts },
              activeSegmentId: focus,
              focusSegmentId: focus,
              transitionError: null,
            },
          });
          if (focus) {
            const row = rows.find((r) => r.segment.id === focus);
            if (row) {
              attachSegmentWithPending(
                { ...ctx, rows, counts },
                row.segment.id,
                row.segment.targetText,
                row.segment.revision,
              );
            }
          }
        } catch (error) {
          if (stateRef.current.surface.kind === "workbench") {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: { transitionError: toUiError(error) },
            });
          }
        }
      },

      flushOrStay: () => flushOrStay(),

      goTemplates: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        invalidateFeatureOps();
        const op = beginOp(templatesOpRef, "templates");
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "templates",
            items: [],
            total: 0,
            offset: 0,
            limit: TEMPLATE_PAGE_LIMIT,
            loading: true,
            error: null,
            pending: false,
            selected: null,
            mode: "list",
          },
        });
        try {
          const page = await invokeEngine("project.template.list", {
            limit: TEMPLATE_PAGE_LIMIT,
            offset: 0,
          });
          if (!isOpCurrent(op, templatesOpRef)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "templates",
              items: page.items,
              total: page.total,
              offset: 0,
              limit: page.limit || TEMPLATE_PAGE_LIMIT,
              loading: false,
              error: null,
              pending: false,
              selected: null,
              mode: "list",
            },
          });
        } catch (error) {
          if (!isOpCurrent(op, templatesOpRef)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "templates",
              items: [],
              total: 0,
              offset: 0,
              limit: TEMPLATE_PAGE_LIMIT,
              loading: false,
              error: toUiError(error),
              pending: false,
              selected: null,
              mode: "list",
            },
          });
        }
      },

      templatesPage: async (offset) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "templates") return;
        const opId = ++templatesOpRef.current;
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { loading: true, error: null, mode: "list", selected: null },
        });
        try {
          const page = await invokeEngine("project.template.list", {
            limit: surface.limit,
            offset,
          });
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              items: page.items,
              total: page.total,
              offset,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: { loading: false, error: toUiError(error) },
          });
        }
      },

      templateCreateStart: () => {
        if (!stateRef.current.mutationsEnabled) return;
        if (stateRef.current.surface.kind !== "templates") return;
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { mode: "create", selected: null, error: null },
        });
      },

      templateEditStart: async (templateId, revision) => {
        if (!stateRef.current.mutationsEnabled) return;
        if (stateRef.current.surface.kind !== "templates") return;
        const opId = ++templatesOpRef.current;
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { pending: true, error: null },
        });
        try {
          const template = await invokeEngine("project.template.get", {
            templateId,
            revision,
          });
          if (templatesOpRef.current !== opId) return;
          if (isBuiltInTemplate(template)) {
            dispatch({
              type: "PATCH_TEMPLATES",
              patch: {
                pending: false,
                error: {
                  code: "TEMPLATE_BUILTIN",
                  message: "Built-in templates cannot be edited.",
                  kind: "domain",
                },
              },
            });
            return;
          }
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              pending: false,
              selected: template,
              mode: "edit",
              error: null,
            },
          });
        } catch (error) {
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: { pending: false, error: toUiError(error) },
          });
        }
      },

      templateUseStart: async (templateId, revision) => {
        if (!stateRef.current.mutationsEnabled) return;
        if (stateRef.current.surface.kind !== "templates") return;
        const opId = ++templatesOpRef.current;
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { pending: true, error: null },
        });
        try {
          const template = await invokeEngine("project.template.get", {
            templateId,
            revision,
          });
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              pending: false,
              selected: template,
              mode: "use",
              error: null,
            },
          });
        } catch (error) {
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: { pending: false, error: toUiError(error) },
          });
        }
      },

      templateCancelMode: () => {
        if (stateRef.current.surface.kind !== "templates") return;
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { mode: "list", selected: null, error: null, pending: false },
        });
      },

      templateCreate: async (input) => {
        if (!stateRef.current.mutationsEnabled) return;
        if (stateRef.current.surface.kind !== "templates") return;
        if (stateRef.current.surface.pending) return;
        const opId = ++templatesOpRef.current;
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { pending: true, error: null },
        });
        try {
          await invokeEngine("project.template.create", {
            name: input.name,
            description: input.description,
            definition: createTemplateDefinition(input.defaults),
          });
          if (templatesOpRef.current !== opId) return;
          const page = await invokeEngine("project.template.list", {
            limit: TEMPLATE_PAGE_LIMIT,
            offset: 0,
          });
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              items: page.items,
              total: page.total,
              offset: 0,
              pending: false,
              mode: "list",
              selected: null,
              error: null,
            },
          });
        } catch (error) {
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: { pending: false, error: toUiError(error) },
          });
        }
      },

      templateUpdate: async (input) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "templates") return;
        if (surface.pending) return;
        if (!surface.selected || isBuiltInTemplate(surface.selected)) return;
        const opId = ++templatesOpRef.current;
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { pending: true, error: null },
        });
        try {
          const merged = mergeTemplateDefinition(
            surface.selected.definition,
            input.defaults,
          );
          if (!merged.ok) {
            dispatch({
              type: "PATCH_TEMPLATES",
              patch: {
                pending: false,
                error: {
                  code: "TEMPLATE_DEFINITION",
                  message: "Template definition cannot be updated.",
                  kind: "domain",
                },
              },
            });
            return;
          }
          await invokeEngine("project.template.update", {
            templateId: input.templateId,
            expectedRevision: input.expectedRevision,
            name: input.name,
            description: input.description,
            definition: merged.definition,
          });
          if (templatesOpRef.current !== opId) return;
          const page = await invokeEngine("project.template.list", {
            limit: surface.limit,
            offset: surface.offset,
          });
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              items: page.items,
              total: page.total,
              pending: false,
              mode: "list",
              selected: null,
              error: null,
            },
          });
        } catch (error) {
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: { pending: false, error: toUiError(error) },
          });
        }
      },

      templateDelete: async (templateId, expectedRevision) => {
        if (!stateRef.current.mutationsEnabled) return false;
        const surface = stateRef.current.surface;
        if (surface.kind !== "templates") return false;
        if (surface.pending) return false;
        // Built-in / identity guards must not rely only on hidden UI.
        const selected = surface.selected;
        const listed = surface.items.find((t) => t.id === templateId);
        const candidate = selected?.id === templateId ? selected : listed;
        if (!candidate) {
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              error: {
                code: "TEMPLATE_NOT_SELECTED",
                message: "Template is no longer available.",
                kind: "domain",
              },
            },
          });
          return false;
        }
        if (isBuiltInTemplate(candidate)) {
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              error: {
                code: "TEMPLATE_BUILTIN",
                message: "Built-in templates cannot be deleted.",
                kind: "domain",
              },
            },
          });
          return false;
        }
        if (candidate.revision !== expectedRevision) {
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              error: {
                code: "TEMPLATE_REVISION_MISMATCH",
                message: "Template revision does not match selection.",
                kind: "domain",
              },
            },
          });
          return false;
        }
        const op = beginOp(templatesOpRef, "templates");
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { pending: true, error: null },
        });
        try {
          await invokeEngine("project.template.delete", {
            templateId,
            expectedRevision,
          });
          if (!isOpCurrent(op, templatesOpRef)) return false;
          const page = await invokeEngine("project.template.list", {
            limit: surface.limit,
            offset: surface.offset,
          });
          if (!isOpCurrent(op, templatesOpRef)) return false;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: {
              items: page.items,
              total: page.total,
              pending: false,
              mode: "list",
              selected: null,
              error: null,
            },
          });
          return true;
        } catch (error) {
          if (!isOpCurrent(op, templatesOpRef)) return false;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: { pending: false, error: toUiError(error) },
          });
          return false;
        }
      },

      createFromTemplate: async (input) => {
        if (!stateRef.current.mutationsEnabled) return;
        if (stateRef.current.surface.kind !== "templates") return;
        if (stateRef.current.surface.pending) return;
        const opId = ++templatesOpRef.current;
        dispatch({
          type: "PATCH_TEMPLATES",
          patch: { pending: true, error: null },
        });
        try {
          const result = await invokeEngine("project.createFromTemplate", {
            templateId: input.templateId,
            templateRevision: input.templateRevision,
            name: input.name,
            sourceLocale: input.sourceLocale,
            targetLocale: input.targetLocale,
            domain: input.domain,
          });
          if (templatesOpRef.current !== opId) return;
          // No session until a document hydrates — route to Import.
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "import-document",
              projectId: result.project.id,
              projectName: result.project.name,
              templateDiagnostics: result.diagnostics,
            },
          });
        } catch (error) {
          if (templatesOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_TEMPLATES",
            patch: { pending: false, error: toUiError(error) },
          });
        }
      },

      goRecycle: async () => {
        if (!stateRef.current.mutationsEnabled) return;
        invalidateFeatureOps();
        const op = beginOp(recycleOpRef, "recycle");
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "recycle",
            items: [],
            total: 0,
            offset: 0,
            limit: RECYCLE_PAGE_LIMIT,
            loading: true,
            error: null,
            pending: false,
          },
        });
        try {
          const page = await invokeEngine("recycle.list", {
            limit: RECYCLE_PAGE_LIMIT,
            offset: 0,
          });
          if (!isOpCurrent(op, recycleOpRef)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "recycle",
              items: page.items,
              total: page.total,
              offset: 0,
              limit: page.limit || RECYCLE_PAGE_LIMIT,
              loading: false,
              error: null,
              pending: false,
            },
          });
        } catch (error) {
          if (!isOpCurrent(op, recycleOpRef)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "recycle",
              items: [],
              total: 0,
              offset: 0,
              limit: RECYCLE_PAGE_LIMIT,
              loading: false,
              error: toUiError(error),
              pending: false,
            },
          });
        }
      },

      recyclePage: async (offset) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "recycle") return;
        const opId = ++recycleOpRef.current;
        dispatch({
          type: "PATCH_RECYCLE",
          patch: { loading: true, error: null },
        });
        try {
          const page = await invokeEngine("recycle.list", {
            limit: surface.limit,
            offset,
          });
          if (recycleOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_RECYCLE",
            patch: {
              items: page.items,
              total: page.total,
              offset,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          if (recycleOpRef.current !== opId) return;
          dispatch({
            type: "PATCH_RECYCLE",
            patch: { loading: false, error: toUiError(error) },
          });
        }
      },

      recycleRestore: async (entryId) => {
        if (!stateRef.current.mutationsEnabled) return false;
        const surface = stateRef.current.surface;
        if (surface.kind !== "recycle") return false;
        if (surface.pending) return false;
        const opId = ++recycleOpRef.current;
        dispatch({
          type: "PATCH_RECYCLE",
          patch: { pending: true, error: null },
        });
        try {
          await invokeEngine("recycle.restore", { entryId });
          if (recycleOpRef.current !== opId) return false;
          const page = await invokeEngine("recycle.list", {
            limit: surface.limit,
            offset: surface.offset,
          });
          if (recycleOpRef.current !== opId) return false;
          dispatch({
            type: "PATCH_RECYCLE",
            patch: {
              items: page.items,
              total: page.total,
              pending: false,
              error: null,
            },
          });
          return true;
        } catch (error) {
          if (recycleOpRef.current !== opId) return false;
          dispatch({
            type: "PATCH_RECYCLE",
            patch: { pending: false, error: toUiError(error) },
          });
          return false;
        }
      },

      recyclePurge: async (entryId) => {
        if (!stateRef.current.mutationsEnabled) return false;
        const surface = stateRef.current.surface;
        if (surface.kind !== "recycle") return false;
        if (surface.pending) return false;
        const opId = ++recycleOpRef.current;
        dispatch({
          type: "PATCH_RECYCLE",
          patch: { pending: true, error: null },
        });
        try {
          // Engine requires non-empty purge reason (actor defaults server-side).
          await invokeEngine("recycle.purge", {
            entryId,
            reason: "permanent delete",
          });
          if (recycleOpRef.current !== opId) return false;
          const page = await invokeEngine("recycle.list", {
            limit: surface.limit,
            offset: surface.offset,
          });
          if (recycleOpRef.current !== opId) return false;
          dispatch({
            type: "PATCH_RECYCLE",
            patch: {
              items: page.items,
              total: page.total,
              pending: false,
              error: null,
            },
          });
          return true;
        } catch (error) {
          if (recycleOpRef.current !== opId) return false;
          dispatch({
            type: "PATCH_RECYCLE",
            patch: { pending: false, error: toUiError(error) },
          });
          return false;
        }
      },

      setProjectListLifecycle: async (lifecycle) => {
        if (!stateRef.current.mutationsEnabled) return;
        const op = beginOp(lifecycleOpRef, "projects");
        dispatch({
          type: "SET_SURFACE",
          surface: {
            kind: "projects",
            projects: [],
            lifecycle,
            total: 0,
            offset: 0,
            limit: PROJECT_PAGE_LIMIT,
            loading: true,
            error: null,
          },
        });
        try {
          const page = await listProjectsPage(lifecycle, 0, PROJECT_PAGE_LIMIT);
          if (!isOpCurrent(op, lifecycleOpRef)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "projects",
              projects: page.items,
              lifecycle,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              loading: false,
            },
          });
        } catch (error) {
          if (!isOpCurrent(op, lifecycleOpRef)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "projects",
              projects: [],
              lifecycle,
              total: 0,
              offset: 0,
              limit: PROJECT_PAGE_LIMIT,
              loading: false,
              error: toUiError(error),
            },
          });
        }
      },

      projectsPage: async (offset) => {
        if (!stateRef.current.mutationsEnabled) return;
        const surface = stateRef.current.surface;
        if (surface.kind !== "projects") return;
        const op = beginOp(lifecycleOpRef, "projects");
        const limit = surface.limit || PROJECT_PAGE_LIMIT;
        const lifecycle = surface.lifecycle;
        dispatch({
          type: "PATCH_PROJECTS",
          patch: { loading: true, error: null },
        });
        try {
          const page = await listProjectsPage(lifecycle, offset, limit);
          if (!isOpCurrent(op, lifecycleOpRef)) return;
          dispatch({
            type: "SET_SURFACE",
            surface: {
              kind: "projects",
              projects: page.items,
              lifecycle,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              loading: false,
            },
          });
        } catch (error) {
          if (!isOpCurrent(op, lifecycleOpRef)) return;
          dispatch({
            type: "PATCH_PROJECTS",
            patch: { loading: false, error: toUiError(error) },
          });
        }
      },

      beginEditProject: async (projectId) => {
        if (!stateRef.current.mutationsEnabled) return null;
        const surface = stateRef.current.surface;
        if (surface.kind !== "projects") return null;
        const op = beginOp(lifecycleOpRef, "projects");
        try {
          const snapshot = await invokeEngine("project.get", { projectId });
          if (!isOpCurrent(op, lifecycleOpRef)) return null;
          return snapshot.project;
        } catch (error) {
          if (!isOpCurrent(op, lifecycleOpRef)) return null;
          dispatch({
            type: "PATCH_PROJECTS",
            patch: { actionError: toUiError(error) },
          });
          return null;
        }
      },

      updateProject: async (input) => {
        if (!stateRef.current.mutationsEnabled) return false;
        const surface = stateRef.current.surface;
        if (surface.kind !== "projects") return false;
        const op = beginOp(lifecycleOpRef, "projects");
        try {
          await invokeEngine("project.update", {
            projectId: input.projectId,
            expectedRevision: input.expectedRevision,
            name: input.name,
            domain: input.domain,
            sourceLocale: input.sourceLocale,
            targetLocale: input.targetLocale,
            configuration: input.configuration,
          });
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          const page = await listProjectsPage(
            surface.lifecycle,
            surface.offset,
            surface.limit || PROJECT_PAGE_LIMIT,
          );
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          dispatch({
            type: "PATCH_PROJECTS",
            patch: {
              projects: page.items,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              actionError: null,
            },
          });
          return true;
        } catch (error) {
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          dispatch({
            type: "PATCH_PROJECTS",
            patch: { actionError: toUiError(error) },
          });
          return false;
        }
      },

      setProjectLifecycle: async (projectId, expectedRevision, lifecycle) => {
        if (!stateRef.current.mutationsEnabled) return false;
        const surface = stateRef.current.surface;
        if (surface.kind !== "projects") return false;
        const op = beginOp(lifecycleOpRef, "projects");
        try {
          await invokeEngine("project.setLifecycle", {
            projectId,
            expectedRevision,
            lifecycle,
          });
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          const page = await listProjectsPage(
            surface.lifecycle,
            surface.offset,
            surface.limit || PROJECT_PAGE_LIMIT,
          );
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          dispatch({
            type: "PATCH_PROJECTS",
            patch: {
              projects: page.items,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              actionError: null,
            },
          });
          return true;
        } catch (error) {
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          dispatch({
            type: "PATCH_PROJECTS",
            patch: { actionError: toUiError(error) },
          });
          return false;
        }
      },

      recycleProject: async (projectId, expectedRevision, reason) => {
        if (!stateRef.current.mutationsEnabled) return false;
        if (!reason.trim()) return false;
        const surface = stateRef.current.surface;
        if (surface.kind !== "projects") return false;
        const op = beginOp(lifecycleOpRef, "projects");
        try {
          await invokeEngine("recycle.delete", {
            entityId: projectId,
            entityType: "project",
            expectedRevision,
            reason: reason.trim(),
          });
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          // Clear session if the recycled project was active.
          const stored = readSessionFromStorage();
          if (stored.ok && stored.session.projectId === projectId) {
            clearSessionStorage();
            saveCoordinator.clearActive();
          }
          const page = await listProjectsPage(
            surface.lifecycle,
            surface.offset,
            surface.limit || PROJECT_PAGE_LIMIT,
          );
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          if (page.total === 0 && surface.lifecycle === "active") {
            dispatch({ type: "SET_SURFACE", surface: { kind: "welcome" } });
          } else {
            dispatch({
              type: "PATCH_PROJECTS",
              patch: {
                projects: page.items,
                total: page.total,
                offset: page.offset,
                limit: page.limit,
                actionError: null,
              },
            });
          }
          return true;
        } catch (error) {
          if (!isOpCurrent(op, lifecycleOpRef)) return false;
          dispatch({
            type: "PATCH_PROJECTS",
            patch: { actionError: toUiError(error) },
          });
          return false;
        }
      },

      recycleActiveDocument: async (reason) => {
        if (!stateRef.current.mutationsEnabled) return false;
        if (!reason.trim()) return false;
        const surface = stateRef.current.surface;
        if (surface.kind !== "workbench") return false;
        if (surface.switchPending || surface.pendingConfirm) return false;
        if (saveCoordinator.active?.isComposing) return false;
        const opId = ++switchDocOpRef.current;
        const ok = await flushOrStay();
        if (!ok) return false;
        const current =
          stateRef.current.surface.kind === "workbench"
            ? stateRef.current.surface
            : null;
        if (!current) return false;
        try {
          await invokeEngine("recycle.delete", {
            entityId: current.ctx.document.id,
            entityType: "document",
            expectedRevision: current.ctx.document.revision,
            reason: reason.trim(),
          });
          if (switchDocOpRef.current !== opId) return false;
          const documents = await listAllDocuments(current.ctx.project.id);
          if (switchDocOpRef.current !== opId) return false;
          const route = resolvePostDeleteDocumentRoute(
            documents,
            current.ctx.document.id,
          );
          if (route.kind === "import") {
            clearSessionStorage();
            saveCoordinator.clearActive();
            dispatch({
              type: "SET_SURFACE",
              surface: {
                kind: "import-document",
                projectId: current.ctx.project.id,
                projectName: current.ctx.project.name,
              },
            });
            return true;
          }
          const session = makeSession(current.ctx.project.id, route.documentId);
          const ctx = await hydrateSession(session);
          if (switchDocOpRef.current !== opId) return false;
          enterWorkbench(ctx, { persistSession: true });
          return true;
        } catch (error) {
          if (switchDocOpRef.current !== opId) return false;
          if (stateRef.current.surface.kind === "workbench") {
            dispatch({
              type: "PATCH_WORKBENCH",
              patch: { transitionError: toUiError(error) },
            });
          }
          return false;
        }
      },
    };
  }, [
    attachSegmentWithPending,
    beginOp,
    boot,
    enterWorkbench,
    flushOrStay,
    hydrateSession,
    invalidateFeatureOps,
    isOpCurrent,
    resolveHome,
    saveCoordinator,
  ]);

  return {
    state,
    saveTick,
    composition: compositionRef.current,
    saveCoordinator,
    featureGeneration,
    commands,
  };
}
