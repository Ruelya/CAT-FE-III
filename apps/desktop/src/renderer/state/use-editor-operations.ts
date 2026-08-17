import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChineseConversionProfile,
  EditorPreferences,
  EditorSearchField,
  InlineTag,
  ReplacePreviewResult,
  ReviewQueueItem,
  SegmentEditorRow,
  SpellCheckResult,
  EditorComment,
  EditorHistoryResult,
} from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { isImeKeyboardEvent } from "../lib/ime";
import { desktopApi, invokeEngine } from "../lib/rpc";
import type { SaveCoordinator } from "./save-coordinator";
import type { SessionContext } from "./app-state";
import {
  applyEditorMutationResult,
  CHINESE_PROFILES,
  isCommandAvailable,
  isEditorCommandId,
  orderedMergePair,
  resolveAcceptedEditorShortcut,
  rowBySegmentId,
  type EditorCommandId,
  type EditorMutationMode,
  type EditorPanelId,
} from "./editor-operations";

export interface EditorOpsGateway {
  generation: number;
  mutationsEnabled: boolean;
  /** True only while the Workbench surface is visible and owns editor chrome. */
  workbenchActive: boolean;
  ctx: SessionContext | null;
  activeSegmentId: string | null;
  focusSegmentId: string | null;
  selectedSegmentIds: string[];
  saveCoordinator: SaveCoordinator;
  flushOrStay: () => Promise<boolean>;
  /** Commit applied rows/counts/focus into Workbench surface. */
  commitWorkbenchRows: (input: {
    rows: SegmentEditorRow[];
    counts: SessionContext["counts"];
    activeSegmentId: string | null;
    focusSegmentId: string | null;
    needsRefresh: boolean;
  }) => Promise<void>;
  /** Re-list active document rows when structural/incomplete. */
  refreshActiveDocumentRows: (focusSegmentId?: string | null) => Promise<void>;
}

export interface FindReplaceState {
  query: string;
  replacement: string;
  field: EditorSearchField;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  findStatus: "idle" | "loading" | "ready" | "error";
  findError: UiError | null;
  matches: Array<{
    segmentId: string;
    field: EditorSearchField;
    matchedText: string;
    start: number;
    end: number;
    revision: number;
  }>;
  findTotal: number;
  findOffset: number;
  findLimit: number;
  preview: ReplacePreviewResult | null;
  previewStatus: "idle" | "loading" | "ready" | "error" | "applying";
  previewError: UiError | null;
}

export interface EditorOperationsApi {
  panel: EditorPanelId;
  openPanel: (panel: EditorPanelId) => void;
  closePanel: () => void;
  busy: boolean;
  commandError: UiError | null;
  clearCommandError: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isAvailable: (id: EditorCommandId) => boolean;
  runCommand: (id: EditorCommandId) => void;
  findReplace: FindReplaceState;
  setFindQuery: (q: string) => void;
  setReplacement: (r: string) => void;
  setFindField: (f: EditorSearchField) => void;
  setFindOptions: (opts: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
  }) => void;
  runFind: (offset?: number) => Promise<void>;
  runPreview: () => Promise<void>;
  applyReplace: () => Promise<void>;
  selectFindMatch: (segmentId: string) => Promise<void>;
  // tags
  targetTagsDraft: InlineTag[];
  setTargetTagsDraft: (tags: InlineTag[]) => void;
  submitTags: () => Promise<void>;
  // propagate
  confirmPropagate: () => Promise<void>;
  // structure
  structureMode: "split" | "merge" | null;
  splitSourceOffset: number;
  splitTargetOffset: number;
  setSplitOffsets: (source: number, target: number) => void;
  confirmStructure: () => Promise<void>;
  // source
  sourceDraft: string;
  sourceReason: string;
  setSourceDraft: (t: string) => void;
  setSourceReason: (r: string) => void;
  confirmSourceCorrection: () => Promise<void>;
  // comments
  comments: EditorComment[];
  commentsLoading: boolean;
  commentsError: UiError | null;
  commentText: string;
  setCommentText: (t: string) => void;
  editingCommentId: string | null;
  editingCommentText: string;
  setEditingComment: (commentId: string | null, text?: string) => void;
  loadComments: () => Promise<void>;
  createComment: () => Promise<void>;
  updateComment: (
    commentId: string,
    revision: number,
    text: string,
  ) => Promise<boolean>;
  resolveComment: (
    commentId: string,
    revision: number,
    resolved: boolean,
  ) => Promise<void>;
  deleteComment: (commentId: string, revision: number) => Promise<boolean>;
  // spell
  spellResult: SpellCheckResult | null;
  spellSide: "source" | "target";
  setSpellSide: (s: "source" | "target") => void;
  runSpellCheck: () => Promise<void>;
  dictionaryWords: string[];
  dictionaryLoading: boolean;
  dictionaryError: UiError | null;
  dictionaryWord: string;
  setDictionaryWord: (w: string) => void;
  loadDictionary: () => Promise<void>;
  addDictionaryWord: () => Promise<void>;
  removeDictionaryWord: (word: string) => Promise<void>;
  // chinese
  convertChinese: (profile: ChineseConversionProfile) => Promise<void>;
  chineseProfiles: typeof CHINESE_PROFILES;
  // history
  history: EditorHistoryResult | null;
  historyLoading: boolean;
  historyError: UiError | null;
  loadHistory: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  // preferences
  preferences: EditorPreferences | null;
  preferencesBase: EditorPreferences | null;
  preferencesLoading: boolean;
  preferencesError: UiError | null;
  preferencesPending: boolean;
  setPreferenceField: <K extends keyof EditorPreferences>(
    key: K,
    value: EditorPreferences[K],
  ) => void;
  persistPreferenceField: <K extends keyof EditorPreferences>(
    key: K,
    value: EditorPreferences[K],
  ) => Promise<void>;
  loadPreferences: () => Promise<void>;
  savePreferences: () => Promise<void>;
  // review
  reviewItems: ReviewQueueItem[];
  reviewTotal: number;
  reviewOffset: number;
  reviewLimit: number;
  reviewLoading: boolean;
  reviewError: UiError | null;
  reviewPendingId: string | null;
  loadReviewQueue: (offset?: number) => Promise<void>;
  acceptReview: (item: ReviewQueueItem) => Promise<void>;
  rejectReview: (item: ReviewQueueItem) => Promise<void>;
  invalidate: () => void;
}

