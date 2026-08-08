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
  Project,
  Segment,
  SegmentCounts,
  SegmentEditorRow,
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
  type AppState,
  type SessionContext,
} from "./app-state";
import { classifyDraftJournal, probesFromRows } from "./draft-recovery";
import { SaveCoordinator } from "./save-coordinator";
import {
  clearSessionStorage,
  makeSession,
  readSessionFromStorage,
  writeSessionToStorage,
  type SessionIdentity,
} from "./session";

const PAGE_LIMIT = 200;

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

async function listAllProjects(): Promise<Project[]> {
  const page = await invokeEngine("project.list", {
    limit: PAGE_LIMIT,
    offset: 0,
    lifecycle: "active",
  });
  return page.items;
}

async function listAllDocuments(projectId: string): Promise<Document[]> {
  const page = await invokeEngine("document.list", {
    projectId,
    limit: PAGE_LIMIT,
    offset: 0,
  });
  return page.items;
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
    }) => Promise<void>;
    toggleTmPanel: () => void;
    goQa: () => Promise<void>;
    runQa: () => Promise<void>;
    jumpToIssue: (segmentId: string) => Promise<void>;
    goExport: () => Promise<void>;
    checkGateAndExport: () => Promise<void>;
    backToWorkbench: (focusSegmentId?: string | null) => Promise<void>;
  };
}

export function useAppController(): AppController {
  const [state, dispatch] = useReducer(
    appReducer,
    undefined,
    createInitialState,
  );
  const [saveTick, setSaveTick] = useState(0);
  const generationRef = useRef(0);
  const openProjectOpRef = useRef(0);
  const qaLoadOpRef = useRef(0);
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
      const { rows } = await listAllEditorRows(session.documentId);
      const counts = snapshot.counts ?? countsFromRows(rows);
      return {
        session,
        project: snapshot.project,
        document,
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
          tmMatches: [],
          tmLoading: false,
          tmError: null,
          tmCollapsed,
          transitionError: null,
          pendingConfirm: false,
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

  const resolveHome = useCallback(async () => {
    const projects = await listAllProjects();
    if (projects.length === 0) {
      dispatch({ type: "SET_SURFACE", surface: { kind: "welcome" } });
    } else {
      dispatch({
        type: "SET_SURFACE",
        surface: { kind: "projects", projects },
      });
    }
    dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
  }, []);

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
              dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
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
          }
        } else if (current.kind === "boot" || current.kind === "recovery") {
          await boot(gen);
        } else {
          dispatch({ type: "ENGINE_STATUS", status: "connected" });
          dispatch({ type: "SET_MUTATIONS_ENABLED", enabled: true });
        }
        dispatch({ type: "ENGINE_STATUS", status: "connected" });
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
      const gen = generationRef.current;
      void rehydrateHydratedSurface(gen);
    });

    return () => {
      rehydrateRef.current = null;
      unsubStatus();
      unsubReconnect();
    };
  }, [boot, enterWorkbench, hydrateSession, isCurrent, saveCoordinator]);

  // Exact TM lookup when active segment changes on workbench.
  useEffect(() => {
    const surface = state.surface;
    if (surface.kind !== "workbench") return;
    const segmentId = surface.activeSegmentId;
    if (!segmentId) return;
    const row = surface.ctx.rows.find((r) => r.segment.id === segmentId);
    if (!row) return;
    let cancelled = false;
    const projectId = surface.ctx.project.id;
    const sourceText = row.segment.sourceText;
    dispatch({
      type: "PATCH_WORKBENCH",
      patch: { tmLoading: true, tmError: null, tmMatches: [] },
    });
    void (async () => {
      try {
        const result = await invokeEngine("tm.lookupExact", {
          projectId,
          sourceText,
        });
        if (cancelled) return;
        const current = stateRef.current.surface;
        if (
          current.kind !== "workbench" ||
          current.activeSegmentId !== segmentId
        ) {
          return;
        }
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: {
            tmMatches: result.matches,
            tmLoading: false,
            tmError: null,
          },
        });
      } catch (error) {
        if (cancelled) return;
        const current = stateRef.current.surface;
        if (
          current.kind !== "workbench" ||
          current.activeSegmentId !== segmentId
        ) {
          return;
        }
        dispatch({
          type: "PATCH_WORKBENCH",
          patch: {
            tmLoading: false,
            tmError: toUiError(error),
            tmMatches: [],
          },
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
          surface.kind === "export"
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
          surface.kind === "export"
        ) {
          if (surface.kind === "workbench") {
            const ok = await flushOrStay();
            if (!ok) return;
          } else if (surface.kind === "qa" || surface.kind === "export") {
            // Leaving session surfaces: no pending editor, but clear session intentionally.
          }
          clearSessionStorage();
          saveCoordinator.clearActive();
        }
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
        const opId = ++openProjectOpRef.current;
        dispatch({
          type: "PATCH_PROJECTS",
          patch: { loading: true, error: null },
        });
        try {
          const snapshot = await invokeEngine("project.get", { projectId });
          if (openProjectOpRef.current !== opId) return;
          const documents = await listAllDocuments(projectId);
          if (openProjectOpRef.current !== opId) return;
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
          if (openProjectOpRef.current !== opId) return;
          enterWorkbench(ctx, { persistSession: true });
        } catch (error) {
          if (openProjectOpRef.current !== opId) return;
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
        dispatch({
          type: "PATCH_IMPORT",
          patch: { pending: true, error: null },
        });
        try {
          const path = await desktopApi().selectSourceDocument();
          if (!path) {
            dispatch({
              type: "PATCH_IMPORT",
              patch: { pending: false, error: null },
            });
            return;
          }
          const imported = await invokeEngine("document.import", {
            projectId: surface.projectId,
            sourcePath: path,
          });
          const session = makeSession(surface.projectId, imported.document.id);
          const ctx = await hydrateSession(session);
          enterWorkbench(ctx, { persistSession: true });
        } catch (error) {
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

          const currentIndex = rows.findIndex(
            (r) => r.segment.id === segmentId,
          );
          const nextRow = rows[currentIndex + 1] ?? rows[currentIndex] ?? null;
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
    };
  }, [
    attachSegmentWithPending,
    boot,
    enterWorkbench,
    flushOrStay,
    hydrateSession,
    resolveHome,
    saveCoordinator,
  ]);

  return {
    state,
    saveTick,
    composition: compositionRef.current,
    saveCoordinator,
    commands,
  };
}
