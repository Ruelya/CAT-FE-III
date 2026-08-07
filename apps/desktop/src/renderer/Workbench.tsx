import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type CompositionEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import type {
  ChineseConversionProfile,
  ConcordanceHit,
  CorpusSearchHit,
  Document,
  EditorComment,
  EditorMutationResult,
  EditorPreferences,
  EditorWorkflowState,
  GlobalSearchHit,
  InlineTag,
  ProjectSnapshot,
  QaIssue,
  ReplacePreviewResult,
  ReviewRevision,
  Segment,
  SegmentCounts,
  SegmentEditorRow,
  SpellFinding,
  TermMatch,
  TmEntry,
} from "@translunar/contracts";
import {
  Command,
  GitCompareArrows,
  Send,
  X,
} from "lucide-react";

import { formatCorpusProvenance } from "./alignment-corpus-utils";
import {
  ConsistencyRepairDrawer,
  type ConsistencyApplyResult,
} from "./components/ai/ConsistencyRepairDrawer";
import { ConsistencyRepairToast } from "./components/ai/ConsistencyRepairToast";
import {
  scanDivergentTargets,
  type DivergentTargetHit,
} from "./components/ai/consistency-presenters";
import { ActiveAxis } from "./components/workbench/ActiveAxis";
import {
  DocumentMatrix,
  type MatrixSegmentState,
  type SegmentState as MatrixSegmentStateValue,
} from "./components/workbench/DocumentMatrix";
import {
  FilterRail,
  type MatchBucket,
  type RailStatusFilter,
} from "./components/workbench/FilterRail";
import { Masthead } from "./components/workbench/Masthead";
import { PreviewDock } from "./components/workbench/PreviewDock/PreviewDock";
import { SegmentGrid } from "./components/workbench/SegmentGrid";
import { SelectionAiMenu } from "./components/workbench/SelectionAiMenu";
import { StackPanel } from "./components/workbench/Stack/StackPanel";
import {
  deriveLampState,
  mapFindings,
  mapSourceTags,
  mapTargetTags,
  type BatchActionId,
  type SegmentGridLabels,
  type SegmentRowView,
} from "./components/workbench/segmentTypes";
import { isComposing as isGlobalComposing } from "./hooks/useComposition";
import { clearSegmentDrafts, writeSegmentDraft } from "./draft-persist";
import { GlobalSearchPanel } from "./GlobalSearchPanel";
import { PluginWorkbenchPanels } from "./PluginWorkbenchPanels";
import {
  EDITOR_COMMANDS,
  acceleratorLabel,
  commandById,
  dispatchEditorCommand,
  isEditorCommandEnabled,
  shortcutMatches,
  validateShortcutBindings,
  type EditorCommandContext,
  type EditorCommandHandlers,
  type EditorCommandId,
  type EditorCommandInvocation,
} from "./editor-commands";
import { useLocale } from "./i18n/LocaleProvider";
import type { MessageKey } from "./i18n/messages";
import {
  clampPreviewHeight,
  fileName,
  formatError,
  isConfirmShortcut,
  nextVisibleSegmentId,
  PREVIEW_DEFAULT_HEIGHT,
  replaceSegment,
  restorePaletteOwnerFocus,
  togglePanelCollapsed,
  type PanelMode,
} from "./workbench-utils";

const WORKBENCH_PREFERENCES_KEY = "translunar.workbench-preferences.v1";
const EDITOR_WINDOW_SIZE = 100;
const EDITOR_ROW_HEIGHT = 112;
const EDITOR_OVERSCAN = 18;
const GLOBAL_SEARCH_SHORTCUT = "Ctrl+Shift+K";

const CHINESE_CONVERSION_OPTIONS: readonly {
  value: ChineseConversionProfile;
  labelKey: MessageKey;
}[] = [
  {
    value: "simplifiedToTraditional",
    labelKey: "workbench.chinese.s2t",
  },
  {
    value: "simplifiedToTaiwan",
    labelKey: "workbench.chinese.s2tw",
  },
  {
    value: "simplifiedToHongKong",
    labelKey: "workbench.chinese.s2hk",
  },
  {
    value: "traditionalToSimplified",
    labelKey: "workbench.chinese.t2s",
  },
  {
    value: "taiwanToSimplified",
    labelKey: "workbench.chinese.tw2s",
  },
  {
    value: "hongKongToSimplified",
    labelKey: "workbench.chinese.hk2s",
  },
];

interface InitialWorkspace {
  snapshot: ProjectSnapshot;
  document: Document;
  segments: Segment[];
  editorRows: SegmentEditorRow[];
  issues: QaIssue[];
}

interface WorkbenchProps {
  initialWorkspace: InitialWorkspace;
  onOpenGlobalSearchHit(hit: GlobalSearchHit): Promise<void>;
  /**
   * Open another workspace document after the caller has persisted drafts.
   * Wired from App through the existing loadWorkspace path.
   */
  onOpenDocument?(documentId: string): Promise<void>;
  focusSegmentId: string | null;
  /* onReturnHome / onNavigate / onOpenSettings 已移除：
     返回项目列表、Surface 切换、设置全部由 Shell 的 Index Spine 承载。 */
  /**
   * 把编辑过程中的实时计数/保存态上报给 Shell 的 Instrument Strip。
   * 没有它，仪表条只能显示打开文档时的快照值，编辑后立刻失真。
   */
  onStatusChange?(status: {
    counts: SegmentCounts;
    saveState: SaveState;
    activeOrdinal: number | undefined;
  }): void;
  /**
   * 注册"离开工作台前先落盘"的守卫。
   *
   * 旧的 `…` 导航与返回按钮在跳转前都会 `await persistAllSegments()`；
   * 导航移到 Shell（Ctrl+1..6 / Index Spine）后，这个保证必须显式交给 Shell，
   * 否则切 Surface 会丢未保存草稿。
   * 契约见 `06-shell-navigation.md §5.1`：有未保存草稿 → 静默持久化，不拦截。
   */
  onRegisterLeaveGuard?(guard: (() => Promise<void>) | null): void;
}

interface AutocompleteCompletion {
  targetText: string;
  tail: string;
  provider: "TM" | "Termbase";
}

type SegmentFilter =
  | "all"
  | "untranslated"
  | "draft"
  | "confirmed"
  | "issues"
  | "tagged"
  | "commented";
type SaveState = "saved" | "saving" | "error";

interface WorkbenchPreferences {
  suggestionsMode: PanelMode;
  previewMode: PanelMode;
  previewHeight: number;
  followActivePreview: boolean;
}