const FIND_LIMIT = 25;
const REVIEW_LIMIT = 25;

function emptyFindReplace(): FindReplaceState {
  return {
    query: "",
    replacement: "",
    field: "target",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    findStatus: "idle",
    findError: null,
    matches: [],
    findTotal: 0,
    findOffset: 0,
    findLimit: FIND_LIMIT,
    preview: null,
    previewStatus: "idle",
    previewError: null,
  };
}

export function useEditorOperations(
  gateway: EditorOpsGateway,
): EditorOperationsApi {
  const [panel, setPanel] = useState<EditorPanelId>(null);
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<UiError | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [findReplace, setFindReplace] = useState(emptyFindReplace);
  const [targetTagsDraft, setTargetTagsDraft] = useState<InlineTag[]>([]);
  const [structureMode, setStructureMode] = useState<"split" | "merge" | null>(
    null,
  );
  const [splitSourceOffset, setSplitSourceOffset] = useState(0);
  const [splitTargetOffset, setSplitTargetOffset] = useState(0);
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceReason, setSourceReason] = useState("");
  const [comments, setComments] = useState<EditorComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<UiError | null>(null);
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [spellResult, setSpellResult] = useState<SpellCheckResult | null>(null);
  const [spellSide, setSpellSide] = useState<"source" | "target">("target");
  const [dictionaryWords, setDictionaryWords] = useState<string[]>([]);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [dictionaryError, setDictionaryError] = useState<UiError | null>(null);
  const [dictionaryWord, setDictionaryWord] = useState("");
  const [history, setHistory] = useState<EditorHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<UiError | null>(null);
  const [preferences, setPreferences] = useState<EditorPreferences | null>(
    null,
  );
  const [preferencesBase, setPreferencesBase] =
    useState<EditorPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesError, setPreferencesError] = useState<UiError | null>(
    null,
  );
  const [preferencesPending, setPreferencesPending] = useState(false);
  const preferencesRef = useRef<EditorPreferences | null>(null);
  const preferencesBaseRef = useRef<EditorPreferences | null>(null);
  const prefOpRef = useRef(0);
  preferencesRef.current = preferences;
  preferencesBaseRef.current = preferencesBase;
  const [reviewItems, setReviewItems] = useState<ReviewQueueItem[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewOffset, setReviewOffset] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<UiError | null>(null);
  const [reviewPendingId, setReviewPendingId] = useState<string | null>(null);

  /** Mutation token — undo/redo/tag/split/merge/etc. */
  const mutOpRef = useRef(0);
  /** Independent read token — history/comments/find/list must not invalidate mutations. */
  const readOpRef = useRef(0);
  const busyRef = useRef(false);
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;

  const invalidate = useCallback(() => {
    mutOpRef.current += 1;
    readOpRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setReviewPendingId(null);
  }, []);

  const beginMutOp = useCallback(() => {
    const opId = ++mutOpRef.current;
    const generation = gatewayRef.current.generation;
    return { opId, generation };
  }, []);

  const beginReadOp = useCallback(() => {
    const opId = ++readOpRef.current;
    const generation = gatewayRef.current.generation;
    return { opId, generation };
  }, []);

  const isMutCurrent = useCallback(
    (op: { opId: number; generation: number }) => {
      return (
        mutOpRef.current === op.opId &&
        gatewayRef.current.generation === op.generation
      );
    },
    [],
  );

  const isReadCurrent = useCallback(
    (op: { opId: number; generation: number }) => {
      return (
        readOpRef.current === op.opId &&
        gatewayRef.current.generation === op.generation
      );
    },
    [],
  );

  /** @deprecated alias kept for local call-site migration */
  const beginOp = beginMutOp;
  const isOpCurrent = isMutCurrent;

  const activeRow = useMemo(() => {
    const ctx = gateway.ctx;
    if (!ctx) return null;
    return rowBySegmentId(ctx.rows, gateway.activeSegmentId);
  }, [gateway.ctx, gateway.activeSegmentId]);

  // Sync tag draft when active row changes and tags panel opens
  useEffect(() => {
    if (panel === "tags" && activeRow) {
      setTargetTagsDraft(activeRow.targetTags.map((t) => ({ ...t })));
    }
  }, [panel, activeRow?.segment.id, activeRow?.segment.revision]);

  useEffect(() => {
    if (panel === "sourceCorrection" && activeRow) {
      setSourceDraft(activeRow.segment.sourceText);
      setSourceReason("");
    }
  }, [panel, activeRow?.segment.id]);

  const commitMutation = useCallback(
    async (
      result: Awaited<ReturnType<typeof invokeEngine<"segment.tag.set">>>,
      mode: EditorMutationMode,
    ) => {
      const g = gatewayRef.current;
      if (!g.ctx) return;
      const applied = applyEditorMutationResult(
        g.ctx.rows,
        result,
        mode,
        g.focusSegmentId ?? g.activeSegmentId,
      );
      await g.commitWorkbenchRows({
        rows: applied.rows,
        counts: result.counts ?? applied.counts,
        activeSegmentId: applied.focusSegmentId,
        focusSegmentId: applied.focusSegmentId,
        needsRefresh: applied.needsFullRefresh,
      });
      if (applied.needsFullRefresh) {
        await g.refreshActiveDocumentRows(applied.focusSegmentId);
      }
    },
    [],
  );

  const runTargetMutation = useCallback(
    async (
      mode: EditorMutationMode,
      invoke: (
        row: SegmentEditorRow,
      ) => Promise<Awaited<ReturnType<typeof invokeEngine<"segment.tag.set">>>>,
    ): Promise<boolean> => {
      const g = gatewayRef.current;
      if (!g.mutationsEnabled || !g.ctx) return false;
      if (g.saveCoordinator.active?.isComposing) return false;
      if (busyRef.current) return false;
      const op = beginMutOp();
      busyRef.current = true;
      setBusy(true);
      setCommandError(null);
      try {
        if (g.saveCoordinator.isDirty()) {
          const ok = await g.flushOrStay();
          if (!ok) {
            if (isMutCurrent(op)) {
              busyRef.current = false;
              setBusy(false);
            }
            return false;
          }
        }
        if (!isMutCurrent(op)) return false;
        const ctx = gatewayRef.current.ctx;
        if (!ctx) {
          if (isMutCurrent(op)) {
            busyRef.current = false;
            setBusy(false);
          }
          return false;
        }
        const activeId = gatewayRef.current.activeSegmentId;
        const row = rowBySegmentId(ctx.rows, activeId);
        if (!row) {
          setCommandError({
            code: "NO_SEGMENT",
            message: "No active segment",
            kind: "domain",
          });
          if (isMutCurrent(op)) {
            busyRef.current = false;
            setBusy(false);
          }
          return false;
        }
        const result = await invoke(row);
        if (!isMutCurrent(op)) return false;
        // Ensure still same document and originating active row context
        const after = gatewayRef.current;
        if (
          after.ctx?.document.id !== ctx.document.id ||
          after.activeSegmentId !== activeId
        ) {
          return false;
        }
        await commitMutation(result, mode);
        if (isMutCurrent(op)) {
          busyRef.current = false;
          setBusy(false);
          setPanel(null);
          setStructureMode(null);
        }
        return true;
      } catch (error) {
        if (isMutCurrent(op)) {
          setCommandError(toUiError(error));
          busyRef.current = false;
          setBusy(false);
        }
        return false;
      }
    },
    [beginMutOp, commitMutation, isMutCurrent],
  );

  const openPanel = useCallback((next: EditorPanelId) => {
    setCommandError(null);
    setPanel(next);
    if (next === "structure") setStructureMode("split");
    if (next === null) setStructureMode(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanel(null);
    setStructureMode(null);
    setCommandError(null);
  }, []);

  const buildAvailability = useCallback(() => {
    const g = gatewayRef.current;
    const mergeEligible =
      g.selectedSegmentIds.length === 2 &&
      g.ctx !== null &&
      orderedMergePair(
        g.ctx.rows,
        g.selectedSegmentIds[0]!,
        g.selectedSegmentIds[1]!,
      ) !== null;
    return {
      hasWorkbenchSession: g.workbenchActive && g.ctx !== null,
      hasActiveRow: Boolean(g.activeSegmentId && g.ctx),
      isComposing: g.saveCoordinator.active?.isComposing === true,
      isDirty: g.saveCoordinator.isDirty(),
      mutationsEnabled: g.mutationsEnabled,
      busy: busyRef.current || busy,
      canUndo,
      canRedo,
      mergeEligible,
    };
  }, [busy, canUndo, canRedo]);

  const isAvailable = useCallback(
    (id: EditorCommandId) => isCommandAvailable(id, buildAvailability()),
    [buildAvailability],
  );

  const loadHistory = useCallback(async () => {
    const g = gatewayRef.current;
    if (!g.ctx) return;
    const op = beginReadOp();
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await invokeEngine("editor.history", {
        projectId: g.ctx.project.id,
        limit: 50,
        offset: 0,
      });
      if (!isReadCurrent(op)) return;
      setHistory(result);
      setCanUndo(result.canUndo);
      setCanRedo(result.canRedo);
      setHistoryLoading(false);
    } catch (error) {
      if (!isReadCurrent(op)) return;
      setHistoryError(toUiError(error));
      setHistoryLoading(false);
    }
  }, [beginReadOp, isReadCurrent]);

  const undo = useCallback(async () => {
    const g = gatewayRef.current;
    if (!g.ctx || !g.mutationsEnabled) return;
    if (g.saveCoordinator.active?.isComposing) return;
    if (busyRef.current) return;
    const op = beginMutOp();
    busyRef.current = true;
    setBusy(true);
    setCommandError(null);
    try {
      if (g.saveCoordinator.isDirty()) {
        const ok = await g.flushOrStay();
        if (!ok) return;
      }
      if (!isMutCurrent(op) || !gatewayRef.current.ctx) return;
      const result = await invokeEngine("editor.undo", {
        projectId: gatewayRef.current.ctx.project.id,
      });
      if (!isMutCurrent(op)) return;
      await commitMutation(result, "structural");
      if (!isMutCurrent(op)) return;
      // History refresh uses an independent read token; mutation still settles.
      await loadHistory();
    } catch (error) {
      if (isMutCurrent(op)) {
        setCommandError(toUiError(error));
      }
    } finally {
      if (isMutCurrent(op)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [beginMutOp, commitMutation, isMutCurrent, loadHistory]);

  const redo = useCallback(async () => {
    const g = gatewayRef.current;
    if (!g.ctx || !g.mutationsEnabled) return;
    if (g.saveCoordinator.active?.isComposing) return;
    if (busyRef.current) return;
    const op = beginMutOp();
    busyRef.current = true;
    setBusy(true);
    setCommandError(null);
    try {
      if (g.saveCoordinator.isDirty()) {
        const ok = await g.flushOrStay();
        if (!ok) return;
      }
      if (!isMutCurrent(op) || !gatewayRef.current.ctx) return;
      const result = await invokeEngine("editor.redo", {
        projectId: gatewayRef.current.ctx.project.id,
      });
      if (!isMutCurrent(op)) return;
      await commitMutation(result, "structural");
      if (!isMutCurrent(op)) return;
      await loadHistory();
    } catch (error) {
      if (isMutCurrent(op)) {
        setCommandError(toUiError(error));
      }
    } finally {
      if (isMutCurrent(op)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [beginMutOp, commitMutation, isMutCurrent, loadHistory]);

  const runCommand = useCallback(
    (id: EditorCommandId) => {
      if (!isAvailable(id)) return;
      switch (id) {
        case "editor.findReplace":
          openPanel("findReplace");
          break;
        case "editor.tags":
          openPanel("tags");
          break;
        case "editor.propagate":
          openPanel("propagate");
          break;
        case "editor.split":
          setStructureMode("split");
          openPanel("structure");
          break;
        case "editor.merge":
          setStructureMode("merge");
          openPanel("structure");
          break;
        case "editor.correctSource":
          openPanel("sourceCorrection");
          break;
        case "editor.comments":
          openPanel("comments");
          break;
        case "editor.spell":
          openPanel("spell");
          break;
        case "editor.chinese":
          openPanel("chinese");
          break;
        case "editor.history":
          openPanel("history");
          void loadHistory();
          break;
        case "editor.preferences":
          openPanel("preferences");
          break;
        case "editor.review":
          openPanel("review");
          break;
        case "editor.undo":
          void undo();
          break;
        case "editor.redo":
          void redo();
          break;
        default:
          break;
      }
    },
    [isAvailable, loadHistory, openPanel, redo, undo],
  );

  // Workbench-owned keyboard chords — accept only when registry + focus + IME allow.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeKeyboardEvent(event)) return;
      const workbenchRoot = document.querySelector('[data-testid="workbench"]');
      const workbenchFocused =
        workbenchRoot instanceof HTMLElement &&
        (document.activeElement === null ||
          document.activeElement === document.body ||
          workbenchRoot.contains(document.activeElement));
      const id = resolveAcceptedEditorShortcut(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          isComposing: event.isComposing,
          keyCode: event.keyCode,
          which: event.which,
        },
        buildAvailability(),
        { workbenchFocused },
      );
      if (!id) return;
      event.preventDefault();
      runCommand(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [buildAvailability, runCommand]);

  // Optional menu/IPC bridge — same Workbench/IME gates; never invent unregistered ids.
  useEffect(() => {
    const unsub = desktopApi().onEditorCommand((commandId) => {
      if (!isEditorCommandId(commandId)) return;
      if (!isAvailable(commandId)) return;
      const g = gatewayRef.current;
      if (g.saveCoordinator.active?.isComposing) return;
      runCommand(commandId);
    });
    return () => {
      unsub();
    };
  }, [isAvailable, runCommand]);

  const setFindQuery = useCallback((q: string) => {
    setFindReplace((s) => ({
      ...s,
      query: q,
      preview: null,
      previewStatus: "idle",
      previewError: null,
    }));
  }, []);

  const setReplacement = useCallback((r: string) => {
    setFindReplace((s) => ({
      ...s,
      replacement: r,
      preview: null,
      previewStatus: "idle",
      previewError: null,
    }));
  }, []);

  const setFindField = useCallback((f: EditorSearchField) => {
    setFindReplace((s) => ({
      ...s,
      field: f,
      preview: null,
      previewStatus: "idle",
      previewError: null,
    }));
  }, []);

  const setFindOptions = useCallback(
    (opts: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
      regex?: boolean;
    }) => {
      setFindReplace((s) => ({
        ...s,
        ...opts,
        preview: null,
        previewStatus: "idle",
        previewError: null,
      }));
    },
    [],
  );

  const runFind = useCallback(
    async (offset = 0) => {
      const g = gatewayRef.current;
      if (!g.ctx) return;
      const query = findReplace.query.trim();
      if (!query) {
        setFindReplace((s) => ({
          ...s,
          findStatus: "idle",
          matches: [],
          findTotal: 0,
          findOffset: 0,
          findError: null,
        }));
        return;
      }
      const op = beginReadOp();
      setFindReplace((s) => ({
        ...s,
        findStatus: "loading",
        findError: null,
      }));
      try {
        const result = await invokeEngine("segment.find", {
          documentId: g.ctx.document.id,
          query,
          field: findReplace.field,
          caseSensitive: findReplace.caseSensitive,
          wholeWord: findReplace.wholeWord,
          regex: findReplace.regex,
          offset,
          limit: FIND_LIMIT,
        });
        if (!isReadCurrent(op)) return;
        if (gatewayRef.current.ctx?.document.id !== g.ctx.document.id) return;
        setFindReplace((s) => ({
          ...s,
          findStatus: "ready",
          matches: result.matches.map((m) => ({
            segmentId: m.segmentId,
            field: m.field,
            matchedText: m.matchedText,
            start: m.start,
            end: m.end,
            revision: m.revision,
          })),
          findTotal: result.total,
          findOffset: result.offset,
          findLimit: result.limit,
          findError: null,
        }));
      } catch (error) {
        if (!isReadCurrent(op)) return;
        setFindReplace((s) => ({
          ...s,
          findStatus: "error",
          findError: toUiError(error),
        }));
      }
    },
    [
      beginReadOp,
      findReplace.caseSensitive,
      findReplace.field,
      findReplace.query,
      findReplace.regex,
      findReplace.wholeWord,
      isReadCurrent,
    ],
  );

  const runPreview = useCallback(async () => {
    const g = gatewayRef.current;
    if (!g.ctx) return;
    const query = findReplace.query;
    if (!query) return;
    const op = beginReadOp();
    setFindReplace((s) => ({
      ...s,
      previewStatus: "loading",
      previewError: null,
    }));
    try {
      const result = await invokeEngine("segment.replace.preview", {
        documentId: g.ctx.document.id,
        query,
        replacement: findReplace.replacement,
        field: findReplace.field,
        caseSensitive: findReplace.caseSensitive,
        wholeWord: findReplace.wholeWord,
        regex: findReplace.regex,
      });
      if (!isReadCurrent(op)) return;
      if (gatewayRef.current.ctx?.document.id !== g.ctx.document.id) return;
      setFindReplace((s) => ({
        ...s,
        preview: result,
        previewStatus: "ready",
        previewError: null,
      }));
    } catch (error) {
      if (!isReadCurrent(op)) return;
      setFindReplace((s) => ({
        ...s,
        previewStatus: "error",
        previewError: toUiError(error),
      }));
    }
  }, [
    beginReadOp,
    findReplace.caseSensitive,
    findReplace.field,
    findReplace.query,
    findReplace.regex,
    findReplace.replacement,
    findReplace.wholeWord,
    isReadCurrent,
  ]);

  const applyReplace = useCallback(async () => {
    const g = gatewayRef.current;
    const preview = findReplace.preview;
    if (!g.ctx || !preview || !g.mutationsEnabled) return;
    if (g.saveCoordinator.active?.isComposing) return;
    if (busyRef.current) return;
    const op = beginMutOp();
    busyRef.current = true;
    setFindReplace((s) => ({ ...s, previewStatus: "applying" }));
    setBusy(true);
    setCommandError(null);
    try {
      if (g.saveCoordinator.isDirty()) {
        const ok = await g.flushOrStay();
        if (!ok) {
          if (isMutCurrent(op)) {
            setFindReplace((s) => ({ ...s, previewStatus: "ready" }));
          }
          return;
        }
      }
      if (!isMutCurrent(op)) return;
      const result = await invokeEngine("segment.replace.apply", { preview });
      if (!isMutCurrent(op)) return;
      await commitMutation(result, "replace");
      if (isMutCurrent(op)) {
        setFindReplace((s) => ({
          ...s,
          preview: null,
          previewStatus: "idle",
          previewError: null,
        }));
        void runFind(0);
      }
    } catch (error) {
      if (isMutCurrent(op)) {
        // Retain preview on conflict/stale
        setFindReplace((s) => ({
          ...s,
          previewStatus: "error",
          previewError: toUiError(error),
        }));
      }
    } finally {
      if (isMutCurrent(op)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [beginMutOp, commitMutation, findReplace.preview, isMutCurrent, runFind]);

  const selectFindMatch = useCallback(async (segmentId: string) => {
    const g = gatewayRef.current;
    if (!g.ctx) return;
    await g.commitWorkbenchRows({
      rows: g.ctx.rows,
      counts: g.ctx.counts,
      activeSegmentId: segmentId,
      focusSegmentId: segmentId,
      needsRefresh: false,
    });
  }, []);

  const submitTags = useCallback(async () => {
    await runTargetMutation("replace", (row) =>
      invokeEngine("segment.tag.set", {
        segmentId: row.segment.id,
        expectedRevision: row.segment.revision,
        targetTags: targetTagsDraft,
      }),
    );
  }, [runTargetMutation, targetTagsDraft]);

  const confirmPropagate = useCallback(async () => {
    await runTargetMutation("replace", (row) =>
      invokeEngine("segment.propagate", {
        segmentId: row.segment.id,
        expectedRevision: row.segment.revision,
      }),
    );
  }, [runTargetMutation]);

  const confirmStructure = useCallback(async () => {
    if (structureMode === "split") {
      await runTargetMutation("structural", (row) =>
        invokeEngine("segment.split", {
          segmentId: row.segment.id,
          expectedRevision: row.segment.revision,
          sourceOffset: splitSourceOffset,
          targetOffset: splitTargetOffset,
        }),
      );
      return;
    }
    if (structureMode === "merge") {
      // Capture stable IDs only; revisions are re-read after flush.
      const g0 = gatewayRef.current;
      if (!g0.ctx || !g0.mutationsEnabled) return;
      if (g0.saveCoordinator.active?.isComposing) return;
      if (busyRef.current) return;
      if (g0.selectedSegmentIds.length !== 2) return;
      const idA = g0.selectedSegmentIds[0]!;
      const idB = g0.selectedSegmentIds[1]!;
      const documentId = g0.ctx.document.id;
      const op = beginMutOp();
      busyRef.current = true;
      setBusy(true);
      setCommandError(null);
      try {
        if (g0.saveCoordinator.isDirty()) {
          const ok = await g0.flushOrStay();
          if (!ok) return;
        }
        if (!isMutCurrent(op)) return;
        const g = gatewayRef.current;
        const ctx = g.ctx;
        if (!ctx || ctx.document.id !== documentId) return;
        // Same document/selection pair must still be current and adjacent.
        if (
          !g.selectedSegmentIds.includes(idA) ||
          !g.selectedSegmentIds.includes(idB)
        ) {
          setCommandError({
            code: "MERGE_SELECTION_CHANGED",
            message: "Selection changed during save",
            kind: "domain",
          });
          return;
        }
        const pair = orderedMergePair(ctx.rows, idA, idB);
        if (!pair) {
          setCommandError({
            code: "MERGE_INELIGIBLE",
            message: "Select two adjacent segments",
            kind: "domain",
          });
          return;
        }
        const result = await invokeEngine("segment.merge", {
          firstSegmentId: pair.first.segment.id,
          firstExpectedRevision: pair.first.segment.revision,
          secondSegmentId: pair.second.segment.id,
          secondExpectedRevision: pair.second.segment.revision,
        });
        if (!isMutCurrent(op)) return;
        if (gatewayRef.current.ctx?.document.id !== documentId) return;
        await commitMutation(result, "structural");
        if (isMutCurrent(op)) {
          setPanel(null);
          setStructureMode(null);
        }
      } catch (error) {
        if (isMutCurrent(op)) {
          setCommandError(toUiError(error));
        }
      } finally {
        if (isMutCurrent(op)) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    }
  }, [
    beginMutOp,
    commitMutation,
    isMutCurrent,
    runTargetMutation,
    splitSourceOffset,
    splitTargetOffset,
    structureMode,
  ]);

  const confirmSourceCorrection = useCallback(async () => {
    const reason = sourceReason.trim();
    if (!reason) {
      setCommandError({
        code: "REASON_REQUIRED",
        message: "Reason required",
        kind: "domain",
      });
      return;
    }
    await runTargetMutation("replace", (row) =>
      invokeEngine("segment.correctSource", {
        segmentId: row.segment.id,
        expectedRevision: row.segment.revision,
        sourceText: sourceDraft,
        reason,
      }),
    );
  }, [runTargetMutation, sourceDraft, sourceReason]);

  const loadComments = useCallback(async () => {
    const g = gatewayRef.current;
    const segmentId = g.activeSegmentId;
    if (!segmentId) return;
    const op = beginReadOp();
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const result = await invokeEngine("segment.comment.list", {
        segmentId,
        includeResolved: true,
      });
      if (!isReadCurrent(op)) return;
      if (gatewayRef.current.activeSegmentId !== segmentId) return;
      setComments(result.comments);
      setCommentsLoading(false);
    } catch (error) {
      if (!isReadCurrent(op)) return;
      setCommentsError(toUiError(error));
      setCommentsLoading(false);
    }
  }, [beginReadOp, isReadCurrent]);

  useEffect(() => {
    if (panel === "comments") void loadComments();
  }, [panel, gateway.activeSegmentId, loadComments]);

  const createComment = useCallback(async () => {
    const g = gatewayRef.current;
    const segmentId = g.activeSegmentId;
    const text = commentText.trim();
    if (!segmentId || !text || !g.mutationsEnabled) return;
    if (busyRef.current) return;
    const op = beginMutOp();
    busyRef.current = true;
    setBusy(true);
    setCommentsError(null);
    try {
      await invokeEngine("segment.comment.create", {
        segmentId,
        text,
        author: "local",
      });
      if (!isMutCurrent(op)) return;
      setCommentText("");
      await loadComments();
    } catch (error) {
      if (isMutCurrent(op)) {
        setCommentsError(toUiError(error));
      }
    } finally {
      if (isMutCurrent(op)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [beginMutOp, commentText, isMutCurrent, loadComments]);

  const updateComment = useCallback(
    async (commentId: string, revision: number, text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !gatewayRef.current.mutationsEnabled) return false;
      if (busyRef.current) return false;
      const op = beginMutOp();
      busyRef.current = true;
      setBusy(true);
      setCommentsError(null);
      try {
        await invokeEngine("segment.comment.update", {
          commentId,
          expectedRevision: revision,
          text: trimmed,
        });
        if (!isMutCurrent(op)) return false;
        setEditingCommentId(null);
        setEditingCommentText("");
        await loadComments();
        return true;
      } catch (error) {
        if (isMutCurrent(op)) {
          setCommentsError(toUiError(error));
        }
        return false;
      } finally {
        if (isMutCurrent(op)) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [beginMutOp, isMutCurrent, loadComments],
  );

  const resolveComment = useCallback(
    async (commentId: string, revision: number, resolved: boolean) => {
      if (busyRef.current) return;
      const op = beginMutOp();
      busyRef.current = true;
      setBusy(true);
      try {
        await invokeEngine("segment.comment.resolve", {
          commentId,
          expectedRevision: revision,
          resolved,
        });
        if (!isMutCurrent(op)) return;
        await loadComments();
      } catch (error) {
        if (isMutCurrent(op)) {
          setCommentsError(toUiError(error));
        }
      } finally {
        if (isMutCurrent(op)) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [beginMutOp, isMutCurrent, loadComments],
  );

  const deleteComment = useCallback(
    async (commentId: string, revision: number) => {
      if (busyRef.current) return false;
      const op = beginMutOp();
      busyRef.current = true;
      setBusy(true);
      setCommentsError(null);
      try {
        await invokeEngine("segment.comment.delete", {
          commentId,
          expectedRevision: revision,
        });
        if (!isMutCurrent(op)) return false;
        await loadComments();
        return true;
      } catch (error) {
        if (isMutCurrent(op)) {
          setCommentsError(toUiError(error));
        }
        return false;
      } finally {
        if (isMutCurrent(op)) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [beginMutOp, isMutCurrent, loadComments],
  );

  const runSpellCheck = useCallback(async () => {
    const g = gatewayRef.current;
    const row = activeRow;
    if (!g.ctx || !row) return;
    const locale =
      spellSide === "source"
        ? g.ctx.project.sourceLocale
        : g.ctx.project.targetLocale;
    const text =
      spellSide === "source"
        ? row.segment.sourceText
        : (g.saveCoordinator.active?.draftTarget ?? row.segment.targetText);
    const op = beginOp();
    setBusy(true);
    setCommandError(null);
    try {
      const result = await invokeEngine("segment.spell.check", {
        text,
        locale,
        limit: 100,
      });
      if (!isOpCurrent(op)) return;
      setSpellResult(result);
      setBusy(false);
    } catch (error) {
      if (isOpCurrent(op)) {
        setCommandError(toUiError(error));
        setBusy(false);
      }
    }
  }, [activeRow, beginOp, isOpCurrent, spellSide]);

  const loadDictionary = useCallback(async () => {
    const g = gatewayRef.current;
    if (!g.ctx) return;
    const locale = g.ctx.project.targetLocale;
    const op = beginOp();
    setDictionaryLoading(true);
    setDictionaryError(null);
    try {
      const result = await invokeEngine("dictionary.list", { locale });
      if (!isOpCurrent(op)) return;
      setDictionaryWords(result.words);
      setDictionaryLoading(false);
    } catch (error) {
      if (isOpCurrent(op)) {
        setDictionaryError(toUiError(error));
        setDictionaryLoading(false);
      }
    }
  }, [beginOp, isOpCurrent]);

  useEffect(() => {
    if (panel === "spell") void loadDictionary();
  }, [panel, loadDictionary]);

  const addDictionaryWord = useCallback(async () => {
    const g = gatewayRef.current;
    const word = dictionaryWord.trim();
    if (!g.ctx || !word) return;
    const op = beginOp();
    setBusy(true);
    try {
      const result = await invokeEngine("dictionary.add", {
        locale: g.ctx.project.targetLocale,
        word,
      });
      if (!isOpCurrent(op)) return;
      setDictionaryWords(result.words);
      setDictionaryWord("");
      setBusy(false);
    } catch (error) {
      if (isOpCurrent(op)) {
        setDictionaryError(toUiError(error));
        setBusy(false);
      }
    }
  }, [beginOp, dictionaryWord, isOpCurrent]);

  const removeDictionaryWord = useCallback(
    async (word: string) => {
      const g = gatewayRef.current;
      if (!g.ctx) return;
      const op = beginOp();
      setBusy(true);
      try {
        const result = await invokeEngine("dictionary.remove", {
          locale: g.ctx.project.targetLocale,
          word,
        });
        if (!isOpCurrent(op)) return;
        setDictionaryWords(result.words);
        setBusy(false);
      } catch (error) {
        if (isOpCurrent(op)) {
          setDictionaryError(toUiError(error));
          setBusy(false);
        }
      }
    },
    [beginOp, isOpCurrent],
  );

  const convertChinese = useCallback(
    async (profile: ChineseConversionProfile) => {
      await runTargetMutation("replace", (row) =>
        invokeEngine("segment.chinese.convert", {
          segmentId: row.segment.id,
          expectedRevision: row.segment.revision,
          profile,
        }),
      );
    },
    [runTargetMutation],
  );

  const loadPreferences = useCallback(async () => {
    const op = beginReadOp();
    setPreferencesLoading(true);
    setPreferencesError(null);
    try {
      const result = await invokeEngine("editor.preferences.get", {});
      if (!isReadCurrent(op)) return;
      setPreferencesBase(result);
      setPreferences({ ...result, shortcuts: { ...result.shortcuts } });
      setPreferencesLoading(false);
    } catch (error) {
      if (isReadCurrent(op)) {
        setPreferencesError(toUiError(error));
        setPreferencesLoading(false);
      }
    }
  }, [beginReadOp, isReadCurrent]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    if (panel === "preferences") void loadPreferences();
  }, [panel, loadPreferences]);

  const setPreferenceField = useCallback(
    <K extends keyof EditorPreferences>(
      key: K,
      value: EditorPreferences[K],
    ) => {
      setPreferences((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  const persistPreferenceField = useCallback(
    async <K extends keyof EditorPreferences>(
      key: K,
      value: EditorPreferences[K],
    ) => {
      const op = ++prefOpRef.current;
      let current = preferencesRef.current;
      let base = preferencesBaseRef.current;
      if (!current || !base) {
        try {
          const result = await invokeEngine("editor.preferences.get", {});
          if (op !== prefOpRef.current) return;
          current = { ...result, shortcuts: { ...result.shortcuts } };
          base = result;
          setPreferencesBase(result);
          setPreferences(current);
        } catch (error) {
          if (op === prefOpRef.current) {
            setPreferencesError(toUiError(error));
          }
          return;
        }
      }
      const complete: EditorPreferences = {
        ...base,
        ...current,
        [key]: value,
        shortcuts: {
          ...base.shortcuts,
          ...current.shortcuts,
        },
      };
      setPreferences((prev) =>
        prev ? { ...prev, [key]: value } : { ...complete },
      );
      try {
        const result = await invokeEngine("editor.preferences.update", {
          preferences: complete,
        });
        if (op !== prefOpRef.current) return;
        setPreferencesBase(result);
        setPreferences({ ...result, shortcuts: { ...result.shortcuts } });
        setPreferencesError(null);
      } catch (error) {
        if (op === prefOpRef.current) {
          setPreferencesError(toUiError(error));
          setPreferences(current);
        }
      }
    },
    [],
  );

  const savePreferences = useCallback(async () => {
    if (!preferences || !preferencesBase) return;
    const op = beginOp();
    setPreferencesPending(true);
    setPreferencesError(null);
    try {
      // Send complete object; preserve unedited fields from base.
      const complete: EditorPreferences = {
        ...preferencesBase,
        ...preferences,
        shortcuts: {
          ...preferencesBase.shortcuts,
          ...preferences.shortcuts,
        },
      };
      const result = await invokeEngine("editor.preferences.update", {
        preferences: complete,
      });
      if (!isOpCurrent(op)) return;
      setPreferencesBase(result);
      setPreferences({ ...result, shortcuts: { ...result.shortcuts } });
      setPreferencesPending(false);
    } catch (error) {
      if (isOpCurrent(op)) {
        setPreferencesError(toUiError(error));
        setPreferencesPending(false);
      }
    }
  }, [beginOp, isOpCurrent, preferences, preferencesBase]);

  const loadReviewQueue = useCallback(
    async (offset = 0) => {
      const g = gatewayRef.current;
      if (!g.ctx) return;
      const op = beginOp();
      setReviewLoading(true);
      setReviewError(null);
      try {
        const result = await invokeEngine("review.queue", {
          projectId: g.ctx.project.id,
          documentId: g.ctx.document.id,
          status: "pending",
          offset,
          limit: REVIEW_LIMIT,
        });
        if (!isOpCurrent(op)) return;
        if (gatewayRef.current.ctx?.document.id !== g.ctx.document.id) return;
        setReviewItems(result.items);
        setReviewTotal(result.total);
        setReviewOffset(result.offset);
        setReviewLoading(false);
      } catch (error) {
        if (isOpCurrent(op)) {
          setReviewError(toUiError(error));
          setReviewLoading(false);
        }
      }
    },
    [beginOp, isOpCurrent],
  );

  useEffect(() => {
    if (panel === "review") void loadReviewQueue(0);
  }, [panel, gateway.ctx?.document.id, loadReviewQueue]);

  const acceptReview = useCallback(
    async (item: ReviewQueueItem) => {
      const g = gatewayRef.current;
      if (!g.mutationsEnabled || reviewPendingId) return;
      if (g.saveCoordinator.active?.isComposing) return;
      const op = beginOp();
      setReviewPendingId(item.revision.id);
      setReviewError(null);
      try {
        if (g.saveCoordinator.isDirty()) {
          const ok = await g.flushOrStay();
          if (!ok) {
            if (isOpCurrent(op)) setReviewPendingId(null);
            return;
          }
        }
        if (!isOpCurrent(op)) return;
        const result = await invokeEngine("review.accept", {
          reviewId: item.revision.id,
          expectedSegmentRevision: item.revision.baseRevision,
        });
        if (!isOpCurrent(op)) return;
        await commitMutation(result, "replace");
        if (isOpCurrent(op)) {
          setReviewPendingId(null);
          await loadReviewQueue(reviewOffset);
        }
      } catch (error) {
        if (isOpCurrent(op)) {
          setReviewError(toUiError(error));
          setReviewPendingId(null);
        }
      }
    },
    [
      beginOp,
      commitMutation,
      isOpCurrent,
      loadReviewQueue,
      reviewOffset,
      reviewPendingId,
    ],
  );

  const rejectReview = useCallback(
    async (item: ReviewQueueItem) => {
      if (reviewPendingId) return;
      const op = beginOp();
      setReviewPendingId(item.revision.id);
      setReviewError(null);
      try {
        await invokeEngine("review.reject", {
          reviewId: item.revision.id,
          expectedSegmentRevision: item.revision.baseRevision,
        });
        if (!isOpCurrent(op)) return;
        setReviewPendingId(null);
        await loadReviewQueue(reviewOffset);
      } catch (error) {
        if (isOpCurrent(op)) {
          setReviewError(toUiError(error));
          setReviewPendingId(null);
        }
      }
    },
    [beginOp, isOpCurrent, loadReviewQueue, reviewOffset, reviewPendingId],
  );

  return {
    panel,
    openPanel,
    closePanel,
    busy,
    commandError,
    clearCommandError: () => setCommandError(null),
    canUndo,
    canRedo,
    isAvailable,
    runCommand,
    findReplace,
    setFindQuery,
    setReplacement,
    setFindField,
    setFindOptions,
    runFind,
    runPreview,
    applyReplace,
    selectFindMatch,
    targetTagsDraft,
    setTargetTagsDraft,
    submitTags,
    confirmPropagate,
    structureMode,
    splitSourceOffset,
    splitTargetOffset,
    setSplitOffsets: (source, target) => {
      setSplitSourceOffset(source);
      setSplitTargetOffset(target);
    },
    confirmStructure,
    sourceDraft,
    sourceReason,
    setSourceDraft,
    setSourceReason,
    confirmSourceCorrection,
    comments,
    commentsLoading,
    commentsError,
    commentText,
    setCommentText,
    editingCommentId,
    editingCommentText,
    setEditingComment: (commentId, text) => {
      setEditingCommentId(commentId);
      setEditingCommentText(text ?? "");
    },
    loadComments,
    createComment,
    updateComment,
    resolveComment,
    deleteComment,
    spellResult,
    spellSide,
    setSpellSide,
    runSpellCheck,
    dictionaryWords,
    dictionaryLoading,
    dictionaryError,
    dictionaryWord,
    setDictionaryWord,
    loadDictionary,
    addDictionaryWord,
    removeDictionaryWord,
    convertChinese,
    chineseProfiles: CHINESE_PROFILES,
    history,
    historyLoading,
    historyError,
    loadHistory,
    undo,
    redo,
    preferences,
    preferencesBase,
    preferencesLoading,
    preferencesError,
    preferencesPending,
    setPreferenceField,
    persistPreferenceField,
    loadPreferences,
    savePreferences,
    reviewItems,
    reviewTotal,
    reviewOffset,
    reviewLimit: REVIEW_LIMIT,
    reviewLoading,
    reviewError,
    reviewPendingId,
    loadReviewQueue,
    acceptReview,
    rejectReview,
    invalidate,
  };
}