export function Workbench({
  initialWorkspace,
  onOpenGlobalSearchHit,
  onOpenDocument,
  focusSegmentId,
  onStatusChange,
  onRegisterLeaveGuard,
}: WorkbenchProps) {
  const { t } = useLocale();

  const { snapshot, document } = initialWorkspace;
  const initialPreferences = useMemo(readWorkbenchPreferences, []);
  const [editorRows, setEditorRows] = useState(initialWorkspace.editorRows);
  const editorRowsRef = useRef(editorRows);
  const [editorTotal, setEditorTotal] = useState(snapshot.counts.total);
  const [editorOffset, setEditorOffset] = useState(0);
  const [editorLoading, setEditorLoading] = useState(false);
  const [segments, setSegments] = useState(initialWorkspace.segments);
  const segmentsRef = useRef(segments);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      segments.map((segment) => [segment.id, segment.targetText]),
    ),
  );
  const draftsRef = useRef(drafts);
  const [counts, setCounts] = useState<SegmentCounts>(snapshot.counts);
  const [issues, setIssues] = useState(initialWorkspace.issues);
  const [matches, setMatches] = useState<TmEntry[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [termMatches, setTermMatches] = useState<TermMatch[]>([]);
  const [termLoading, setTermLoading] = useState(false);
  const [termSettled, setTermSettled] = useState(false);
  const [termError, setTermError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SegmentFilter>("all");
  /** Phase 2 match selector: presentation-only; only `all` is live. */
  const [matchBucket, setMatchBucket] = useState<MatchBucket>("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState(segments[0]?.id ?? "");
  const [viewportRange, setViewportRange] = useState<readonly [number, number]>(
    [0, 12],
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [suggestionsMode, setSuggestionsMode] = useState<PanelMode>(
    initialPreferences.suggestionsMode === "maximized"
      ? "docked"
      : initialPreferences.suggestionsMode,
  );
  const [previewMode, setPreviewMode] = useState<PanelMode>(
    initialPreferences.previewMode,
  );
  const [previewHeight, setPreviewHeight] = useState(
    initialPreferences.previewHeight,
  );
  const [followActivePreview, setFollowActivePreview] = useState(
    initialPreferences.followActivePreview,
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [actionBusy, setActionBusy] = useState<
    "qa" | "export" | "confirm" | "navigate" | null
  >(null);
  const [toast, setToast] = useState<string | null>(null);
  const [aiSettingsEnabled, setAiSettingsEnabled] = useState(false);
  const [consistencyToast, setConsistencyToast] = useState<{
    term: string;
    count: number;
  } | null>(null);
  const [consistencyDrawerOpen, setConsistencyDrawerOpen] = useState(false);
  const [consistencyHits, setConsistencyHits] = useState<DivergentTargetHit[]>(
    [],
  );
  const [consistencyCapped, setConsistencyCapped] = useState(false);
  const [consistencyTerm, setConsistencyTerm] = useState("");
  const [consistencyApplying, setConsistencyApplying] = useState(false);
  const [consistencyResults, setConsistencyResults] = useState<
    ConsistencyApplyResult[]
  >([]);
  const consistencyCancelRef = useRef(false);

  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  /** Element that had focus when the palette opened (restore target). */
  const commandPaletteOwnerRef = useRef<HTMLElement | null>(null);
  /** Matrix seek waiting for filter/search clear → list reload. */
  const pendingMatrixOrdinalRef = useRef<number | null>(null);
  const documentTotalRef = useRef(snapshot.counts.total);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [shortcutDrafts, setShortcutDrafts] = useState<Record<string, string>>(
    {},
  );
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [findField, setFindField] = useState<"source" | "target" | "both">(
    "target",
  );
  const [findRegex, setFindRegex] = useState(false);
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [replacePreview, setReplacePreview] =
    useState<ReplacePreviewResult | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditText, setCommentEditText] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [directSignoffOpen, setDirectSignoffOpen] = useState(false);
  const [directSignoffActor, setDirectSignoffActor] = useState("");
  const [directSignoffReason, setDirectSignoffReason] = useState("");
  const [reviewTarget, setReviewTarget] = useState("");
  const [reviewSource, setReviewSource] = useState("");
  const [reviewCopyTags, setReviewCopyTags] = useState(false);
  const [reviews, setReviews] = useState<ReviewRevision[]>([]);
  const [sourceCorrectionOpen, setSourceCorrectionOpen] = useState(false);
  const [sourceCorrectionText, setSourceCorrectionText] = useState("");
  const [sourceCorrectionReason, setSourceCorrectionReason] = useState("");
  const [chineseConversionOpen, setChineseConversionOpen] = useState(false);
  const [chineseConversionProfile, setChineseConversionProfile] =
    useState<ChineseConversionProfile>("simplifiedToTaiwan");
  const [concordanceOpen, setConcordanceOpen] = useState(false);
  const [concordanceQuery, setConcordanceQuery] = useState("");
  const [concordanceSide, setConcordanceSide] = useState<
    "source" | "target" | "both"
  >("both");
  const [concordanceHits, setConcordanceHits] = useState<ConcordanceHit[]>([]);
  const [concordanceTotal, setConcordanceTotal] = useState(0);
  const [concordanceCorpusHits, setConcordanceCorpusHits] = useState<
    CorpusSearchHit[]
  >([]);
  const [concordanceCorpusTotal, setConcordanceCorpusTotal] = useState(0);
  const [concordanceBusy, setConcordanceBusy] = useState(false);
  const [selectedTargetTagId, setSelectedTargetTagId] = useState<string | null>(
    null,
  );
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );
  /** Full filter-scope IDs (list order) when expanded for select-all / range. */
  const [filterScopeIds, setFilterScopeIds] = useState<string[] | null>(null);
  const filterScopeIdsRef = useRef<{ key: string; ids: string[] } | null>(
    null,
  );
  /** Measured average row height for Matrix / window scroll index. */
  const [editorRowStride, setEditorRowStride] = useState(EDITOR_ROW_HEIGHT);
  const editorRowStrideRef = useRef(EDITOR_ROW_HEIGHT);
  const [spellFindings, setSpellFindings] = useState<SpellFinding[]>([]);
  const [spellProvider, setSpellProvider] = useState("unavailable");
  const [flashSegmentId, setFlashSegmentId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<EditorPreferences>(() => ({
    theme: "system",
    zoom: 100,
    showNonprinting: false,
    autocomplete: true,
    cjkSpacing: true,
    punctuationAssistance: true,
    shortcuts: {},
  }));
  const timersRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Map<string, Promise<Segment>>());
  const journalWriteSequenceRef = useRef(new Map<string, number>());
  const composingRef = useRef(new Set<string>());
  const pendingSavesRef = useRef(0);
  const editorGridRef = useRef<HTMLDivElement>(null);
  const editorRegionRef = useRef<HTMLElement>(null);
  const editorOffsetRef = useRef(0);
  const editorTotalRef = useRef(editorTotal);
  const [toolbarCompact, setToolbarCompact] = useState(false);
  const editorWindowRequestRef = useRef(0);
  const tmRequestRef = useRef(0);
  const termRequestRef = useRef(0);
  /** Bumped when authoritative workspace props are replaced (reconnect). */
  const workspaceGenerationRef = useRef(0);
  const editorFilterInitializedRef = useRef(false);

  const applyCorrectedSource = (corrected: Segment) => {
    setSegments((current) => {
      const next = replaceSegment(current, corrected);
      segmentsRef.current = next;
      return next;
    });
    setEditorRows((current) =>
      current.map((row) =>
        row.segment.id === corrected.id ? { ...row, segment: corrected } : row,
      ),
    );
  };

  const openIssueBySegment = useMemo(
    () =>
      new Map(
        issues
          .filter((issue) => issue.status === "open")
          .map((issue) => [issue.segmentId, issue]),
      ),
    [issues],
  );
  const visibleSegments = useMemo(
    () => editorRows.map((row) => row.segment),
    [editorRows],
  );
  const activeSegment =
    segments.find((segment) => segment.id === activeId) ?? segments[0];
  const activeEditorRow = editorRows.find(
    (row) => row.segment.id === activeSegment?.id,
  );
  // 上报实时状态给 Shell 的 Instrument Strip（ordinal 是 0-based，展示要 +1）
  const activeOrdinal =
    activeSegment === undefined ? undefined : activeSegment.ordinal + 1;
  useEffect(() => {
    onStatusChange?.({ counts, saveState, activeOrdinal });
  }, [onStatusChange, counts, saveState, activeOrdinal]);
  const openIssueIds = useMemo(
    () =>
      segments
        .filter((segment) => openIssueBySegment.has(segment.id))
        .map((segment) => segment.id),
    [openIssueBySegment, segments],
  );

  /**
   * Document Matrix projection in **authoritative ordinal space**.
   * Length = document segment total (`counts.total`); loaded rows project to
   * `segment.ordinal`. Unknown/unloaded slots stay null — never invent status.
   */
  const matrixSegmentStates = useMemo((): MatrixSegmentState[] => {
    const total = Math.max(0, counts.total);
    if (total === 0) return [];
    const states: MatrixSegmentState[] = Array.from(
      { length: total },
      () => null,
    );
    editorRows.forEach((row) => {
      const slot = row.segment.ordinal;
      if (slot < 0 || slot >= total) return;
      const hasIssue = openIssueBySegment.has(row.segment.id);
      states[slot] = hasIssue
        ? "error"
        : (row.segment.state as MatrixSegmentStateValue);
    });
    return states;
  }, [counts.total, editorRows, openIssueBySegment]);

  const matrixActiveIndex = useMemo(() => {
    if (!activeSegment) return -1;
    return activeSegment.ordinal;
  }, [activeSegment]);

  const matrixLabels = useMemo(
    () => ({
      landmark: t("workbench.matrixLandmark"),
      title: t("workbench.matrixTitle"),
      legendUntranslated: t("workbench.matrixLegendUntranslated"),
      legendDraft: t("workbench.matrixLegendDraft"),
      legendConfirmed: t("workbench.matrixLegendConfirmed"),
      legendError: t("workbench.matrixLegendError"),
      legendNeutral: t("workbench.matrixLegendNeutral"),
      stateUntranslated: t("workbench.matrixStateUntranslated"),
      stateDraft: t("workbench.matrixStateDraft"),
      stateConfirmed: t("workbench.matrixStateConfirmed"),
      stateError: t("workbench.matrixStateError"),
      stateNeutral: t("workbench.matrixStateNeutral"),
      formatRange: (from: number, to: number) =>
        from === to
          ? t("workbench.matrixRangeSingle", { n: from })
          : t("workbench.matrixRangeMulti", { from, to }),
    }),
    [t],
  );

  /** Active Axis: row wins when a segment is active; otherwise the chip. */
  const axisResidence: "row" | "chip" | "hidden" = activeId
    ? "row"
    : filter
      ? "chip"
      : "hidden";

  /**
   * Map the grid scroll owner’s list-space viewport into document ordinals
   * using loaded rows. Off-window regions keep a best-effort ordinal span.
   */
  const syncMatrixViewport = (grid: HTMLDivElement) => {
    const stride = Math.max(1, editorRowStrideRef.current);
    const listStart = Math.floor(grid.scrollTop / stride);
    const visible = Math.max(1, Math.ceil(grid.clientHeight / stride));
    const listEnd = listStart + visible;
    const rows = editorRowsRef.current;
    const offset = editorOffsetRef.current;

    let start: number;
    let end: number;
    if (rows.length === 0) {
      start = listStart;
      end = listEnd;
    } else {
      const localStart = listStart - offset;
      const localEnd = listEnd - offset;
      const clampLocal = (index: number) =>
        Math.max(0, Math.min(rows.length - 1, index));
      if (localEnd <= 0) {
        const firstOrd = rows[0]!.segment.ordinal;
        end = firstOrd;
        start = Math.max(0, firstOrd - visible);
      } else if (localStart >= rows.length) {
        const lastOrd = rows[rows.length - 1]!.segment.ordinal;
        start = lastOrd;
        end = lastOrd + visible;
      } else {
        start = rows[clampLocal(localStart)]!.segment.ordinal;
        end = rows[clampLocal(localEnd - 1)]!.segment.ordinal + 1;
      }
    }

    setViewportRange((current) =>
      current[0] === start && current[1] === end ? current : [start, end],
    );
  };

  useEffect(() => {
    const grid = editorGridRef.current;
    if (!grid) return;
    syncMatrixViewport(grid);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (editorGridRef.current) syncMatrixViewport(editorGridRef.current);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [editorOffset, editorTotal, editorRows.length, filter, search]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    editorRowsRef.current = editorRows;
  }, [editorRows]);

  useEffect(() => {
    editorOffsetRef.current = editorOffset;
  }, [editorOffset]);

  useEffect(() => {
    editorTotalRef.current = editorTotal;
  }, [editorTotal]);

  useEffect(() => {
    editorRowStrideRef.current = editorRowStride;
  }, [editorRowStride]);

  // Invalidate filter-scope ID cache when projection changes.
  useEffect(() => {
    filterScopeIdsRef.current = null;
    setFilterScopeIds(null);
  }, [document.id, filter, search, editorTotal]);

  useEffect(() => {
    documentTotalRef.current = counts.total;
  }, [counts.total]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    // `Workbench` stays mounted while the parent replaces its Engine-backed
    // workspace after reconnect. Reset every projection-derived state slice so
    // the editor cannot keep rendering rows, revisions, or issues from the
    // pre-crash session.
    // Clearing maps alone is not cancellation: in-flight promises must observe
    // a generation boundary before applying results.
    for (const timer of timersRef.current.values()) {
      window.clearTimeout(timer);
    }
    timersRef.current.clear();
    workspaceGenerationRef.current += 1;
    inFlightRef.current.clear();
    pendingSavesRef.current = 0;
    journalWriteSequenceRef.current.clear();
    composingRef.current.clear();
    // Invalidate any in-flight segment.editor.list request IDs.
    editorWindowRequestRef.current += 1;
    tmRequestRef.current += 1;
    termRequestRef.current += 1;
    const nextSegments = initialWorkspace.segments;
    const nextRows = initialWorkspace.editorRows;
    const nextDrafts = Object.fromEntries(
      nextSegments.map((segment) => [segment.id, segment.targetText]),
    );
    segmentsRef.current = nextSegments;
    editorRowsRef.current = nextRows;
    draftsRef.current = nextDrafts;
    setSegments(nextSegments);
    setEditorRows(nextRows);
    setDrafts(nextDrafts);
    setEditorLoading(false);
    setEditorOffset(0);
    setEditorTotal(snapshot.counts.total);
    setCounts(snapshot.counts);
    setIssues(initialWorkspace.issues);
    setMatches([]);
    setMatchesLoading(false);
    setMatchesError(null);
    setTermMatches([]);
    setTermLoading(false);
    setTermSettled(false);
    setTermError(null);
    setSpellFindings([]);
    setSpellProvider("unavailable");
    setSaveState("saved");
    setToast(null);
    setActionBusy(null);
    setFlashSegmentId(null);
    setSelectedTargetTagId(null);
    setSelectedSegmentIds(new Set());
    setSelectionAnchorId(null);
    setActiveId((current) =>
      nextSegments.some((segment) => segment.id === current)
        ? current
        : (nextSegments[0]?.id ?? ""),
    );
  }, [
    document.id,
    initialWorkspace.editorRows,
    initialWorkspace.issues,
    initialWorkspace.segments,
    snapshot.counts,
    snapshot.project.id,
    snapshot.project.revision,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(
        WORKBENCH_PREFERENCES_KEY,
        JSON.stringify({
          suggestionsMode,
          previewMode,
          previewHeight,
          followActivePreview,
        }),
      );
    } catch {
      // UI preferences are disposable and must never block translation work.
    }
  }, [followActivePreview, previewHeight, previewMode, suggestionsMode]);

  // Compact the editor toolbar when the plugin dock + suggestions leave a
  // narrow editor column (e.g. 1250×744 with editorSidebar open).
  useEffect(() => {
    const node = editorRegionRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setToolbarCompact(width > 0 && width < 720);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values())
        window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.translunar
      .invoke("ai.settings.get", {})
      .then((settings) => {
        if (!cancelled) setAiSettingsEnabled(Boolean(settings.enabled));
      })
      .catch(() => {
        if (!cancelled) setAiSettingsEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.project.id]);

  useEffect(() => {
    if (!activeSegment) {
      setSpellFindings([]);
      return;
    }
    const target = drafts[activeSegment.id] ?? activeSegment.targetText;
    if (!target.trim()) {
      setSpellFindings([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.translunar
        .invoke("segment.spell.check", {
          locale: snapshot.project.targetLocale,
          text: target,
          limit: 40,
        })
        .then((result) => {
          if (cancelled) return;
          setSpellFindings(result.findings);
          setSpellProvider(result.provider);
        })
        .catch((error: unknown) => {
          if (!cancelled) setToast(formatError(error));
        });
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSegment, drafts, snapshot.project.targetLocale]);

  useEffect(() => {
    const requestId = tmRequestRef.current + 1;
    tmRequestRef.current = requestId;
    if (!activeSegment) {
      setMatches([]);
      setMatchesLoading(false);
      setMatchesError(null);
      return;
    }
    let cancelled = false;
    setMatches([]);
    setMatchesError(null);
    setMatchesLoading(true);
    void window.translunar
      .invoke("tm.lookupExact", {
        projectId: snapshot.project.id,
        sourceText: activeSegment.sourceText,
      })
      .then((result) => {
        if (cancelled || tmRequestRef.current !== requestId) return;
        setMatches(result.matches);
        setMatchesError(null);
      })
      .catch((error: unknown) => {
        if (cancelled || tmRequestRef.current !== requestId) return;
        setMatches([]);
        setMatchesLoading(false);
        setMatchesError(formatError(error));
      })
      .finally(() => {
        if (cancelled || tmRequestRef.current !== requestId) return;
        setMatchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSegment, snapshot.project.id]);

  useEffect(() => {
    const requestId = termRequestRef.current + 1;
    termRequestRef.current = requestId;
    if (!activeSegment) {
      setTermMatches([]);
      setTermLoading(false);
      setTermSettled(false);
      setTermError(null);
      return;
    }
    let cancelled = false;
    setTermMatches([]);
    setTermLoading(true);
    setTermSettled(false);
    setTermError(null);
    void window.translunar
      .invoke("term.search", {
        projectId: snapshot.project.id,
        text: activeSegment.sourceText,
        offset: 0,
        limit: 50,
      })
      .then((result) => {
        if (cancelled || termRequestRef.current !== requestId) return;
        setTermMatches(result.matches);
        setTermError(null);
      })
      .catch((error: unknown) => {
        if (cancelled || termRequestRef.current !== requestId) return;
        setTermMatches([]);
        setTermLoading(false);
        setTermSettled(true);
        setTermError(formatError(error));
      })
      .finally(() => {
        if (cancelled || termRequestRef.current !== requestId) return;
        setTermLoading(false);
        setTermSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSegment, snapshot.project.id]);

  useEffect(() => {
    if (!focusSegmentId) return;
    const segment = segmentsRef.current.find(
      (item) => item.id === focusSegmentId,
    );
    if (!segment) return;
    setFilter("all");
    setActiveId(segment.id);
    window.requestAnimationFrame(() => {
      documentQuery<HTMLElement>(
        `[data-segment-row="${segment.id}"]`,
      )?.scrollIntoView({ block: "center" });
      documentQuery<HTMLTextAreaElement>(
        `[data-editor-for="${segment.id}"]`,
      )?.focus();
    });
  }, [focusSegmentId]);

  const persistDraftToJournal = (segmentId: string, targetText: string) => {
    const base =
      segmentsRef.current.find((segment) => segment.id === segmentId) ??
      editorRowsRef.current.find((row) => row.segment.id === segmentId)
        ?.segment;
    if (!base) return;

    const generation = workspaceGenerationRef.current;
    const sequence = (journalWriteSequenceRef.current.get(segmentId) ?? 0) + 1;
    journalWriteSequenceRef.current.set(segmentId, sequence);
    void writeSegmentDraft({
      projectId: snapshot.project.id,
      documentId: document.id,
      segmentId,
      expectedRevision: base.revision,
      targetText,
    }).catch(() => {
      // A journal failure must be visible, but must not discard the editor
      // value or turn an input event into an unhandled rejection. Ignore an
      // older failure when a newer keystroke has already been journaled.
      if (workspaceGenerationRef.current !== generation) return;
      if (journalWriteSequenceRef.current.get(segmentId) !== sequence) return;
      setSaveState("error");
      setToast(t("error.generic"));
    });
  };

  const updateDraft = (segmentId: string, targetText: string) => {
    const next = { ...draftsRef.current, [segmentId]: targetText };
    draftsRef.current = next;
    setDrafts(next);
    // Journal the edit at the input boundary, before the debounced Engine
    // mutation. This is the crash-before-debounce recovery contract.
    persistDraftToJournal(segmentId, targetText);
  };

  const applySegment = (segment: Segment) => {
    const next = replaceSegment(segmentsRef.current, segment);
    segmentsRef.current = next;
    setSegments(next);
    setEditorRows((current) => {
      const nextRows = current.map((row) =>
        row.segment.id === segment.id ? { ...row, segment } : row,
      );
      editorRowsRef.current = nextRows;
      return nextRows;
    });
  };

  const applyEditorMutation = (mutation: EditorMutationResult) => {
    if (mutation.rows.length > 0) {
      const mutationIds = new Set(mutation.rows.map((row) => row.segment.id));
      const replacesVisibleSubset =
        mutation.rows.length < editorRowsRef.current.length &&
        mutation.rows.every((row) =>
          editorRowsRef.current.some(
            (current) => current.segment.id === row.segment.id,
          ),
        );
      const nextRows = replacesVisibleSubset
        ? editorRowsRef.current.map((row) =>
            mutationIds.has(row.segment.id)
              ? (mutation.rows.find(
                  (updated) => updated.segment.id === row.segment.id,
                ) ?? row)
              : row,
          )
        : mutation.rows;
      editorRowsRef.current = nextRows;
      setEditorRows(nextRows);
      const nextSegments = nextRows.map((row) => row.segment);
      segmentsRef.current = nextSegments;
      setSegments(nextSegments);
      setEditorTotal(mutation.counts.total);
      setCounts(mutation.counts);
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(
          nextSegments.map((segment) => [segment.id, segment.targetText]),
        ),
      }));
    }
    if (mutation.focusSegmentId) setActiveId(mutation.focusSegmentId);
  };

  const refreshCounts = async () => {
    const generation = workspaceGenerationRef.current;
    const latest = await window.translunar.invoke("project.get", {
      projectId: snapshot.project.id,
    });
    if (workspaceGenerationRef.current !== generation) return;
    setCounts(latest.counts);
  };

  const persistSegment = async (segmentId: string): Promise<Segment> => {
    const generation = workspaceGenerationRef.current;
    const segmentAtStart = segmentsRef.current.find(
      (segment) => segment.id === segmentId,
    );
    const timer = timersRef.current.get(segmentId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(segmentId);
    }
    const existing = inFlightRef.current.get(segmentId);
    if (existing) {
      try {
        await existing;
      } catch (error) {
        // Preserve current-generation failure semantics: rethrow rejected
        // saves. Only a generation change may suppress the rejection.
        if (workspaceGenerationRef.current === generation) {
          throw error;
        }
      }
      if (workspaceGenerationRef.current !== generation) {
        // Stale existing wait: no throw / no unhandled rejection if the
        // segment is absent from the new projection.
        return (
          segmentsRef.current.find((segment) => segment.id === segmentId) ??
          segmentAtStart!
        );
      }
      return persistSegment(segmentId);
    }
    const base = segmentsRef.current.find(
      (segment) => segment.id === segmentId,
    );
    if (!base) throw new Error("The segment is no longer available.");
    if (workspaceGenerationRef.current !== generation) {
      return base;
    }
    const targetText = draftsRef.current[segmentId] ?? base.targetText;
    if (targetText === base.targetText) return base;

    pendingSavesRef.current += 1;
    setSaveState("saving");
    // Ensure the final text is queued after any earlier keystroke journal
    // writes and before the authoritative Engine mutation is sent.
    persistDraftToJournal(segmentId, targetText);
    const request = window.translunar.invoke("segment.updateTarget", {
      segmentId,
      targetText,
      expectedRevision: base.revision,
    });
    inFlightRef.current.set(segmentId, request);
    let saved: Segment;
    let succeeded = false;
    try {
      saved = await request;
      if (workspaceGenerationRef.current !== generation) {
        // Stale success: do not apply; return current authoritative segment.
        return (
          segmentsRef.current.find((segment) => segment.id === segmentId) ??
          base
        );
      }
      applySegment(saved);
      succeeded = true;
    } catch (error) {
      if (workspaceGenerationRef.current !== generation) {
        // Stale rejection: no toast/error state; avoid unhandled rejection
        // from `void persistSegment(...)`.
        return (
          segmentsRef.current.find((segment) => segment.id === segmentId) ??
          base
        );
      }
      setSaveState("error");
      setToast(formatError(error));
      throw error;
    } finally {
      // Identity check: an older promise must not delete a newer same-segment
      // request registered after a reconnect generation bump.
      if (inFlightRef.current.get(segmentId) === request) {
        inFlightRef.current.delete(segmentId);
      }
      if (workspaceGenerationRef.current === generation) {
        pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
        if (pendingSavesRef.current === 0 && succeeded) setSaveState("saved");
      }
    }

    const hasNewerDraft =
      (draftsRef.current[segmentId] ?? saved.targetText) !== saved.targetText;
    if (hasNewerDraft) {
      // Do not clear the journal for an acknowledged value while a newer
      // keystroke is pending; the recursive save will replace it safely.
      return persistSegment(segmentId);
    }
    // Clear only after the Engine acknowledged the same text and no newer
    // renderer value exists. A failed clear intentionally leaves a recovery
    // record rather than risking silent data loss.
    await clearSegmentDrafts([segmentId]).catch(() => undefined);
    if (workspaceGenerationRef.current !== generation) {
      return (
        segmentsRef.current.find((segment) => segment.id === segmentId) ?? base
      );
    }
    await refreshCounts();
    return saved;
  };

  const scheduleSave = (segmentId: string, delay = 650) => {
    const current = timersRef.current.get(segmentId);
    if (current !== undefined) window.clearTimeout(current);
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      timersRef.current.delete(segmentId);
      void persistSegment(segmentId);
    }, delay);
    timersRef.current.set(segmentId, timer);
  };

  const persistAllSegments = async () => {
    const segmentIds = segmentsRef.current.map((segment) => segment.id);
    for (const segmentId of segmentIds) await persistSegment(segmentId);
  };

  // 保持最新的落盘实现，供 Shell 在跳转前调用（避免闭包捕获旧引用）
  const persistAllRef = useRef(persistAllSegments);
  persistAllRef.current = persistAllSegments;

  useEffect(() => {
    if (!onRegisterLeaveGuard) return;
    onRegisterLeaveGuard(() => persistAllRef.current());
    return () => onRegisterLeaveGuard(null);
  }, [onRegisterLeaveGuard]);

  const loadEditorWindow = async (offset: number) => {
    const generation = workspaceGenerationRef.current;
    const requestId = editorWindowRequestRef.current + 1;
    editorWindowRequestRef.current = requestId;
    setEditorLoading(true);
    try {
      await persistAllSegments();
      if (workspaceGenerationRef.current !== generation) return;
      const result = await window.translunar.invoke("segment.editor.list", {
        documentId: document.id,
        query: search,
        field: "both",
        filter,
        sort: "ordinal",
        descending: false,
        offset: Math.max(0, offset),
        limit: EDITOR_WINDOW_SIZE,
        includeContext: true,
      });
      if (
        workspaceGenerationRef.current !== generation ||
        editorWindowRequestRef.current !== requestId
      ) {
        return;
      }
      editorRowsRef.current = result.items;
      setEditorRows(result.items);
      editorOffsetRef.current = result.offset;
      setEditorOffset(result.offset);
      setEditorTotal(result.total);
      const nextSegments = result.items.map((row) => row.segment);
      segmentsRef.current = nextSegments;
      setSegments(nextSegments);
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(
          nextSegments.map((segment) => [segment.id, segment.targetText]),
        ),
      }));
      if (!nextSegments.some((segment) => segment.id === activeId)) {
        setActiveId(nextSegments[0]?.id ?? "");
      }
      return nextSegments;
    } catch (error) {
      if (
        workspaceGenerationRef.current === generation &&
        editorWindowRequestRef.current === requestId
      ) {
        setToast(formatError(error));
      }
      return null;
    } finally {
      if (
        workspaceGenerationRef.current === generation &&
        editorWindowRequestRef.current === requestId
      ) {
        setEditorLoading(false);
      }
    }
  };

  const navigateToPreviewSegment = async (
    segmentId: string,
    ordinal: number,
  ) => {
    const current = segmentsRef.current.find(
      (segment) => segment.id === segmentId,
    );
    if (current) {
      focusSegment(current.id);
      return;
    }
    const offset = Math.max(
      0,
      Math.floor(Math.max(0, ordinal) / EDITOR_WINDOW_SIZE) *
        EDITOR_WINDOW_SIZE,
    );
    const loaded = await loadEditorWindow(offset);
    const target =
      loaded?.find((segment) => segment.id === segmentId) ??
      loaded?.find((segment) => segment.ordinal === ordinal);
    if (target) focusSegment(target.id);
  };

  const onEditorScroll = (event: UIEvent<HTMLDivElement>) => {
    syncMatrixViewport(event.currentTarget);
    if (editorTotal <= EDITOR_WINDOW_SIZE) return;
    const stride = Math.max(1, editorRowStrideRef.current);
    const firstVisible = Math.floor(event.currentTarget.scrollTop / stride);
    const requested = Math.max(
      0,
      Math.min(
        editorTotal - EDITOR_WINDOW_SIZE,
        firstVisible - EDITOR_OVERSCAN,
      ),
    );
    if (Math.abs(requested - editorOffset) >= EDITOR_OVERSCAN) {
      void loadEditorWindow(requested);
    }
  };

  useEffect(() => {
    if (!editorFilterInitializedRef.current) {
      editorFilterInitializedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      const pendingOrdinal = pendingMatrixOrdinalRef.current;
      pendingMatrixOrdinalRef.current = null;
      if (pendingOrdinal != null) {
        const documentTotal = documentTotalRef.current;
        const requested = Math.max(
          0,
          Math.min(
            Math.max(0, documentTotal - EDITOR_WINDOW_SIZE),
            pendingOrdinal - EDITOR_OVERSCAN,
          ),
        );
        void loadEditorWindow(requested).then((loaded) => {
          activateMatrixSegment(loaded, pendingOrdinal);
        });
        return;
      }
      if (editorGridRef.current) editorGridRef.current.scrollTop = 0;
      void loadEditorWindow(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [filter, search]);

  useEffect(() => {
    let cancelled = false;
    void window.translunar
      .invoke("editor.preferences.get", {})
      .then((value) => {
        if (!cancelled) setPreferences(value);
      })
      .catch((error: unknown) => {
        if (!cancelled) setToast(formatError(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshOpenIssues = async () => {
    const result = await window.translunar.invoke("qa.list", {
      documentId: document.id,
      includeResolved: false,
    });
    setIssues(result.issues);
  };

  const refreshMatches = async (segment: Segment) => {
    const requestId = tmRequestRef.current + 1;
    tmRequestRef.current = requestId;
    setMatches([]);
    setMatchesError(null);
    setMatchesLoading(true);
    try {
      const result = await window.translunar.invoke("tm.lookupExact", {
        projectId: snapshot.project.id,
        sourceText: segment.sourceText,
      });
      if (tmRequestRef.current !== requestId) return;
      setMatches(result.matches);
    } catch (error) {
      if (tmRequestRef.current === requestId) {
        setMatches([]);
        setMatchesLoading(false);
        setMatchesError(formatError(error));
      }
      throw error;
    } finally {
      if (tmRequestRef.current === requestId) setMatchesLoading(false);
    }
  };

  const flashConfirmedSegment = (segmentId: string) => {
    const timerKey = `confirm-flash:${segmentId}`;
    const pending = timersRef.current.get(timerKey);
    if (pending !== undefined) window.clearTimeout(pending);
    setFlashSegmentId(segmentId);
    timersRef.current.set(
      timerKey,
      window.setTimeout(() => {
        timersRef.current.delete(timerKey);
        setFlashSegmentId((current) =>
          current === segmentId ? null : current,
        );
      }, 500),
    );
  };

  const confirmSegment = async (segmentId: string) => {
    if (composingRef.current.has(segmentId)) return;
    const visibleIds = visibleSegments.map((segment) => segment.id);
    const nextId = nextVisibleSegmentId(visibleIds, segmentId);
    setActionBusy("confirm");
    setToast(null);
    try {
      const saved = await persistSegment(segmentId);
      const result = await window.translunar.invoke("segment.confirm", {
        segmentId,
        expectedRevision: saved.revision,
      });
      applySegment(result.segment);
      updateDraft(result.segment.id, result.segment.targetText);
      for (const propagated of result.propagated ?? []) {
        applySegment(propagated);
        updateDraft(propagated.id, propagated.targetText);
      }
      setCounts(result.counts);
      flashConfirmedSegment(segmentId);
      await Promise.all([refreshOpenIssues(), refreshMatches(result.segment)]);
      void loadEditorWindow(editorOffset);
      if (nextId) {
        setActiveId(nextId);
        window.requestAnimationFrame(() => {
          documentQuery<HTMLTextAreaElement>(
            `[data-editor-for="${nextId}"]`,
          )?.focus();
        });
      }
    } catch (error) {
      setToast(formatError(error));
    } finally {
      setActionBusy(null);
    }
  };

  const autocompleteForSegment = (
    segmentId: string,
  ): AutocompleteCompletion | null => {
    if (
      !preferences.autocomplete ||
      activeSegment?.id !== segmentId ||
      activeEditorRow?.workflowState === "signed" ||
      composingRef.current.has(segmentId)
    ) {
      return null;
    }
    const draft = draftsRef.current[segmentId] ?? "";
    if (!draft) return null;
    const tmTarget = matches
      .map((match) => match.targetText)
      .find(
        (target) => target.length > draft.length && target.startsWith(draft),
      );
    if (tmTarget) {
      return {
        targetText: tmTarget,
        tail: tmTarget.slice(draft.length),
        provider: "TM",
      };
    }
    const suffix = /([\p{L}\p{N}]{1,32})$/u.exec(draft)?.[1];
    if (!suffix) return null;
    const termTarget = termMatches
      .flatMap((match) =>
        [...match.translations].sort(
          (left, right) => Number(right.preferred) - Number(left.preferred),
        ),
      )
      .filter((translation) => !translation.forbidden)
      .map((translation) => translation.term)
      .find((term) => term.length > suffix.length && term.startsWith(suffix));
    if (!termTarget) return null;
    const targetText = `${draft.slice(0, -suffix.length)}${termTarget}`;
    return {
      targetText,
      tail: targetText.slice(draft.length),
      provider: "Termbase",
    };
  };

  const onTargetKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    segmentId: string,
  ) => {
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229 &&
      !composingRef.current.has(segmentId)
    ) {
      const completion = autocompleteForSegment(segmentId);
      if (completion) {
        event.preventDefault();
        updateDraft(segmentId, completion.targetText);
        scheduleSave(segmentId, 80);
        return;
      }
    }
    if (
      !isConfirmShortcut(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          isComposing: event.nativeEvent.isComposing,
          keyCode: event.keyCode,
        },
        composingRef.current.has(segmentId),
      )
    ) {
      return;
    }
    event.preventDefault();
    void confirmSegment(segmentId);
  };

  const onCompositionStart = (segmentId: string) => {
    composingRef.current.add(segmentId);
  };

  const onCompositionEnd = (
    event: CompositionEvent<HTMLTextAreaElement>,
    segmentId: string,
  ) => {
    composingRef.current.delete(segmentId);
    updateDraft(segmentId, event.currentTarget.value);
    scheduleSave(segmentId, 80);
  };

  const runQa = async () => {
    setActionBusy("qa");
    setToast(null);
    try {
      await persistAllSegments();
      await window.translunar.invoke("qa.runDocument", {
        documentId: document.id,
      });
      await Promise.all([refreshOpenIssues(), refreshCounts()]);
      if (suggestionsMode === "collapsed") setSuggestionsMode("docked");
    } catch (error) {
      setToast(formatError(error));
    } finally {
      setActionBusy(null);
    }
  };

  const exportDocument = async () => {
    setActionBusy("export");
    setToast(null);
    try {
      await persistAllSegments();
      const suggestedName =
        document.filterId === "builtin.pdf"
          ? document.name.replace(/\.pdf$/iu, "-translated.docx")
          : document.name.replace(/(\.[^.]+)$/u, "-translated$1");
      const outputPath =
        await window.translunar.selectExportPath(suggestedName);
      if (!outputPath) return;
      const result = await window.translunar.invoke("document.export", {
        documentId: document.id,
        outputPath,
      });
      setToast(
        t("workbench.exportedSegments", {
          count: result.translatedSegments,
          name: fileName(result.outputPath),
        }),
      );
    } catch (error) {
      setToast(formatError(error));
    } finally {
      setActionBusy(null);
    }
  };

  const closeGlobalSearch = () => {
    setGlobalSearchOpen(false);
    // Return focus to a stable Workbench owner (masthead search control removed).
    window.requestAnimationFrame(() => editorRegionRef.current?.focus());
  };

  const openCommandPalette = () => {
    const active = document.activeElement;
    commandPaletteOwnerRef.current =
      active instanceof HTMLElement ? active : null;
    setCommandQuery("");
    setCommandPaletteOpen(true);
  };

  /** Central dismiss + focus restore for every palette close path. */
  const closeCommandPalette = () => {
    setCommandPaletteOpen(false);
    const owner = commandPaletteOwnerRef.current;
    commandPaletteOwnerRef.current = null;
    window.requestAnimationFrame(() => {
      restorePaletteOwnerFocus(owner, editorRegionRef.current);
    });
  };

  /**
   * Activate a loaded segment by document ordinal without focusing the
   * translation textarea (preserves IME / active edit focus).
   */
  const activateMatrixSegment = (
    loaded: readonly Segment[] | null | undefined,
    ordinal: number,
  ) => {
    if (!loaded || loaded.length === 0) return;
    const exact = loaded.find((segment) => segment.ordinal === ordinal);
    const target =
      exact ??
      loaded.reduce((best, segment) =>
        Math.abs(segment.ordinal - ordinal) < Math.abs(best.ordinal - ordinal)
          ? segment
          : best,
      );
    setActiveId(target.id);
    window.requestAnimationFrame(() => {
      documentQuery<HTMLElement>(
        `[data-segment-row="${target.id}"]`,
      )?.scrollIntoView({ block: "center" });
    });
  };

  const selectGlobalSearchHit = async (hit: GlobalSearchHit) => {
    setActionBusy("navigate");
    setToast(null);
    try {
      await persistAllSegments();
      await onOpenGlobalSearchHit(hit);
    } catch (error) {
      const message = formatError(error);
      setToast(message);
      throw error;
    } finally {
      setActionBusy(null);
    }
  };

  const selectDocument = async (documentId: string) => {
    if (!onOpenDocument || documentId === document.id) return;
    setActionBusy("navigate");
    setToast(null);
    try {
      await persistAllSegments();
      await onOpenDocument(documentId);
    } catch (error) {
      setToast(formatError(error));
    } finally {
      setActionBusy(null);
    }
  };

  const navigateIssue = (direction: -1 | 1) => {
    if (openIssueIds.length === 0) return;
    const current = openIssueIds.indexOf(activeId);
    const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
    const next =
      (start + direction + openIssueIds.length) % openIssueIds.length;
    const nextId = openIssueIds[next];
    if (!nextId) return;
    setActiveId(nextId);
    documentQuery<HTMLElement>(
      `[data-segment-row="${nextId}"]`,
    )?.scrollIntoView({
      block: "center",
    });
  };

  /**
   * Expand ordered segment IDs for the current filter/search scope via
   * existing `segment.editor.list` paging. Does not mount rows in the grid.
   */
  const ensureFilterScopeIds = async (): Promise<string[]> => {
    const total = editorTotalRef.current;
    const key = `${document.id}|${filter}|${search}|${total}`;
    if (filterScopeIdsRef.current?.key === key) {
      return filterScopeIdsRef.current.ids;
    }
    const ids: string[] = [];
    let offset = 0;
    const limit = 200;
    while (true) {
      const result = await window.translunar.invoke("segment.editor.list", {
        documentId: document.id,
        query: search,
        field: "both",
        filter,
        sort: "ordinal",
        descending: false,
        offset,
        limit,
        includeContext: false,
      });
      for (const row of result.items) {
        ids.push(row.segment.id);
      }
      if (result.items.length === 0) break;
      offset += result.items.length;
      if (offset >= result.total) break;
    }
    filterScopeIdsRef.current = { key, ids };
    setFilterScopeIds(ids);
    return ids;
  };

  /**
   * Grid virtual seek by **filter-space list index** (not document ordinal).
   * Loads the editor window that contains the index; focus completion is
   * owned by useRovingGrid’s pending-seek handshake.
   */
  const seekListIndex = async (listIndex: number) => {
    const total = editorTotalRef.current;
    if (listIndex < 0 || (total > 0 && listIndex >= total)) return;
    const requested = Math.max(
      0,
      Math.min(
        Math.max(0, total - EDITOR_WINDOW_SIZE),
        listIndex - EDITOR_OVERSCAN,
      ),
    );
    await loadEditorWindow(requested);
    window.requestAnimationFrame(() => {
      const rows = editorRowsRef.current;
      const windowOffset = editorOffsetRef.current;
      const local = listIndex - windowOffset;
      const row = rows[local];
      if (!row) return;
      documentQuery<HTMLElement>(
        `[data-segment-row="${row.segment.id}"]`,
      )?.scrollIntoView({ block: "nearest" });
    });
  };

  /**
   * Matrix seek by **document ordinal** → active-id + scrollIntoView.
   * Does not focus the translation textarea (avoids stealing IME/edit focus).
   * Filter/search remap list offsets, so incompatible projections are cleared
   * before loading the window that contains the ordinal.
   */
  const navigateMatrix = async (ordinal: number) => {
    const documentTotal = Math.max(0, documentTotalRef.current);
    if (ordinal < 0 || (documentTotal > 0 && ordinal >= documentTotal)) return;

    const inWindow = editorRowsRef.current.find(
      (row) => row.segment.ordinal === ordinal,
    );
    if (inWindow) {
      setActiveId(inWindow.segment.id);
      window.requestAnimationFrame(() => {
        documentQuery<HTMLElement>(
          `[data-segment-row="${inWindow.segment.id}"]`,
        )?.scrollIntoView({ block: "center" });
      });
      return;
    }

    const filtered = filter !== "all" || search.trim().length > 0;
    if (filtered) {
      // Clear projection; filter effect loads around the pending ordinal.
      pendingMatrixOrdinalRef.current = ordinal;
      setFilter("all");
      setSearch("");
      return;
    }

    const requested = Math.max(
      0,
      Math.min(
        Math.max(0, documentTotal - EDITOR_WINDOW_SIZE),
        ordinal - EDITOR_OVERSCAN,
      ),
    );
    const loaded = await loadEditorWindow(requested);
    activateMatrixSegment(loaded, ordinal);
  };

  /**
   * Wheel against the real grid scroll owner only.
   * Bracket drag maps document ratio → ordinal → `navigateMatrix` inside
   * DocumentMatrix (filter-safe); it does not use filtered-list scroll height.
   */
  const scrollMatrixGridBy = (deltaY: number) => {
    const grid = editorGridRef.current;
    if (!grid) return;
    grid.scrollTop += deltaY;
  };

  const insertMatch = (
    targetText: string,
    context?: { kind: "term"; sourceTerm: string },
  ) => {
    if (!activeSegment) return;
    if (composingRef.current.has(activeSegment.id)) return;
    updateDraft(activeSegment.id, targetText);
    scheduleSave(activeSegment.id, 80);
    documentQuery<HTMLTextAreaElement>(
      `[data-editor-for="${activeSegment.id}"]`,
    )?.focus();
    if (context?.kind === "term" && context.sourceTerm.trim()) {
      const scan = scanDivergentTargets(
        segmentsRef.current,
        context.sourceTerm,
        targetText,
        { excludeSegmentId: activeSegment.id, cap: 200 },
      );
      if (scan.hits.length > 0) {
        setConsistencyTerm(context.sourceTerm);
        setConsistencyHits(scan.hits);
        setConsistencyCapped(scan.capped);
        setConsistencyResults([]);
        setConsistencyToast({
          term: context.sourceTerm,
          count: scan.hits.length,
        });
      }
    }
  };

  const focusSegment = (segmentId: string) => {
    setActiveId(segmentId);
    window.requestAnimationFrame(() => {
      documentQuery<HTMLElement>(
        `[data-segment-row="${segmentId}"]`,
      )?.scrollIntoView({ block: "nearest" });
      documentQuery<HTMLTextAreaElement>(
        `[data-editor-for="${segmentId}"]`,
      )?.focus();
    });
  };

  const moveActiveSegment = (direction: -1 | 1) => {
    if (!activeSegment) return;
    const index = visibleSegments.findIndex(
      (segment) => segment.id === activeSegment.id,
    );
    const next = visibleSegments[index + direction];
    if (next) focusSegment(next.id);
  };

  const persistEditorPreferences = async (next: EditorPreferences) => {
    const previous = preferences;
    setPreferences(next);
    try {
      const saved = await window.translunar.invoke(
        "editor.preferences.update",
        {
          preferences: next,
        },
      );
      setPreferences(saved);
    } catch (error) {
      setPreferences(previous);
      setToast(formatError(error));
    }
  };

  const openEditorPreferences = () => {
    setShortcutDrafts(
      Object.fromEntries(
        EDITOR_COMMANDS.map((command) => [
          command.id,
          preferences.shortcuts[command.id] ?? command.shortcut,
        ]),
      ),
    );
    setPreferencesOpen(true);
  };

  const applyShortcutPreset = (preset: "default" | "trados" | "memoq") => {
    const defaults = Object.fromEntries(
      EDITOR_COMMANDS.map((command) => [command.id, command.shortcut]),
    );
    const overrides: Record<string, string> =
      preset === "trados"
        ? {
            "editor.next": "Ctrl+Alt+ArrowDown",
            "editor.previous": "Ctrl+Alt+ArrowUp",
            "editor.copySource": "Ctrl+Insert",
            "editor.copyTags": "Ctrl+Shift+Insert",
          }
        : preset === "memoq"
          ? {
              "editor.next": "Ctrl+ArrowDown",
              "editor.previous": "Ctrl+ArrowUp",
              "editor.copySource": "Ctrl+Shift+C",
            }
          : {};
    setShortcutDrafts({ ...defaults, ...overrides });
  };

  const saveShortcutPreferences = async () => {
    const bindings = EDITOR_COMMANDS.map((command) =>
      (shortcutDrafts[command.id] ?? command.shortcut).trim(),
    );
    const validation = validateShortcutBindings(
      bindings,
      GLOBAL_SEARCH_SHORTCUT,
    );
    if (validation === "empty") {
      setToast("Shortcut bindings cannot be empty.");
      return;
    }
    if (validation === "collision") {
      setToast("Shortcut bindings must not collide.");
      return;
    }
    if (validation === "reserved") {
      setToast(`${GLOBAL_SEARCH_SHORTCUT} is reserved for Global search.`);
      return;
    }
    const shortcuts = Object.fromEntries(
      EDITOR_COMMANDS.flatMap((command) => {
        const binding = shortcutDrafts[command.id] ?? command.shortcut;
        return binding === command.shortcut ? [] : [[command.id, binding]];
      }),
    );
    await persistEditorPreferences({ ...preferences, shortcuts });
    setPreferencesOpen(false);
  };

  const copySourceToTarget = () => {
    if (!activeSegment || composingRef.current.has(activeSegment.id)) return;
    updateDraft(activeSegment.id, activeSegment.sourceText);
    scheduleSave(activeSegment.id, 80);
  };

  const copyProtectedTags = async () => {
    if (
      !activeEditorRow ||
      composingRef.current.has(activeEditorRow.segment.id)
    )
      return;
    const target = draftsRef.current[activeEditorRow.segment.id] ?? "";
    const tags = copySourceTagLayout(activeEditorRow.sourceTags, target);
    try {
      const saved = await persistSegment(activeEditorRow.segment.id);
      const mutation = await window.translunar.invoke("segment.tag.set", {
        segmentId: saved.id,
        targetTags: tags,
        expectedRevision: saved.revision,
      });
      applyEditorMutation(mutation);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const setTargetTags = async (tags: InlineTag[]) => {
    if (
      !activeEditorRow ||
      composingRef.current.has(activeEditorRow.segment.id)
    )
      return;
    try {
      const saved = await persistSegment(activeEditorRow.segment.id);
      applyEditorMutation(
        await window.translunar.invoke("segment.tag.set", {
          segmentId: saved.id,
          targetTags: tags,
          expectedRevision: saved.revision,
        }),
      );
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const insertProtectedTag = async (paired: boolean) => {
    if (!activeEditorRow) return;
    const editor = documentQuery<HTMLTextAreaElement>(
      `[data-editor-for="${activeEditorRow.segment.id}"]`,
    );
    if (!editor || composingRef.current.has(activeEditorRow.segment.id)) return;
    const target = draftsRef.current[activeEditorRow.segment.id] ?? "";
    const tags = canonicalTargetTags(
      activeEditorRow.sourceTags,
      activeEditorRow.targetTags,
    );
    const missing = missingSourceTags(activeEditorRow.sourceTags, tags);
    const selectionStart = utf16OffsetToScalar(target, editor.selectionStart);
    const selectionEnd = utf16OffsetToScalar(target, editor.selectionEnd);
    if (paired) {
      const start = missing.find((tag) => tag.kind === "start" && tag.pairId);
      const end = start
        ? missing.find(
            (tag) => tag.kind === "end" && tag.pairId === start.pairId,
          )
        : undefined;
      if (!start || !end) {
        setToast(
          "No missing protected tag pair is available for this segment.",
        );
        return;
      }
      await setTargetTags([
        ...tags,
        { ...start, side: "target", position: selectionStart },
        { ...end, side: "target", position: selectionEnd },
      ]);
      return;
    }
    const tag = missing.find((item) => item.kind === "standalone");
    if (!tag) {
      setToast(
        "No missing standalone protected tag is available for this segment.",
      );
      return;
    }
    await setTargetTags([
      ...tags,
      { ...tag, side: "target", position: selectionStart },
    ]);
  };

  const moveSelectedTagToCaret = async () => {
    if (!activeEditorRow || !selectedTargetTagId) return;
    const editor = documentQuery<HTMLTextAreaElement>(
      `[data-editor-for="${activeEditorRow.segment.id}"]`,
    );
    if (!editor || composingRef.current.has(activeEditorRow.segment.id)) return;
    const selectedIndex = activeEditorRow.targetTags.findIndex(
      (tag) => tag.id === selectedTargetTagId,
    );
    if (selectedIndex < 0) return;
    const target = draftsRef.current[activeEditorRow.segment.id] ?? "";
    const tags = canonicalTargetTags(
      activeEditorRow.sourceTags,
      activeEditorRow.targetTags,
    );
    const selected = tags[selectedIndex];
    if (!selected) return;
    tags[selectedIndex] = {
      ...selected,
      position: utf16OffsetToScalar(target, editor.selectionStart),
    };
    await setTargetTags(tags);
  };

  const openSourceCorrection = () => {
    if (!activeSegment || composingRef.current.has(activeSegment.id)) return;
    if (document.filterId === "builtin.pdf") {
      setToast(
        "Use the PDF preview OCR correction workflow for this document.",
      );
      return;
    }
    setSourceCorrectionText(activeSegment.sourceText);
    setSourceCorrectionReason("");
    setSourceCorrectionOpen(true);
  };

  const openChineseConversion = () => {
    if (!activeSegment || composingRef.current.has(activeSegment.id)) return;
    setChineseConversionOpen(true);
  };

  const openActiveComments = () => {
    if (!activeSegment || composingRef.current.has(activeSegment.id)) return;
    setCommentsOpen(true);
  };

  const applySourceCorrection = async () => {
    if (!activeSegment || !sourceCorrectionReason.trim()) return;
    try {
      const saved = await persistSegment(activeSegment.id);
      applyEditorMutation(
        await window.translunar.invoke("segment.correctSource", {
          segmentId: saved.id,
          sourceText: sourceCorrectionText,
          reason: sourceCorrectionReason,
          expectedRevision: saved.revision,
        }),
      );
      setSourceCorrectionOpen(false);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const convertActiveChinese = async () => {
    if (!activeSegment) return;
    try {
      const saved = await persistSegment(activeSegment.id);
      applyEditorMutation(
        await window.translunar.invoke("segment.chinese.convert", {
          segmentId: saved.id,
          profile: chineseConversionProfile,
          expectedRevision: saved.revision,
        }),
      );
      setChineseConversionOpen(false);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const openConcordance = () => {
    const editor = activeSegment
      ? documentQuery<HTMLTextAreaElement>(
          `[data-editor-for="${activeSegment.id}"]`,
        )
      : null;
    const selected = editor?.value.slice(
      editor.selectionStart,
      editor.selectionEnd,
    );
    setConcordanceQuery(selected?.trim() || activeSegment?.sourceText || "");
    setConcordanceHits([]);
    setConcordanceTotal(0);
    setConcordanceCorpusHits([]);
    setConcordanceCorpusTotal(0);
    setConcordanceOpen(true);
  };

  const runConcordance = async () => {
    if (!concordanceQuery.trim()) return;
    setConcordanceBusy(true);
    try {
      const result = await window.translunar.invoke("tm.concordance", {
        projectId: snapshot.project.id,
        query: concordanceQuery,
        side: concordanceSide,
        offset: 0,
        limit: 50,
      });
      setConcordanceHits(result.hits);
      setConcordanceTotal(result.total);
      setConcordanceCorpusHits(result.corpusHits ?? []);
      setConcordanceCorpusTotal(result.corpusTotal ?? 0);
    } catch (error) {
      setToast(formatError(error));
    } finally {
      setConcordanceBusy(false);
    }
  };

  const setWorkflowState = async (
    next: EditorWorkflowState,
    decision?: { actor: string; reason: string },
  ) => {
    if (!activeEditorRow) return;
    try {
      const saved = await persistSegment(activeEditorRow.segment.id);
      applyEditorMutation(
        await window.translunar.invoke("segment.workflow.set", {
          segmentId: saved.id,
          state: next,
          expectedRevision: saved.revision,
          ...(decision ? decision : {}),
        }),
      );
      return true;
    } catch (error) {
      setToast(formatError(error));
      return false;
    }
  };

  const advanceWorkflow = async () => {
    if (!activeEditorRow) return;
    if (
      activeEditorRow.workflowState === "translation" &&
      snapshot.project.configuration.reviewRequired === false
    ) {
      setDirectSignoffOpen(true);
      return;
    }
    const next: EditorWorkflowState =
      activeEditorRow.workflowState === "translation"
        ? "review"
        : activeEditorRow.workflowState === "review"
          ? "signed"
          : "translation";
    await setWorkflowState(next);
  };

  const requestWorkflowState = (next: EditorWorkflowState) => {
    if (
      next === "signed" &&
      activeEditorRow?.workflowState === "translation" &&
      snapshot.project.configuration.reviewRequired === false
    ) {
      setDirectSignoffOpen(true);
      return;
    }
    void setWorkflowState(next);
  };

  const confirmDirectSignoff = async () => {
    if (!directSignoffActor.trim() || !directSignoffReason.trim()) return;
    const signed = await setWorkflowState("signed", {
      actor: directSignoffActor.trim(),
      reason: directSignoffReason.trim(),
    });
    if (!signed) return;
    setDirectSignoffOpen(false);
    setDirectSignoffActor("");
    setDirectSignoffReason("");
  };

  const undoEditor = async () => {
    try {
      await persistAllSegments();
      applyEditorMutation(
        await window.translunar.invoke("editor.undo", {
          projectId: snapshot.project.id,
        }),
      );
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const redoEditor = async () => {
    try {
      await persistAllSegments();
      applyEditorMutation(
        await window.translunar.invoke("editor.redo", {
          projectId: snapshot.project.id,
        }),
      );
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const previewReplacement = async () => {
    try {
      await persistAllSegments();
      const preview = await window.translunar.invoke(
        "segment.replace.preview",
        {
          documentId: document.id,
          query: findQuery,
          replacement,
          field: findField,
          regex: findRegex,
          caseSensitive: findCaseSensitive,
          wholeWord: findWholeWord,
        },
      );
      setReplacePreview(preview);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const applyReplacement = async () => {
    if (!replacePreview) return;
    try {
      const mutation = await window.translunar.invoke("segment.replace.apply", {
        preview: replacePreview,
      });
      applyEditorMutation(mutation);
      setReplacePreview(null);
      setFindOpen(false);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const createComment = async () => {
    if (!activeSegment || !commentDraft.trim()) return;
    try {
      const comment = await window.translunar.invoke("segment.comment.create", {
        segmentId: activeSegment.id,
        author: "desktop",
        text: commentDraft.trim(),
      });
      setEditorRows((current) =>
        current.map((row) =>
          row.segment.id === activeSegment.id
            ? { ...row, comments: [...row.comments, comment] }
            : row,
        ),
      );
      setCommentDraft("");
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const applyEditorComment = (updated: EditorComment) => {
    setEditorRows((current) =>
      current.map((row) => ({
        ...row,
        comments: row.comments.map((comment) =>
          comment.id === updated.id ? updated : comment,
        ),
      })),
    );
  };

  const updateComment = async (comment: EditorComment) => {
    if (!commentEditText.trim()) return;
    try {
      const updated = await window.translunar.invoke("segment.comment.update", {
        commentId: comment.id,
        text: commentEditText.trim(),
        expectedRevision: comment.revision,
      });
      applyEditorComment(updated);
      setEditingCommentId(null);
      setCommentEditText("");
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const deleteComment = async (comment: EditorComment) => {
    try {
      await window.translunar.invoke("segment.comment.delete", {
        commentId: comment.id,
        expectedRevision: comment.revision,
      });
      setEditorRows((current) =>
        current.map((row) => ({
          ...row,
          comments: row.comments.filter((item) => item.id !== comment.id),
        })),
      );
      if (editingCommentId === comment.id) {
        setEditingCommentId(null);
        setCommentEditText("");
      }
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const setCommentResolved = async (
    commentId: string,
    revision: number,
    resolved: boolean,
  ) => {
    try {
      const updated = await window.translunar.invoke(
        "segment.comment.resolve",
        { commentId, expectedRevision: revision, resolved },
      );
      applyEditorComment(updated);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const openReviewPanel = async () => {
    if (!activeSegment || composingRef.current.has(activeSegment.id)) return;
    setReviewOpen(true);
    setReviewTarget(
      activeSegment
        ? (draftsRef.current[activeSegment.id] ?? activeSegment.targetText)
        : "",
    );
    setReviewSource(activeSegment?.sourceText ?? "");
    setReviewCopyTags(false);
    try {
      const result = await window.translunar.invoke("review.list", {
        documentId: document.id,
        includeClosed: true,
      });
      setReviews(result.revisions);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const createReview = async () => {
    if (!activeSegment || !activeEditorRow) return;
    try {
      const saved = await persistSegment(activeSegment.id);
      const proposedTarget =
        reviewTarget === saved.targetText ? undefined : reviewTarget;
      const proposedSource =
        reviewSource === saved.sourceText ? undefined : reviewSource;
      const proposedTargetTags = reviewCopyTags
        ? copySourceTagLayout(activeEditorRow.sourceTags, reviewTarget)
        : undefined;
      if (!proposedTarget && !proposedSource && !proposedTargetTags) {
        setToast(
          "Change source, target, or protected tags before creating a review proposal.",
        );
        return;
      }
      const review = await window.translunar.invoke("review.create", {
        segmentId: saved.id,
        proposedTarget: proposedTarget ?? null,
        proposedSource: proposedSource ?? null,
        proposedTargetTags: proposedTargetTags ?? null,
        author: "desktop-reviewer",
        reason: "Proposed from the editor review panel",
        expectedRevision: saved.revision,
      });
      setReviews((current) => [review, ...current]);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const decideReview = async (
    review: ReviewRevision,
    decision: "accept" | "reject",
  ) => {
    const segment = segmentsRef.current.find(
      (item) => item.id === review.segmentId,
    );
    if (!segment) return;
    try {
      if (decision === "accept") {
        applyEditorMutation(
          await window.translunar.invoke("review.accept", {
            reviewId: review.id,
            expectedSegmentRevision: segment.revision,
          }),
        );
      } else {
        const updated = await window.translunar.invoke("review.reject", {
          reviewId: review.id,
          expectedSegmentRevision: segment.revision,
        });
        setReviews((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      const refreshed = await window.translunar.invoke("review.list", {
        documentId: document.id,
        includeClosed: true,
      });
      setReviews(refreshed.revisions);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const addDictionaryFinding = async (finding: SpellFinding) => {
    try {
      await window.translunar.invoke("dictionary.add", {
        locale: snapshot.project.targetLocale,
        word: finding.word,
      });
      setSpellFindings((current) =>
        current.filter((item) => item.word !== finding.word),
      );
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const splitActiveSegment = async () => {
    if (!activeSegment || composingRef.current.has(activeSegment.id)) return;
    const editor = documentQuery<HTMLTextAreaElement>(
      `[data-editor-for="${activeSegment.id}"]`,
    );
    const sourceLength = Array.from(activeSegment.sourceText).length;
    if (sourceLength < 2) return;
    try {
      const saved = await persistSegment(activeSegment.id);
      const targetOffset = editor
        ? utf16OffsetToScalar(editor.value, editor.selectionStart)
        : 0;
      const targetLength = Array.from(editor?.value ?? "").length;
      const sourceOffset = Math.min(
        sourceLength - 1,
        Math.max(
          1,
          targetLength > 0
            ? Math.round((sourceLength * targetOffset) / targetLength)
            : Math.floor(sourceLength / 2),
        ),
      );
      const mutation = await window.translunar.invoke("segment.split", {
        segmentId: saved.id,
        sourceOffset,
        targetOffset: editor ? targetOffset : null,
        expectedRevision: saved.revision,
      });
      applyEditorMutation(mutation);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const mergeActiveSegment = async () => {
    if (!activeSegment || composingRef.current.has(activeSegment.id)) return;
    const index = visibleSegments.findIndex(
      (segment) => segment.id === activeSegment.id,
    );
    const second = visibleSegments[index + 1];
    if (!second) return;
    if (!canMergeSplitSiblings(activeSegment, second)) {
      setToast(
        "Only adjacent sibling segments created by Split can be merged safely.",
      );
      return;
    }
    try {
      const first = await persistSegment(activeSegment.id);
      const savedSecond = await persistSegment(second.id);
      const mutation = await window.translunar.invoke("segment.merge", {
        firstSegmentId: first.id,
        secondSegmentId: savedSecond.id,
        firstExpectedRevision: first.revision,
        secondExpectedRevision: savedSecond.revision,
      });
      applyEditorMutation(mutation);
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const getEditorCommandContext = (): EditorCommandContext => {
    const activeIndex = activeSegment
      ? visibleSegments.findIndex((segment) => segment.id === activeSegment.id)
      : -1;
    const nextSegment =
      activeIndex >= 0 ? visibleSegments[activeIndex + 1] : undefined;
    const focused = document.activeElement;
    return {
      hasActiveSegment: Boolean(activeSegment),
      hasActiveEditorRow: Boolean(activeEditorRow),
      editorFocused:
        focused instanceof HTMLTextAreaElement &&
        focused.dataset.editorFor === activeSegment?.id,
      isComposing: activeSegment
        ? composingRef.current.has(activeSegment.id)
        : false,
      isSigned: activeEditorRow?.workflowState === "signed",
      canMerge: Boolean(
        activeSegment &&
        nextSegment &&
        canMergeSplitSiblings(activeSegment, nextSegment),
      ),
      hasSelectedTargetTag: Boolean(selectedTargetTagId),
      visibleSuggestionCount: matches.length,
    };
  };

  const editorCommandHandlers: EditorCommandHandlers = {
    save: () => void persistAllSegments(),
    confirm: () => {
      if (activeSegment) void confirmSegment(activeSegment.id);
    },
    next: () => moveActiveSegment(1),
    previous: () => moveActiveSegment(-1),
    openFindReplace: () => setFindOpen(true),
    openConcordance,
    copySource: copySourceToTarget,
    copyTags: () => void copyProtectedTags(),
    insertTag: (paired) => void insertProtectedTag(paired),
    moveTag: () => void moveSelectedTagToCaret(),
    split: () => void splitActiveSegment(),
    merge: () => void mergeActiveSegment(),
    correctSource: openSourceCorrection,
    openChineseConversion,
    openComments: openActiveComments,
    openReview: () => void openReviewPanel(),
    advanceWorkflow: () => void advanceWorkflow(),
    insertSuggestion: (index) => {
      const match = matches[index];
      if (match) insertMatch(match.targetText);
    },
    undo: () => void undoEditor(),
    redo: () => void redoEditor(),
    openPalette: () => openCommandPalette(),
    openPreferences: openEditorPreferences,
    toggleSuggestions: () =>
      setSuggestionsMode((mode) => togglePanelCollapsed(mode)),
    togglePreview: () => setPreviewMode((mode) => togglePanelCollapsed(mode)),
    toggleTheme: () => {
      const theme =
        preferences.theme === "system"
          ? "dark"
          : preferences.theme === "dark"
            ? "light"
            : "system";
      void persistEditorPreferences({ ...preferences, theme });
    },
    zoomIn: () =>
      void persistEditorPreferences({
        ...preferences,
        zoom: Math.min(200, preferences.zoom + 10),
      }),
    zoomOut: () =>
      void persistEditorPreferences({
        ...preferences,
        zoom: Math.max(75, preferences.zoom - 10),
      }),
    toggleNonprinting: () =>
      void persistEditorPreferences({
        ...preferences,
        showNonprinting: !preferences.showNonprinting,
      }),
  };

  const runEditorCommand = (
    id: EditorCommandId,
    invocation: EditorCommandInvocation = "external",
  ) => {
    const command = commandById(id);
    if (
      !isEditorCommandEnabled(command, getEditorCommandContext(), invocation)
    ) {
      if (activeEditorRow?.workflowState === "signed") {
        setToast(t("workbench.signedReadOnly"));
      }
      closeCommandPalette();
      return;
    }
    dispatchEditorCommand(id, editorCommandHandlers);
    if (id !== "editor.palette") closeCommandPalette();
  };

  useEffect(() =>
    window.translunar.onEditorCommand((commandId) => {
      const command = EDITOR_COMMANDS.find((item) => item.id === commandId);
      if (command) runEditorCommand(command.id);
    }),
  );

  const onWorkbenchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      composingRef.current.size > 0
    ) {
      return;
    }
    if (shortcutMatches(event.nativeEvent, GLOBAL_SEARCH_SHORTCUT)) {
      event.preventDefault();
      event.stopPropagation();
      setGlobalSearchOpen(true);
      return;
    }
    const command = EDITOR_COMMANDS.find((item) =>
      shortcutMatches(
        event.nativeEvent,
        preferences.shortcuts[item.id] ?? item.shortcut,
      ),
    );
    if (!command || command.id === "editor.confirm") return;
    event.preventDefault();
    event.stopPropagation();
    runEditorCommand(command.id, "keyboard");
  };

  const paletteCommands = EDITOR_COMMANDS.filter((command) =>
    `${command.label} ${command.id}`
      .toLocaleLowerCase()
      .includes(commandQuery.trim().toLocaleLowerCase()),
  );
  const hasGridFilters = filter !== "all" || search.trim().length > 0;
  const clearGridFilters = () => {
    setFilter("all");
    setSearch("");
  };

  const segmentRowViews = useMemo((): SegmentRowView[] => {
    const editorRowById = new Map(
      editorRows.map((row) => [row.segment.id, row] as const),
    );
    return visibleSegments.map((segment, index) => {
      const editorRow = editorRowById.get(segment.id);
      const issue = openIssueBySegment.get(segment.id);
      const nextSegment = visibleSegments[index + 1];
      const draft = drafts[segment.id] ?? segment.targetText;
      const isSigned = editorRow?.workflowState === "signed";
      const sourceTags = mapSourceTags(
        editorRow?.sourceTags ?? [],
        editorRow?.targetTags ?? [],
        editorRow?.tagIssues ?? [],
      );
      const targetTags = mapTargetTags(
        editorRow?.targetTags ?? [],
        editorRow?.tagIssues ?? [],
      );
      const selected =
        selectedSegmentIds.size > 0
          ? selectedSegmentIds.has(segment.id)
          : segment.id === activeId;
      const isActive = segment.id === activeId;
      const autocomplete =
        isActive && !isGlobalComposing()
          ? autocompleteForSegment(segment.id)
          : null;
      return {
        segmentId: segment.id,
        ordinal: segment.ordinal,
        sourceText: segment.sourceText,
        targetDraft: draft,
        segmentState: segment.state,
        workflowState: editorRow?.workflowState ?? "translation",
        lampState: deriveLampState({
          segmentState: segment.state,
          workflowState: editorRow?.workflowState ?? "translation",
          openIssue: issue ?? null,
        }),
        isActive,
        isSelected: selected,
        isAnchor: selectionAnchorId === segment.id || (isActive && selectedSegmentIds.size <= 1),
        isFlash: segment.id === flashSegmentId,
        isSigned: Boolean(isSigned),
        isEditable: !isSigned,
        mergeEligible: Boolean(
          nextSegment && canMergeSplitSiblings(segment, nextSegment),
        ),
        openCommentCount:
          editorRow?.comments.filter((comment) => !comment.resolved).length ??
          0,
        sourceTags,
        targetTags,
        selectedTargetTagId: isActive ? selectedTargetTagId : null,
        findings: mapFindings(issue, editorRow?.tagIssues ?? [], Boolean(draft.trim())),
        autocomplete,
        spellFindings:
          isActive
            ? spellFindings.slice(0, 4).map((finding) => ({
                key: `${finding.provider}-${finding.start}-${finding.word}`,
                word: finding.word,
                provider: finding.provider,
              }))
            : [],
        ariaInvalid: Boolean(issue),
      };
    });
  }, [
    activeId,
    drafts,
    editorRows,
    flashSegmentId,
    openIssueBySegment,
    selectedSegmentIds,
    selectedTargetTagId,
    selectionAnchorId,
    spellFindings,
    visibleSegments,
  ]);

  const gridLabels = useMemo((): SegmentGridLabels => {
    return {
      region: t("workbench.segmentsAria"),
      idColumn: t("workbench.grid.idColumn"),
      status: t("common.status"),
      sourceColumn: t("workbench.sourceColumn", {
        locale: snapshot.project.sourceLocale,
      }),
      targetColumn: t("workbench.targetColumn", {
        locale: snapshot.project.targetLocale,
      }),
      untranslated: t("workbench.untranslated"),
      segmentTools: t("workbench.segmentTools"),
      bestMatch: t("workbench.bestMatch"),
      comments: t("workbench.openCommentsShort"),
      more: t("common.moreActions"),
      targetTags: t("workbench.targetTags"),
      selectProtectedTag: (tag, position) =>
        t("workbench.selectProtectedTag", { tag, position }),
      moveTagHint: t("workbench.moveTagHint"),
      targetSegment: (ordinal) => t("workbench.targetSegment", { ordinal }),
      acceptAutocomplete: (provider) =>
        t("workbench.acceptAutocomplete", { provider }),
      tab: t("workbench.tab"),
      spellFindingsFrom: (provider) =>
        t("workbench.spellFindingsFrom", { provider }),
      addDictionary: t("workbench.addDictionary"),
      noMatches: t("workbench.noGridMatches"),
      clearFilters: t("workbench.clearGridFilters"),
      lamp: {
        untranslated: t("workbench.lamp.untranslated"),
        draft: t("workbench.lamp.draft"),
        confirmed: t("workbench.lamp.confirmed"),
        reviewed: t("workbench.lamp.reviewed"),
        signed: t("workbench.lamp.signed"),
        error: t("workbench.lamp.error"),
        warning: t("workbench.lamp.warning"),
        locked: t("workbench.lamp.locked"),
      },
      selectedCount: (count) => t("workbench.selectedCount", { count }),
      selectedHidden: (count) => t("workbench.selectedHidden", { count }),
      batchConfirm: t("workbench.batch.confirm"),
      batchClearTarget: t("workbench.batch.clearTarget"),
      batchLock: t("workbench.batch.lock"),
      batchPretranslate: t("workbench.batch.pretranslate"),
      batchComment: t("workbench.batch.comment"),
      batchCancel: t("workbench.batch.cancel"),
      batchConfirmDestructive: t("workbench.batch.confirmDestructive"),
      qaRegion: t("workbench.inlineQa"),
      qaLocate: t("workbench.qaLocate"),
      qaIgnore: t("workbench.qaIgnore"),
      tagPaired: t("workbench.tagPaired"),
      tagMissing: t("workbench.tagMissing"),
      tagOrder: t("workbench.tagOrder"),
      splitSegment: t("workbench.splitSegment"),
      mergeNext: t("workbench.mergeNext"),
      correctSource: t("workbench.correctSource"),
      openChinese: t("workbench.openChinese"),
      openReview: t("workbench.openReview"),
      copyTags: t("workbench.copyTags"),
      insertTag: t("workbench.insertTag"),
      insertTagPair: t("workbench.insertTagPair"),
    };
  }, [snapshot.project.sourceLocale, snapshot.project.targetLocale, t]);

  const batchActionDescriptors = useMemo(
    () => [
      {
        id: "confirm" as const,
        label: gridLabels.batchConfirm,
        enabled: selectedSegmentIds.size >= 2,
      },
      {
        id: "clearTarget" as const,
        label: gridLabels.batchClearTarget,
        enabled: selectedSegmentIds.size >= 2,
        destructive: true,
      },
      {
        id: "lock" as const,
        label: gridLabels.batchLock,
        // No per-selected-ID collab lock adapter in Workbench; do not bulk-sign.
        enabled: false,
      },
      {
        id: "pretranslate" as const,
        label: gridLabels.batchPretranslate,
        enabled: false,
      },
      {
        id: "comment" as const,
        label: gridLabels.batchComment,
        enabled: selectedSegmentIds.size >= 2,
      },
      {
        id: "cancel" as const,
        label: gridLabels.batchCancel,
        enabled: selectedSegmentIds.size >= 2,
      },
    ],
    [gridLabels, selectedSegmentIds.size],
  );

  const hiddenSelectedCount = useMemo(() => {
    if (selectedSegmentIds.size === 0) return 0;
    const visible = new Set(visibleSegments.map((segment) => segment.id));
    let hidden = 0;
    for (const id of selectedSegmentIds) {
      if (!visible.has(id)) hidden += 1;
    }
    return hidden;
  }, [selectedSegmentIds, visibleSegments]);

  const handleSelectionChange = useCallback(
    (next: { selectedIds: Set<string>; anchorId: string | null }) => {
      setSelectedSegmentIds(next.selectedIds);
      setSelectionAnchorId(next.anchorId);
      if (next.anchorId) setActiveId(next.anchorId);
    },
    [],
  );

  const handleBatchAction = useCallback(
    (action: BatchActionId, selectedIds: string[]) => {
      if (action === "cancel") {
        const keep = selectionAnchorId ?? activeId;
        setSelectedSegmentIds(keep ? new Set([keep]) : new Set());
        setSelectionAnchorId(keep);
        return;
      }
      if (action === "pretranslate") {
        setToast(t("workbench.batch.pretranslateDeferred"));
        return;
      }
      if (action === "lock") {
        // Lock ≠ signed. Collab lock is not wired for batch selected IDs.
        setToast(t("workbench.batch.lockDeferred"));
        return;
      }
      if (action === "comment") {
        const first = selectedIds[0];
        if (first) {
          setActiveId(first);
          setCommentsOpen(true);
        }
        return;
      }
      if (action === "clearTarget") {
        const ok = window.confirm(t("workbench.batch.confirmDestructive"));
        if (!ok) return;
        for (const id of selectedIds) {
          const row = editorRowsRef.current.find((r) => r.segment.id === id);
          if (row?.workflowState === "signed") continue;
          updateDraft(id, "");
          scheduleSave(id, 80);
        }
        return;
      }
      if (action === "confirm") {
        void (async () => {
          for (const id of selectedIds) {
            await confirmSegment(id);
          }
        })();
      }
    },
    [activeId, selectionAnchorId, t],
  );

  const handleSelectAllFilterScope = () => {
    void (async () => {
      try {
        const ids = await ensureFilterScopeIds();
        const anchor = selectionAnchorId ?? activeId ?? ids[0] ?? null;
        setSelectedSegmentIds(new Set(ids));
        setSelectionAnchorId(anchor);
      } catch (error) {
        setToast(formatError(error));
      }
    })();
  };

  const handleRangeSelect = (
    fromListIndex: number,
    toListIndex: number,
    rangeAnchorId: string,
  ) => {
    void (async () => {
      try {
        const ids = await ensureFilterScopeIds();
        const from = Math.min(fromListIndex, toListIndex);
        const to = Math.max(fromListIndex, toListIndex);
        const next = new Set<string>();
        for (let i = from; i <= to; i += 1) {
          const id = ids[i];
          if (id) next.add(id);
        }
        setSelectedSegmentIds(next);
        setSelectionAnchorId(rangeAnchorId);
      } catch (error) {
        setToast(formatError(error));
      }
    })();
  };

  const handleMoveTargetTag = (
    segmentId: string,
    tagId: string,
    direction: -1 | 1,
  ) => {
    if (composingRef.current.has(segmentId) || isGlobalComposing()) return;
    const editorRow = editorRowsRef.current.find(
      (row) => row.segment.id === segmentId,
    );
    if (!editorRow || editorRow.workflowState === "signed") return;
    const tags = canonicalTargetTags(
      editorRow.sourceTags,
      editorRow.targetTags,
    );
    const index = tags.findIndex((tag) => tag.id === tagId);
    if (index < 0) return;
    const selected = tags[index];
    if (!selected) return;
    const neighbor = tags[index + direction];
    if (neighbor) {
      const nextPos = neighbor.position;
      const swapPos = selected.position;
      tags[index] = { ...selected, position: nextPos };
      tags[index + direction] = { ...neighbor, position: swapPos };
    } else {
      const target = draftsRef.current[segmentId] ?? "";
      const max = Array.from(target).length;
      const next = Math.max(0, Math.min(max, selected.position + direction));
      tags[index] = { ...selected, position: next };
    }
    setActiveId(segmentId);
    setSelectedTargetTagId(tagId);
    void setTargetTags(tags);
  };

  const handleMoreAction = (
    segmentId: string,
    action:
      | "copyTags"
      | "insertTag"
      | "insertTagPair"
      | "split"
      | "merge"
      | "correctSource"
      | "chinese"
      | "review",
  ) => {
    setActiveId(segmentId);
    switch (action) {
      case "copyTags":
        void copyProtectedTags();
        break;
      case "insertTag":
        void insertProtectedTag(false);
        break;
      case "insertTagPair":
        void insertProtectedTag(true);
        break;
      case "split":
        void splitActiveSegment();
        break;
      case "merge":
        void mergeActiveSegment();
        break;
      case "correctSource":
        openSourceCorrection();
        break;
      case "chinese":
        openChineseConversion();
        break;
      case "review":
        void openReviewPanel();
        break;
    }
  };

  const handleLocateFinding = useCallback(
    (segmentId: string, findingId: string) => {
      setActiveId(segmentId);
      if (findingId.startsWith("tag:")) {
        const tagId = findingId.split(":")[2];
        if (tagId && tagId !== "all") setSelectedTargetTagId(tagId);
      } else {
        if (suggestionsMode === "collapsed") setSuggestionsMode("docked");
      }
      window.requestAnimationFrame(() => {
        documentQuery<HTMLTextAreaElement>(
          `[data-editor-for="${segmentId}"]`,
        )?.focus();
      });
    },
    [suggestionsMode],
  );

  const handleIgnoreFinding = useCallback(
    (segmentId: string, findingId: string) => {
      // Tag structural findings are not waivable via qa.issue.waive.
      if (findingId.startsWith("tag:")) return;
      setActiveId(segmentId);
      const reason = window.prompt(t("workbench.qaIgnoreReason"));
      if (reason == null) return;
      const trimmed = reason.trim();
      if (!trimmed) {
        setToast(t("workbench.qaIgnoreReasonRequired"));
        return;
      }
      void (async () => {
        try {
          await window.translunar.invoke("qa.issue.waive", {
            issueId: findingId,
            actor: t("workbench.qaIgnoreActor"),
            reason: trimmed,
          });
          await refreshOpenIssues();
        } catch (error) {
          setToast(formatError(error));
        }
      })();
    },
    [t],
  );

  const applicationClasses = [
    "workbench-app",
    `suggestions-${suggestionsMode}`,
    `preview-${previewMode}`,
    `theme-${preferences.theme}`,
    preferences.showNonprinting ? "show-nonprinting" : "",
  ].join(" ");
  const applicationStyle = {
    "--preview-height": `${previewHeight}px`,
    "--editor-zoom": preferences.zoom / 100,
  } as CSSProperties;
  const issuePosition =
    Math.max(0, openIssueIds.indexOf(activeId)) + (openIssueIds.length ? 1 : 0);

  return (
    <div
      className={applicationClasses}
      style={applicationStyle}
      onKeyDownCapture={onWorkbenchKeyDown}
    >
      <Masthead
        projectName={snapshot.project.name}
        sourceLocale={snapshot.project.sourceLocale}
        targetLocale={snapshot.project.targetLocale}
        documents={snapshot.documents}
        activeDocument={document}
        confirmedCount={counts.confirmed}
        totalCount={counts.total}
        actionBusy={actionBusy !== null}
        onRunQa={() => void runQa()}
        onExport={() => void exportDocument()}
        onSelectDocument={(documentId) => void selectDocument(documentId)}
      />
      {globalSearchOpen ? (
        <div
          className="global-search-layer"
          role="presentation"
          onMouseDown={closeGlobalSearch}
        >
          <section
            className="global-search-dialog"
            role="dialog"
            aria-modal="false"
            aria-label={t("home.globalSearch")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <GlobalSearchPanel
              variant="workbench"
              autoFocus
              onClose={closeGlobalSearch}
              onOpen={selectGlobalSearchHit}
            />
          </section>
        </div>
      ) : null}

      <main className="workbench-layout">
        <div className="editor-column">
          <div className="editor-main-row">
            <aside
              className="plugin-editor-dock"
              aria-label={t("plugins.workbenchPanels.aria")}
            >
              <PluginWorkbenchPanels
                placement="editorSidebar"
                projectId={snapshot.project.id}
                {...(activeSegment?.id ? { segmentId: activeSegment.id } : {})}
              />
            </aside>
            <section
              id="tutorial-target-edit"
              ref={editorRegionRef}
              className="editor-region"
              tabIndex={-1}
              data-toolbar-compact={toolbarCompact ? "true" : "false"}
            >
              <FilterRail
                counts={counts}
                filter={filter}
                onFilterChange={(value: RailStatusFilter) => setFilter(value)}
                matchBucket={matchBucket}
                onMatchBucketChange={setMatchBucket}
                issuePosition={issuePosition}
                issueTotal={openIssueIds.length}
                onNavigateIssue={navigateIssue}
                showChipAxis={axisResidence === "chip"}
                compact={toolbarCompact}
                secondaryFilters={
                  <select
                    value={
                      filter === "tagged" || filter === "commented"
                        ? filter
                        : ""
                    }
                    onChange={(event) =>
                      setFilter(event.currentTarget.value as SegmentFilter)
                    }
                    aria-label={t("workbench.additionalFilters")}
                  >
                    <option value="" disabled>
                      {t("workbench.more")}
                    </option>
                    <option value="tagged">{t("workbench.tagged")}</option>
                    <option value="commented">
                      {t("workbench.commented")}
                    </option>
                  </select>
                }
              />

              <div className="editor-body">
                <div
                  className={
                    matrixSegmentStates.length > 0
                      ? "editor-grid-row editor-body--with-matrix"
                      : "editor-grid-row"
                  }
                >
                  {matrixSegmentStates.length > 0 ? (
                    <DocumentMatrix
                      segmentStates={matrixSegmentStates}
                      activeIndex={matrixActiveIndex}
                      viewportRange={viewportRange}
                      onNavigate={(ordinal) => void navigateMatrix(ordinal)}
                      onScrollBy={scrollMatrixGridBy}
                      labels={matrixLabels}
                    />
                  ) : null}
                  <SegmentGrid
                    rows={segmentRowViews}
                    total={editorTotal}
                    offset={editorOffset}
                    rowHeight={EDITOR_ROW_HEIGHT}
                    loading={editorLoading}
                    empty={visibleSegments.length === 0}
                    hasFilters={hasGridFilters}
                    activeId={activeId || null}
                    labels={gridLabels}
                    gridRef={editorGridRef}
                    onScroll={onEditorScroll}
                    onSeekOrdinal={(listIndex) => void seekListIndex(listIndex)}
                    onActivate={(segmentId) => setActiveId(segmentId)}
                    onTargetFocus={(segmentId) => setActiveId(segmentId)}
                    onDraftChange={(segmentId, value) => {
                      updateDraft(segmentId, value);
                      if (!composingRef.current.has(segmentId)) {
                        scheduleSave(segmentId);
                      }
                    }}
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={onCompositionEnd}
                    onTargetKeyDown={onTargetKeyDown}
                    onSelectTargetTag={(segmentId, tagId) => {
                      setActiveId(segmentId);
                      setSelectedTargetTagId(tagId);
                    }}
                    onMoveTargetTag={handleMoveTargetTag}
                    onBestMatch={(segmentId) => {
                      setActiveId(segmentId);
                      const match = matches[0];
                      if (match) insertMatch(match.targetText);
                    }}
                    onOpenComments={(segmentId) => {
                      setActiveId(segmentId);
                      openActiveComments();
                    }}
                    onMoreAction={handleMoreAction}
                    onAcceptAutocomplete={(segmentId, targetText) => {
                      updateDraft(segmentId, targetText);
                      scheduleSave(segmentId, 80);
                    }}
                    onAddDictionary={(findingKey) => {
                      const finding = spellFindings.find(
                        (item) =>
                          `${item.provider}-${item.start}-${item.word}` ===
                          findingKey,
                      );
                      if (finding) void addDictionaryFinding(finding);
                    }}
                    onLocateFinding={handleLocateFinding}
                    onIgnoreFinding={handleIgnoreFinding}
                    onClearFilters={clearGridFilters}
                    onBatchAction={handleBatchAction}
                    batchActions={batchActionDescriptors}
                    isComposing={() =>
                      isGlobalComposing() || composingRef.current.size > 0
                    }
                    renderAxis={(segmentId) =>
                      segmentId === activeId && axisResidence === "row" ? (
                        <ActiveAxis variant="row" />
                      ) : null
                    }
                    renderSource={(row) => {
                      const editorRow = editorRows.find(
                        (item) => item.segment.id === row.segmentId,
                      );
                      return (
                        <TaggedText
                          text={row.sourceText}
                          tags={editorRow?.sourceTags ?? []}
                          showNonprinting={preferences.showNonprinting}
                        />
                      );
                    }}
                    selectedIds={selectedSegmentIds}
                    anchorId={selectionAnchorId}
                    onSelectionChange={handleSelectionChange}
                    hiddenSelectedCount={hiddenSelectedCount}
                    {...(filterScopeIds
                      ? { allFilteredIds: filterScopeIds }
                      : {})}
                    onSelectAllFilterScope={handleSelectAllFilterScope}
                    onRangeSelect={handleRangeSelect}
                    onRowStrideChange={setEditorRowStride}
                  />
                </div>
                <PreviewDock
                  document={document}
                  activeSegment={activeSegment}
                  segments={segments}
                  total={editorTotal}
                  mode={previewMode}
                  onModeChange={setPreviewMode}
                  height={previewHeight}
                  onHeightChange={setPreviewHeight}
                  followActive={followActivePreview}
                  onFollowActiveChange={setFollowActivePreview}
                  onNavigateSegment={(segmentId, ordinal) =>
                    void navigateToPreviewSegment(segmentId, ordinal)
                  }
                  onSourceCorrected={applyCorrectedSource}
                />
              </div>
            </section>
          </div>
          <PluginWorkbenchPanels
            placement="bottomPanel"
            projectId={snapshot.project.id}
            {...(activeSegment?.id ? { segmentId: activeSegment.id } : {})}
          />
        </div>

        <StackPanel
          projectId={snapshot.project.id}
          sourceLocale={snapshot.project.sourceLocale}
          targetLocale={snapshot.project.targetLocale}
          mode={suggestionsMode}
          onModeChange={setSuggestionsMode}
          assistantOpen={assistantOpen}
          onAssistantOpenChange={setAssistantOpen}
          activeSegment={activeSegment}
          matches={matches}
          matchesLoading={matchesLoading}
          matchesError={matchesError}
          termMatches={termMatches}
          termLoading={termLoading}
          termSettled={termSettled}
          termError={termError}
          onInsert={insertMatch}
          onApplyMutation={applyEditorMutation}
        />
      </main>

      <SelectionAiMenu
        enabled={aiSettingsEnabled}
        activeSegment={activeSegment}
        sourceLocale={snapshot.project.sourceLocale}
        targetLocale={snapshot.project.targetLocale}
        onUseTarget={(text) => insertMatch(text)}
      />

      <ConsistencyRepairToast
        open={consistencyToast !== null}
        term={consistencyToast?.term ?? ""}
        count={consistencyToast?.count ?? 0}
        onDismiss={() => setConsistencyToast(null)}
        onView={() => {
          setConsistencyToast(null);
          setConsistencyDrawerOpen(true);
        }}
      />

      <ConsistencyRepairDrawer
        open={consistencyDrawerOpen}
        term={consistencyTerm}
        hits={consistencyHits}
        capped={consistencyCapped}
        applying={consistencyApplying}
        results={consistencyResults}
        onClose={() => {
          if (!consistencyApplying) setConsistencyDrawerOpen(false);
        }}
        onCancelApply={() => {
          consistencyCancelRef.current = true;
        }}
        onApply={(selected) => {
          consistencyCancelRef.current = false;
          setConsistencyApplying(true);
          setConsistencyResults([]);
          void (async () => {
            const results: ConsistencyApplyResult[] = [];
            for (const hit of selected) {
              if (consistencyCancelRef.current) break;
              const live =
                segmentsRef.current.find((s) => s.id === hit.segmentId) ?? null;
              const expectedRevision = live?.revision ?? hit.revision;
              try {
                const saved = await window.translunar.invoke(
                  "segment.updateTarget",
                  {
                    segmentId: hit.segmentId,
                    targetText: hit.after,
                    expectedRevision,
                  },
                );
                applySegment(saved);
                results.push({ segmentId: hit.segmentId, ok: true });
              } catch (cause) {
                results.push({
                  segmentId: hit.segmentId,
                  ok: false,
                  error:
                    cause instanceof Error
                      ? cause.message
                      : t("ai.consistency.applyFailed"),
                });
              }
              setConsistencyResults([...results]);
            }
            setConsistencyApplying(false);
          })();
        }}
      />

      {commandPaletteOpen ? (
        <div
          className="editor-overlay"
          role="presentation"
          onMouseDown={closeCommandPalette}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label={t("workbench.commandPalette")}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              closeCommandPalette();
            }}
          >
            <header>
              <Command size={16} />
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.currentTarget.value)}
                placeholder={t("workbench.typeCommand")}
                aria-label={t("workbench.filterCommands")}
              />
              <button
                type="button"
                className="icon-button"
                onClick={closeCommandPalette}
                aria-label={t("workbench.closeCommandPalette")}
              >
                <X size={14} />
              </button>
            </header>
            <div className="command-list" role="listbox">
              {paletteCommands.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  disabled={
                    !isEditorCommandEnabled(
                      command,
                      getEditorCommandContext(),
                      "palette",
                    )
                  }
                  onClick={() => runEditorCommand(command.id, "palette")}
                >
                  <span>
                    <small>{command.group}</small>
                    {command.label}
                  </span>
                  <kbd>
                    {acceleratorLabel(
                      preferences.shortcuts[command.id] ?? command.shortcut,
                    )}
                  </kbd>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {preferencesOpen ? (
        <div
          className="editor-overlay"
          role="presentation"
          onMouseDown={() => setPreferencesOpen(false)}
        >
          <section
            className="editor-dialog preferences-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("workbench.preferencesAria")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>{t("workbench.workspacePreferences")}</small>
                <strong>{t("workbench.editorShortcuts")}</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPreferencesOpen(false)}
                aria-label={t("workbench.closePreferences")}
              >
                <X size={14} />
              </button>
            </header>
            <div className="preference-controls">
              <label>
                Theme
                <select
                  value={preferences.theme}
                  onChange={(event) =>
                    void persistEditorPreferences({
                      ...preferences,
                      theme: event.currentTarget.value,
                    })
                  }
                >
                  <option value="system">{t("workbench.themeSystem")}</option>
                  <option value="light">{t("workbench.themeLight")}</option>
                  <option value="dark">{t("workbench.themeDark")}</option>
                </select>
              </label>
              <label>
                Zoom
                <input
                  type="number"
                  min={75}
                  max={200}
                  step={5}
                  value={preferences.zoom}
                  onChange={(event) =>
                    void persistEditorPreferences({
                      ...preferences,
                      zoom: Number(event.currentTarget.value),
                    })
                  }
                />
              </label>
              {(
                [
                  ["showNonprinting", "Nonprinting marks"],
                  ["autocomplete", "Autocomplete"],
                  ["cjkSpacing", "CJK spacing"],
                  ["punctuationAssistance", "Punctuation assistance"],
                ] as const
              ).map(([key, label]) => (
                <label className="preference-toggle" key={key}>
                  <input
                    type="checkbox"
                    checked={preferences[key]}
                    onChange={(event) =>
                      void persistEditorPreferences({
                        ...preferences,
                        [key]: event.currentTarget.checked,
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div
              className="shortcut-presets"
              role="group"
              aria-label={t("workbench.shortcutPresets")}
            >
              <button
                type="button"
                onClick={() => applyShortcutPreset("default")}
              >
                {t("workbench.default")}
              </button>
              <button
                type="button"
                onClick={() => applyShortcutPreset("trados")}
              >
                Trados
              </button>
              <button
                type="button"
                onClick={() => applyShortcutPreset("memoq")}
              >
                memoQ
              </button>
            </div>
            <div className="shortcut-list">
              {EDITOR_COMMANDS.map((command) => (
                <label key={command.id}>
                  <span>
                    <small>{command.group}</small>
                    {command.label}
                  </span>
                  <input
                    value={shortcutDrafts[command.id] ?? command.shortcut}
                    onChange={(event) =>
                      setShortcutDrafts((current) => ({
                        ...current,
                        [command.id]: event.currentTarget.value,
                      }))
                    }
                    aria-label={`Shortcut for ${command.label}`}
                  />
                </label>
              ))}
            </div>
            <footer>
              <button
                type="button"
                className="confirm-button"
                onClick={() => void saveShortcutPreferences()}
              >
                {t("workbench.saveShortcuts")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {concordanceOpen ? (
        <div
          className="editor-overlay"
          role="presentation"
          onMouseDown={() => setConcordanceOpen(false)}
        >
          <section
            className="editor-dialog concordance-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("tm.concordance")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>{t("common.translationMemory")}</small>
                <strong>{t("tm.concordance")}</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setConcordanceOpen(false)}
                aria-label={t("tm.closeConcordance")}
              >
                <X size={14} />
              </button>
            </header>
            <div className="dialog-query-row">
              <input
                autoFocus
                value={concordanceQuery}
                onChange={(event) =>
                  setConcordanceQuery(event.currentTarget.value)
                }
                aria-label={t("tm.concordanceQuery")}
              />
              <select
                value={concordanceSide}
                onChange={(event) =>
                  setConcordanceSide(
                    event.currentTarget.value as typeof concordanceSide,
                  )
                }
                aria-label={t("tm.concordanceDirection")}
              >
                <option value="both">{t("tm.sourceAndTarget")}</option>
                <option value="source">{t("common.source")}</option>
                <option value="target">{t("common.target")}</option>
              </select>
              <button
                type="button"
                className="confirm-button"
                onClick={() => void runConcordance()}
                disabled={!concordanceQuery.trim() || concordanceBusy}
              >
                {t("home.search")}
              </button>
            </div>
            <div className="concordance-results" aria-live="polite">
              <div className="concordance-result-summary">
                <small>{concordanceTotal} TM results</small>
                <small>{concordanceCorpusTotal} corpus results</small>
              </div>
              {concordanceHits.map((hit) => (
                <article key={`${hit.libraryId}-${hit.unit.id}`}>
                  <header>
                    <strong>{hit.matchedSide}</strong>
                    <small>{hit.libraryId.slice(0, 8)}</small>
                  </header>
                  <p>{hit.unit.sourceText}</p>
                  <p className="match-target">{hit.unit.targetText}</p>
                  <button
                    type="button"
                    onClick={() => {
                      insertMatch(hit.unit.targetText);
                      setConcordanceOpen(false);
                    }}
                  >
                    {t("workbench.insertTarget")}
                  </button>
                </article>
              ))}
              {concordanceCorpusHits.map((hit) => (
                <article
                  className="concordance-corpus-result"
                  key={`${hit.corpus.id}-${hit.entry.id}`}
                >
                  <header>
                    <strong>Corpus · {hit.matchedSide}</strong>
                    <small>{hit.corpus.name}</small>
                  </header>
                  <p>{hit.entry.sourceText || "(no source expression)"}</p>
                  <p className="match-target">
                    {hit.entry.targetText || "(no target expression)"}
                  </p>
                  <div className="concordance-corpus-provenance">
                    <small>
                      {hit.corpus.managedSourcePath
                        ? fileName(hit.corpus.managedSourcePath)
                        : (hit.corpus.sourceDocumentId?.slice(0, 8) ??
                          hit.corpus.alignmentSessionId?.slice(0, 8) ??
                          hit.corpus.sourceKind)}
                    </small>
                    <code>
                      {hit.entry.structuralPath || "No structural path"}
                    </code>
                    <small title={formatCorpusProvenance(hit.entry.provenance)}>
                      {hit.matchKind} · entry {hit.entry.ordinal + 1}
                    </small>
                  </div>
                  {hit.entry.targetText ? (
                    <button
                      type="button"
                      onClick={() => {
                        insertMatch(hit.entry.targetText);
                        setConcordanceOpen(false);
                      }}
                    >
                      {t("workbench.insertTarget")}
                    </button>
                  ) : null}
                </article>
              ))}
              {!concordanceBusy &&
              concordanceHits.length === 0 &&
              concordanceCorpusHits.length === 0 ? (
                <div className="empty-comment">{t("tm.noConcordance")}</div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {sourceCorrectionOpen ? (
        <div
          className="editor-overlay"
          role="presentation"
          onMouseDown={() => setSourceCorrectionOpen(false)}
        >
          <section
            className="editor-dialog source-correction-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("workbench.correctSource")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>{t("workbench.auditedSource")}</small>
                <strong>{t("workbench.correctSource")}</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setSourceCorrectionOpen(false)}
                aria-label={t("workbench.closeSourceCorrection")}
              >
                <X size={14} />
              </button>
            </header>
            <label>
              {t("workbench.correctedSource")}
              <textarea
                autoFocus
                value={sourceCorrectionText}
                onChange={(event) =>
                  setSourceCorrectionText(event.currentTarget.value)
                }
                aria-label={t("workbench.correctedSource")}
              />
            </label>
            <label>
              {t("common.reason")}
              <input
                value={sourceCorrectionReason}
                onChange={(event) =>
                  setSourceCorrectionReason(event.currentTarget.value)
                }
                aria-label={t("workbench.sourceCorrectionReason")}
              />
            </label>
            <footer>
              <button
                type="button"
                className="confirm-button"
                onClick={() => void applySourceCorrection()}
                disabled={
                  !sourceCorrectionReason.trim() ||
                  !sourceCorrectionText.trim() ||
                  sourceCorrectionText === activeSegment?.sourceText
                }
              >
                {t("workbench.applyCorrection")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {chineseConversionOpen ? (
        <div
          className="editor-overlay"
          role="presentation"
          onMouseDown={() => setChineseConversionOpen(false)}
        >
          <section
            className="editor-dialog chinese-conversion-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("workbench.chineseConversion")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>{t("workbench.chineseDicts")}</small>
                <strong>{t("workbench.simplifiedTraditional")}</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setChineseConversionOpen(false)}
                aria-label={t("workbench.closeChinese")}
              >
                <X size={14} />
              </button>
            </header>
            <label>
              {t("workbench.conversionProfile")}
              <select
                autoFocus
                value={chineseConversionProfile}
                onChange={(event) =>
                  setChineseConversionProfile(
                    event.currentTarget.value as ChineseConversionProfile,
                  )
                }
                aria-label={t("workbench.chineseProfile")}
              >
                {CHINESE_CONVERSION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <p>{t("workbench.conversionDescription")}</p>
            <footer>
              <button
                type="button"
                className="confirm-button"
                onClick={() => void convertActiveChinese()}
                disabled={
                  !activeSegment ||
                  !(drafts[activeSegment.id] ?? activeSegment.targetText).trim()
                }
              >
                {t("workbench.applyConversion")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {findOpen ? (
        <div
          className="editor-overlay"
          role="presentation"
          onMouseDown={() => setFindOpen(false)}
        >
          <section
            className="editor-dialog find-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("workbench.findReplace")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>{t("workbench.projectTransform")}</small>
                <strong>{t("workbench.findReplace")}</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFindOpen(false)}
                aria-label={t("workbench.closeFindReplace")}
              >
                <X size={14} />
              </button>
            </header>
            <label>
              Find
              <input
                autoFocus
                value={findQuery}
                onChange={(event) => {
                  setFindQuery(event.currentTarget.value);
                  setReplacePreview(null);
                }}
              />
            </label>
            <label>
              {t("workbench.replaceWith")}
              <input
                value={replacement}
                onChange={(event) => {
                  setReplacement(event.currentTarget.value);
                  setReplacePreview(null);
                }}
              />
            </label>
            <div className="find-options">
              <label>
                {t("common.scope")}
                <select
                  value={findField}
                  onChange={(event) => {
                    setFindField(event.currentTarget.value as typeof findField);
                    setReplacePreview(null);
                  }}
                >
                  <option value="target">{t("common.target")}</option>
                  <option value="source">{t("common.source")}</option>
                  <option value="both">{t("tm.sourceAndTarget")}</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findRegex}
                  onChange={(event) => {
                    setFindRegex(event.currentTarget.checked);
                    setReplacePreview(null);
                  }}
                />
                {t("workbench.regularExpression")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findCaseSensitive}
                  onChange={(event) => {
                    setFindCaseSensitive(event.currentTarget.checked);
                    setReplacePreview(null);
                  }}
                />
                {t("workbench.caseSensitive")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findWholeWord}
                  onChange={(event) => {
                    setFindWholeWord(event.currentTarget.checked);
                    setReplacePreview(null);
                  }}
                />
                {t("workbench.wholeWord")}
              </label>
            </div>
            {replacePreview ? (
              <div className="replace-preview" aria-live="polite">
                <strong>
                  {replacePreview.changedSegments} segments ·{" "}
                  {replacePreview.replacementCount} replacements
                </strong>
                {replacePreview.items.slice(0, 6).map((item) => (
                  <article key={`${item.segmentId}-${item.field}`}>
                    <small>
                      {item.field} · r{item.revision}
                    </small>
                    <del>{item.before}</del>
                    <ins>{item.after}</ins>
                  </article>
                ))}
              </div>
            ) : null}
            <footer>
              <button
                type="button"
                className="secondary-command"
                onClick={() => void previewReplacement()}
                disabled={!findQuery.trim()}
              >
                {t("workbench.preview")}
              </button>
              <button
                type="button"
                className="confirm-button"
                onClick={() => void applyReplacement()}
                disabled={!replacePreview?.items.length}
              >
                {t("workbench.applyUnchanged")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {commentsOpen ? (
        <aside
          className="comments-sheet"
          aria-label={t("workbench.segmentComments")}
        >
          <header>
            <div>
              <small>
                Segment {activeSegment ? activeSegment.ordinal + 1 : "—"}
              </small>
              <strong>{t("common.comments")}</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setCommentsOpen(false)}
              aria-label={t("workbench.closeComments")}
            >
              <X size={14} />
            </button>
          </header>
          <div className="comment-thread">
            {activeEditorRow?.comments.length ? (
              activeEditorRow.comments.map((comment) => (
                <article
                  className={comment.resolved ? "resolved" : ""}
                  key={comment.id}
                >
                  <header>
                    <strong>{comment.author}</strong>
                    <small>
                      {comment.immutable
                        ? t("workbench.importNote")
                        : `r${comment.revision}`}
                    </small>
                  </header>
                  {editingCommentId === comment.id ? (
                    <label className="comment-editor">
                      {t("workbench.editComment")}
                      <textarea
                        autoFocus
                        value={commentEditText}
                        onChange={(event) =>
                          setCommentEditText(event.currentTarget.value)
                        }
                        aria-label={t("workbench.editedComment")}
                      />
                    </label>
                  ) : (
                    <p>{comment.text}</p>
                  )}
                  {!comment.immutable ? (
                    <footer className="comment-actions">
                      {editingCommentId === comment.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCommentId(null);
                              setCommentEditText("");
                            }}
                          >
                            {t("common.cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateComment(comment)}
                            disabled={
                              !commentEditText.trim() ||
                              commentEditText.trim() === comment.text
                            }
                          >
                            {t("workbench.saveEdit")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCommentId(comment.id);
                            setCommentEditText(comment.text);
                          }}
                        >
                          {t("common.edit")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={editingCommentId === comment.id}
                        onClick={() =>
                          void setCommentResolved(
                            comment.id,
                            comment.revision,
                            !comment.resolved,
                          )
                        }
                      >
                        {comment.resolved
                          ? t("workbench.reopen")
                          : t("workbench.resolve")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteComment(comment)}
                      >
                        {t("common.delete")}
                      </button>
                    </footer>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-comment">{t("workbench.noComments")}</div>
            )}
          </div>
          <footer>
            <textarea
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.currentTarget.value)}
              placeholder={t("workbench.addDurableComment")}
              aria-label={t("workbench.newComment")}
            />
            <button
              type="button"
              onClick={() => void createComment()}
              disabled={!commentDraft.trim()}
              aria-label={t("workbench.addComment")}
            >
              <Send size={14} />
            </button>
          </footer>
        </aside>
      ) : null}

      {directSignoffOpen ? (
        <div className="surface-dialog-backdrop">
          <section
            className="surface-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="direct-signoff-title"
          >
            <span className="surface-kicker">
              {t("workbench.reviewBypass")}
            </span>
            <h2 id="direct-signoff-title">{t("workbench.signOffDirectly")}</h2>
            <p>{t("workbench.mandatoryDisabled")}</p>
            <label>
              {t("common.actor")}
              <input
                autoFocus
                value={directSignoffActor}
                onChange={(event) =>
                  setDirectSignoffActor(event.currentTarget.value)
                }
              />
            </label>
            <label>
              {t("common.reason")}
              <textarea
                value={directSignoffReason}
                onChange={(event) =>
                  setDirectSignoffReason(event.currentTarget.value)
                }
              />
            </label>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={() => setDirectSignoffOpen(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="button primary"
                disabled={
                  !directSignoffActor.trim() || !directSignoffReason.trim()
                }
                onClick={() => void confirmDirectSignoff()}
              >
                {t("workbench.signOff")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {reviewOpen ? (
        <aside
          className="comments-sheet review-sheet"
          aria-label={t("workbench.reviewRevisions")}
        >
          <header>
            <div>
              <small>{t("workbench.localReview")}</small>
              <strong>{t("workbench.reviewRevisions")}</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setReviewOpen(false)}
              aria-label={t("workbench.closeReview")}
            >
              <X size={14} />
            </button>
          </header>
          <div className="comment-thread review-thread">
            <div
              className="workflow-controls"
              role="group"
              aria-label={t("workbench.workflowState")}
            >
              {(["translation", "review", "signed"] as const).map((state) => (
                <button
                  type="button"
                  key={state}
                  aria-pressed={activeEditorRow?.workflowState === state}
                  disabled={activeEditorRow?.workflowState === state}
                  onClick={() => requestWorkflowState(state)}
                >
                  {state}
                </button>
              ))}
            </div>
            {reviews
              .filter((review) => review.segmentId === activeSegment?.id)
              .map((review) => (
                <article
                  key={review.id}
                  className={review.status === "pending" ? "" : "resolved"}
                >
                  <header>
                    <strong>{review.author}</strong>
                    <small>{review.status}</small>
                  </header>
                  {review.proposedSource ? (
                    <div>
                      <small>{t("workbench.sourceRevision")}</small>
                      <WordDiff
                        before={review.beforeSource ?? ""}
                        after={review.proposedSource ?? ""}
                      />
                    </div>
                  ) : null}
                  <small>{t("workbench.targetRevision")}</small>
                  <WordDiff
                    before={review.beforeTarget}
                    after={review.proposedTarget}
                  />
                  {review.proposedTargetTags ? (
                    <p>
                      {review.proposedTargetTags.length} protected tags proposed
                    </p>
                  ) : null}
                  {review.reason ? <p>{review.reason}</p> : null}
                  {review.status === "pending" ? (
                    <footer className="review-actions">
                      <button
                        type="button"
                        onClick={() => void decideReview(review, "reject")}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => void decideReview(review, "accept")}
                      >
                        Accept
                      </button>
                    </footer>
                  ) : null}
                </article>
              ))}
            {!reviews.some(
              (review) => review.segmentId === activeSegment?.id,
            ) ? (
              <div className="empty-comment">
                {t("workbench.noReviewProposals")}
              </div>
            ) : null}
          </div>
          <footer className="review-composer">
            <textarea
              value={reviewSource}
              onChange={(event) => setReviewSource(event.currentTarget.value)}
              placeholder={t("workbench.proposedSource")}
              aria-label={t("workbench.proposedSource")}
            />
            <textarea
              value={reviewTarget}
              onChange={(event) => setReviewTarget(event.currentTarget.value)}
              placeholder={t("workbench.proposedTarget")}
              aria-label={t("workbench.proposedTarget")}
            />
            <label className="review-tag-option">
              <input
                type="checkbox"
                checked={reviewCopyTags}
                onChange={(event) =>
                  setReviewCopyTags(event.currentTarget.checked)
                }
              />
              {t("workbench.proposeTags")}
            </label>
            <button
              type="button"
              onClick={() => void createReview()}
              aria-label={t("workbench.createReview")}
            >
              <GitCompareArrows size={14} />
            </button>
          </footer>
        </aside>
      ) : null}

      {/* 旧状态条已移除：段计数/状态计数/保存态由 Shell 的 Instrument Strip
          承载（见 components/shell/InstrumentStrip.tsx），
          实时值通过 onStatusChange 上报。 */}

      {toast ? (
        <button className="toast" type="button" onClick={() => setToast(null)}>
          {toast}
        </button>
      ) : null}
    </div>
  );
}

function StatusLamp({
  segment,
  hasIssue,
  justConfirmed,
}: {
  segment: Segment;
  hasIssue: boolean;
  justConfirmed?: boolean;
}) {
  const state = hasIssue ? "issues" : segment.state;
  const label = hasIssue
    ? "Issues"
    : state[0]?.toLocaleUpperCase() + state.slice(1);
  return (
    <span
      className={`status-lamp ${state}${justConfirmed ? " just-confirmed" : ""}`}
    >
      <i />
      {label}
    </span>
  );
}

function TaggedText({
  text,
  tags,
  showNonprinting,
  highlightedPairKey,
  onPairHover,
}: {
  text: string;
  tags: InlineTag[];
  showNonprinting: boolean;
  highlightedPairKey?: string | null;
  onPairHover?: (pairKey: string | null) => void;
}) {
  const characters = Array.from(text);
  const tagsByPosition = new Map<number, InlineTag[]>();
  for (const tag of tags) {
    const items = tagsByPosition.get(tag.position) ?? [];
    items.push(tag);
    tagsByPosition.set(tag.position, items);
  }
  const content: ReactNode[] = [];
  for (let position = 0; position <= characters.length; position += 1) {
    for (const tag of tagsByPosition.get(position) ?? []) {
      const pairKey = tag.pairId?.trim() ? tag.pairId : tag.id;
      content.push(
        <span
          className="tag-capsule source-tag"
          key={`${tag.id}-${position}`}
          tabIndex={0}
          title={tag.displayText || tag.kind}
          data-pair-key={pairKey}
          data-paired-highlight={
            highlightedPairKey && highlightedPairKey === pairKey
              ? ""
              : undefined
          }
          onMouseEnter={() => onPairHover?.(pairKey)}
          onMouseLeave={() => onPairHover?.(null)}
          onFocus={() => onPairHover?.(pairKey)}
          onBlur={() => onPairHover?.(null)}
        >
          {tag.displayText || tag.kind}
        </span>,
      );
    }
    const character = characters[position];
    if (character !== undefined) {
      content.push(
        <span
          className={
            showNonprinting && /\s/u.test(character) ? "nonprinting" : undefined
          }
          key={`character-${position}`}
        >
          {showNonprinting
            ? character === " "
              ? "·"
              : character === "\n"
                ? "↵\n"
                : character === "\t"
                  ? "→"
                  : character
            : character}
        </span>,
      );
    }
  }
  return (
    <div className="tagged-text" aria-label={text}>
      {content}
    </div>
  );
}

function WordDiff({ before, after }: { before: string; after: string }) {
  const { t } = useLocale();
  const beforeWords = before.split(/(\s+)/u);
  const afterWords = after.split(/(\s+)/u);
  let prefix = 0;
  while (
    prefix < beforeWords.length &&
    prefix < afterWords.length &&
    beforeWords[prefix] === afterWords[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeWords.length - prefix &&
    suffix < afterWords.length - prefix &&
    beforeWords[beforeWords.length - 1 - suffix] ===
      afterWords[afterWords.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const sharedPrefix = beforeWords.slice(0, prefix).join("");
  const sharedSuffix = suffix
    ? beforeWords.slice(beforeWords.length - suffix).join("")
    : "";
  const removed = beforeWords
    .slice(prefix, beforeWords.length - suffix)
    .join("");
  const added = afterWords.slice(prefix, afterWords.length - suffix).join("");
  return (
    <div
      className="word-diff"
      aria-label={t("workbench.changedFrom", { before, after })}
    >
      <span>{sharedPrefix}</span>
      {removed ? <del>{removed}</del> : null}
      {added ? <ins>{added}</ins> : null}
      <span>{sharedSuffix}</span>
    </div>
  );
}

function tagIdentity(tag: InlineTag): string {
  return [tag.kind, tag.pairId ?? "", tag.payload, tag.displayText].join(
    "\u0000",
  );
}

function canonicalTargetTags(
  sourceTags: InlineTag[],
  targetTags: InlineTag[],
): InlineTag[] {
  const available = new Map<string, InlineTag[]>();
  for (const source of sourceTags) {
    const key = tagIdentity(source);
    available.set(key, [...(available.get(key) ?? []), source]);
  }
  return targetTags.map((target) => {
    const candidates = available.get(tagIdentity(target)) ?? [];
    const source = candidates.shift();
    return {
      ...(source ?? target),
      id: source?.id ?? target.id,
      side: "target",
      position: target.position,
    };
  });
}

function missingSourceTags(
  sourceTags: InlineTag[],
  targetTags: InlineTag[],
): InlineTag[] {
  const remaining = new Map<string, number>();
  for (const tag of targetTags) {
    const key = tagIdentity(tag);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return [...sourceTags]
    .sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id),
    )
    .filter((tag) => {
      const key = tagIdentity(tag);
      const count = remaining.get(key) ?? 0;
      if (count === 0) return true;
      remaining.set(key, count - 1);
      return false;
    });
}

function copySourceTagLayout(
  sourceTags: InlineTag[],
  target: string,
): InlineTag[] {
  const targetLength = Array.from(target).length;
  const ordered = [...sourceTags].sort(
    (left, right) =>
      left.position - right.position || left.id.localeCompare(right.id),
  );
  const denominator = Math.max(1, ordered.length - 1);
  return ordered.map((tag, index) => ({
    ...tag,
    side: "target",
    position: Math.floor((index * targetLength) / denominator),
  }));
}

function utf16OffsetToScalar(value: string, offset: number): number {
  return Array.from(value.slice(0, Math.max(0, offset))).length;
}

function canMergeSplitSiblings(first: Segment, second: Segment): boolean {
  const firstMatch = /^(.*)#split:([^:]+):1$/u.exec(first.structuralPath);
  const secondMatch = /^(.*)#split:([^:]+):2$/u.exec(second.structuralPath);
  return Boolean(
    firstMatch &&
    secondMatch &&
    firstMatch[1] === secondMatch[1] &&
    firstMatch[2] === secondMatch[2] &&
    second.ordinal === first.ordinal + 1,
  );
}

function readWorkbenchPreferences(): WorkbenchPreferences {
  const defaults: WorkbenchPreferences = {
    suggestionsMode: "docked",
    previewMode: "docked",
    previewHeight: PREVIEW_DEFAULT_HEIGHT,
    followActivePreview: true,
  };
  try {
    const stored = localStorage.getItem(WORKBENCH_PREFERENCES_KEY);
    if (!stored) return defaults;
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null) return defaults;
    const suggestionsMode =
      "suggestionsMode" in value && isPanelMode(value.suggestionsMode)
        ? value.suggestionsMode
        : defaults.suggestionsMode;
    const previewMode =
      "previewMode" in value && isPanelMode(value.previewMode)
        ? value.previewMode
        : defaults.previewMode;
    const previewHeight =
      "previewHeight" in value && typeof value.previewHeight === "number"
        ? clampPreviewHeight(value.previewHeight)
        : defaults.previewHeight;
    const followActivePreview =
      "followActivePreview" in value &&
      typeof value.followActivePreview === "boolean"
        ? value.followActivePreview
        : defaults.followActivePreview;
    return {
      suggestionsMode,
      previewMode,
      previewHeight,
      followActivePreview,
    };
  } catch {
    return defaults;
  }
}

function isPanelMode(value: unknown): value is PanelMode {
  return value === "docked" || value === "collapsed" || value === "maximized";
}

function documentQuery<ElementType extends Element>(
  selector: string,
): ElementType | null {
  return window.document.querySelector<ElementType>(selector);
}
