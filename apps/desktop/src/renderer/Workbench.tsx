import {
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
  InlineTag,
  PdfPageDetail,
  PdfPageSummary,
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
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Command,
  Combine,
  Database,
  Download,
  FileText,
  GitCompareArrows,
  Languages,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Split,
  Sparkles,
  Tags,
  X,
} from "lucide-react";

import { AssistantPanel } from "./AssistantPanel";
import { formatCorpusProvenance } from "./alignment-corpus-utils";
import { BrandMark } from "./BrandMark";
import { clearSegmentDrafts, writeSegmentDraft } from "./draft-persist";
import {
  EDITOR_COMMANDS,
  acceleratorLabel,
  commandById,
  dispatchEditorCommand,
  isEditorCommandEnabled,
  shortcutMatches,
  type EditorCommandContext,
  type EditorCommandHandlers,
  type EditorCommandId,
  type EditorCommandInvocation,
} from "./editor-commands";
import type { AppSurface } from "./surface-types";
import { useLocale } from "./i18n/LocaleProvider";
import type { MessageKey } from "./i18n/messages";
import {
  clampPreviewHeight,
  fileName,
  formatError,
  isConfirmShortcut,
  nextVisibleSegmentId,
  PREVIEW_DEFAULT_HEIGHT,
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MIN_HEIGHT,
  replaceSegment,
  togglePanelCollapsed,
  togglePanelMaximized,
  type PanelMode,
} from "./workbench-utils";

const WORKBENCH_PREFERENCES_KEY = "translunar.workbench-preferences.v1";
const EDITOR_WINDOW_SIZE = 100;
const EDITOR_ROW_HEIGHT = 112;
const EDITOR_OVERSCAN = 18;

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
  onReturnHome(): void;
  onNavigate(surface: AppSurface): Promise<void>;
  focusSegmentId: string | null;
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
type SuggestionTab = "matches" | "terms" | "assistant" | "qa";
type SaveState = "saved" | "saving" | "error";

interface WorkbenchPreferences {
  suggestionsMode: PanelMode;
  previewMode: PanelMode;
  previewHeight: number;
  followActivePreview: boolean;
}

export function Workbench({
  initialWorkspace,
  onReturnHome,
  onNavigate,
  focusSegmentId,
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
  const [termMatches, setTermMatches] = useState<TermMatch[]>([]);
  const [filter, setFilter] = useState<SegmentFilter>("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState(segments[0]?.id ?? "");
  const [suggestionTab, setSuggestionTab] = useState<SuggestionTab>("matches");
  const [suggestionsMode, setSuggestionsMode] = useState<PanelMode>(
    initialPreferences.suggestionsMode,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
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
  const [spellFindings, setSpellFindings] = useState<SpellFinding[]>([]);
  const [spellProvider, setSpellProvider] = useState("unavailable");
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
  const editorWindowRequestRef = useRef(0);
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
  const activeIssue = activeSegment
    ? openIssueBySegment.get(activeSegment.id)
    : undefined;
  const openIssueIds = useMemo(
    () =>
      segments
        .filter((segment) => openIssueBySegment.has(segment.id))
        .map((segment) => segment.id),
    [openIssueBySegment, segments],
  );

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    editorRowsRef.current = editorRows;
  }, [editorRows]);

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
    setTermMatches([]);
    setSpellFindings([]);
    setSpellProvider("unavailable");
    setSaveState("saved");
    setToast(null);
    setActionBusy(null);
    setSelectedTargetTagId(null);
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

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values())
        window.clearTimeout(timer);
    };
  }, []);

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
    if (!activeSegment) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    void window.translunar
      .invoke("tm.lookupExact", {
        projectId: snapshot.project.id,
        sourceText: activeSegment.sourceText,
      })
      .then((result) => {
        if (!cancelled) setMatches(result.matches);
      })
      .catch((error: unknown) => {
        if (!cancelled) setToast(formatError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [activeSegment, snapshot.project.id]);

  useEffect(() => {
    if (!activeSegment) {
      setTermMatches([]);
      return;
    }
    let cancelled = false;
    void window.translunar
      .invoke("term.search", {
        projectId: snapshot.project.id,
        text: activeSegment.sourceText,
        offset: 0,
        limit: 50,
      })
      .then((result) => {
        if (!cancelled) setTermMatches(result.matches);
      })
      .catch((error: unknown) => {
        if (!cancelled) setToast(formatError(error));
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
    } catch (error) {
      if (
        workspaceGenerationRef.current === generation &&
        editorWindowRequestRef.current === requestId
      ) {
        setToast(formatError(error));
      }
    } finally {
      if (
        workspaceGenerationRef.current === generation &&
        editorWindowRequestRef.current === requestId
      ) {
        setEditorLoading(false);
      }
    }
  };

  const onEditorScroll = (event: UIEvent<HTMLDivElement>) => {
    if (editorTotal <= EDITOR_WINDOW_SIZE) return;
    const firstVisible = Math.floor(
      event.currentTarget.scrollTop / EDITOR_ROW_HEIGHT,
    );
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
    const result = await window.translunar.invoke("tm.lookupExact", {
      projectId: snapshot.project.id,
      sourceText: segment.sourceText,
    });
    setMatches(result.matches);
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
      setSuggestionTab("qa");
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

  const navigateToSurface = async (surface: AppSurface) => {
    setActionBusy("navigate");
    setToast(null);
    try {
      await persistAllSegments();
      setMenuOpen(false);
      await onNavigate(surface);
    } catch (error) {
      setToast(formatError(error));
    } finally {
      setActionBusy(null);
    }
  };

  const returnHome = async () => {
    setActionBusy("navigate");
    setToast(null);
    try {
      await persistAllSegments();
      onReturnHome();
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

  const insertMatch = (targetText: string) => {
    if (!activeSegment) return;
    if (composingRef.current.has(activeSegment.id)) return;
    updateDraft(activeSegment.id, targetText);
    scheduleSave(activeSegment.id, 80);
    documentQuery<HTMLTextAreaElement>(
      `[data-editor-for="${activeSegment.id}"]`,
    )?.focus();
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
              "editor.concordance": "Ctrl+Shift+K",
            }
          : {};
    setShortcutDrafts({ ...defaults, ...overrides });
  };

  const saveShortcutPreferences = async () => {
    const bindings = EDITOR_COMMANDS.map((command) =>
      (shortcutDrafts[command.id] ?? command.shortcut).trim(),
    );
    if (bindings.some((binding) => !binding)) {
      setToast("Shortcut bindings cannot be empty.");
      return;
    }
    const normalized = bindings.map((binding) => binding.toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      setToast("Shortcut bindings must not collide.");
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
    if (!activeSegment) return;
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
    if (!activeSegment) return;
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
    if (!activeSegment) return;
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
    openChineseConversion: () => setChineseConversionOpen(true),
    openComments: () => setCommentsOpen(true),
    openReview: () => void openReviewPanel(),
    advanceWorkflow: () => void advanceWorkflow(),
    insertSuggestion: (index) => {
      const match = matches[index];
      if (match) insertMatch(match.targetText);
    },
    undo: () => void undoEditor(),
    redo: () => void redoEditor(),
    openPalette: () => setCommandPaletteOpen(true),
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
      setCommandPaletteOpen(false);
      return;
    }
    dispatchEditorCommand(id, editorCommandHandlers);
    if (id !== "editor.palette") setCommandPaletteOpen(false);
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
      <header className="app-bar">
        <div className="project-identity">
          <BrandMark />
          <div>
            <strong>{snapshot.project.name}</strong>
            <span>
              {snapshot.project.domain || t("workbench.translationProject")}
            </span>
          </div>
        </div>
        <div
          className="document-switcher"
          aria-label={t("workbench.activeDocument")}
        >
          <FileText size={15} />
          <span>{document.name}</span>
          <small>{t("workbench.segmentsCount", { count: counts.total })}</small>
        </div>
        <label className="project-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={t("workbench.searchPlaceholder")}
            aria-label={t("workbench.searchPlaceholder")}
          />
        </label>
        <div className="app-actions">
          <button
            id="tutorial-target-qa"
            className="top-command"
            type="button"
            onClick={runQa}
            disabled={actionBusy !== null}
          >
            <ShieldCheck size={15} />
            {t("workbench.runQa")}
          </button>
          <button
            id="tutorial-target-export"
            className="top-command export-command"
            type="button"
            onClick={exportDocument}
            disabled={actionBusy !== null}
          >
            <Download size={15} />
            {t("action.export")}
          </button>
          <div className="surface-menu-wrap">
            <button
              className="icon-button dark"
              type="button"
              title={t("common.moreActions")}
              aria-label={t("common.moreActions")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={17} />
            </button>
            {menuOpen ? (
              <nav
                className="surface-menu"
                aria-label={t("nav.applicationViews")}
              >
                <span>{t("common.views")}</span>
                <button type="button" aria-current="page" disabled>
                  {t("nav.workbench")}
                </button>
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("qa-review")}
                >
                  {t("nav.qaReview")}
                </button>
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("export-review")}
                >
                  {t("nav.exportReview")}
                </button>
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("translation-memory")}
                >
                  {t("common.translationMemory")}
                </button>
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("ai-control")}
                >
                  {t("nav.aiControl")}
                </button>
                <hr />
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("project-insights")}
                >
                  {t("nav.projectInsights")}
                </button>
                <hr />
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void returnHome()}
                >
                  {t("nav.projects")}
                </button>
              </nav>
            ) : null}
          </div>
        </div>
      </header>
      <div className="translunar-band" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <main className="workbench-layout">
        <section
          id="tutorial-target-edit"
          className="editor-region"
          tabIndex={-1}
        >
          <div className="editor-toolbar">
            <div
              className="filter-group"
              role="group"
              aria-label={t("workbench.segmentFilters")}
            >
              <FilterButton
                label={t("workbench.filterAll")}
                count={counts.total}
                value="all"
                active={filter}
                onChange={setFilter}
              />
              <FilterButton
                label={t("workbench.filterUntranslated")}
                count={counts.untranslated}
                value="untranslated"
                active={filter}
                onChange={setFilter}
              />
              <FilterButton
                label={t("workbench.filterDraft")}
                count={counts.draft}
                value="draft"
                active={filter}
                onChange={setFilter}
              />
              <FilterButton
                label={t("workbench.filterConfirmed")}
                count={counts.confirmed}
                value="confirmed"
                active={filter}
                onChange={setFilter}
              />
              <FilterButton
                label={t("workbench.filterIssues")}
                count={counts.openIssues}
                value="issues"
                active={filter}
                onChange={setFilter}
              />
              <select
                value={
                  filter === "tagged" || filter === "commented" ? filter : ""
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
                <option value="commented">{t("workbench.commented")}</option>
              </select>
            </div>
            <div
              className="match-scope"
              aria-label={t("workbench.exactTmMatching")}
            >
              <Database size={13} />
              <span>{t("workbench.exactTm")}</span>
            </div>
            <div
              className="editor-command-strip"
              role="toolbar"
              aria-label={t("workbench.editorCommands")}
            >
              <button
                type="button"
                className="icon-button"
                onClick={() => setCommandPaletteOpen(true)}
                title={t("workbench.commandPalette")}
                aria-label={t("workbench.openCommandPalette")}
              >
                <Command size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFindOpen(true)}
                title={t("workbench.findReplace")}
                aria-label={t("workbench.openFindReplace")}
              >
                <Search size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void undoEditor()}
                title={t("common.undo")}
                aria-label={t("workbench.undoAria")}
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void redoEditor()}
                title={t("common.redo")}
                aria-label={t("workbench.redoAria")}
              >
                <RotateCw size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setCommentsOpen(true)}
                title={t("common.comments")}
                aria-label={t("workbench.openComments")}
              >
                <MessageSquare size={14} />
              </button>
            </div>
            <div className="issue-nav" aria-label={t("workbench.issueNav")}>
              <span>{t("common.issue")}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => navigateIssue(-1)}
                disabled={!openIssueIds.length}
                title={t("workbench.prevIssue")}
                aria-label={t("workbench.prevIssue")}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="issue-position">
                {t("common.positionOf", {
                  position: issuePosition,
                  total: openIssueIds.length,
                })}
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => navigateIssue(1)}
                disabled={!openIssueIds.length}
                title={t("workbench.nextIssue")}
                aria-label={t("workbench.nextIssue")}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            {activeSegment ? (
              <button
                className="confirm-button"
                type="button"
                onClick={() => confirmSegment(activeSegment.id)}
                disabled={
                  actionBusy !== null ||
                  activeEditorRow?.workflowState === "signed"
                }
              >
                <Check size={14} />
                {t("workbench.confirm")}
              </button>
            ) : null}
          </div>

          <div className="editor-body">
            <div
              className="segment-grid"
              role="region"
              aria-label={t("workbench.segmentsAria")}
              aria-busy={editorLoading}
              ref={editorGridRef}
              onScroll={onEditorScroll}
            >
              <table>
                <thead>
                  <tr>
                    <th className="id-column">ID</th>
                    <th className="status-column">{t("common.status")}</th>
                    <th>
                      {t("workbench.sourceColumn", {
                        locale: snapshot.project.sourceLocale,
                      })}
                    </th>
                    <th>
                      {t("workbench.targetColumn", {
                        locale: snapshot.project.targetLocale,
                      })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {editorOffset > 0 ? (
                    <tr className="virtual-spacer" aria-hidden="true">
                      <td
                        colSpan={4}
                        style={{ height: editorOffset * EDITOR_ROW_HEIGHT }}
                      />
                    </tr>
                  ) : null}
                  {visibleSegments.map((segment) => {
                    const issue = openIssueBySegment.get(segment.id);
                    const active = segment.id === activeId;
                    const segmentIndex = visibleSegments.findIndex(
                      (candidate) => candidate.id === segment.id,
                    );
                    const nextSegment = visibleSegments[segmentIndex + 1];
                    const mergeEligible = Boolean(
                      nextSegment &&
                      canMergeSplitSiblings(segment, nextSegment),
                    );
                    const editorRow = editorRows.find(
                      (row) => row.segment.id === segment.id,
                    );
                    const autocomplete = active
                      ? autocompleteForSegment(segment.id)
                      : null;
                    return (
                      <tr
                        key={segment.id}
                        className={active ? "segment-row active" : "segment-row"}
                        data-segment-row={segment.id}
                        aria-rowindex={segment.ordinal + 2}
                        onClick={() => setActiveId(segment.id)}
                      >
                        <td className="id-cell">{segment.ordinal + 1}</td>
                        <td className="status-cell">
                          <StatusLamp
                            segment={segment}
                            hasIssue={Boolean(issue)}
                          />
                        </td>
                        <td className="source-cell">
                          <TaggedText
                            text={segment.sourceText}
                            tags={editorRow?.sourceTags ?? []}
                            showNonprinting={preferences.showNonprinting}
                          />
                        </td>
                        <td className="target-cell">
                          {active ? (
                            <div
                              className="segment-tools"
                              role="toolbar"
                              aria-label={t("workbench.segmentTools")}
                            >
                              <button
                                type="button"
                                onClick={() => void copyProtectedTags()}
                                aria-label={t("workbench.copyTags")}
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Tags size={12} />
                                {t("workbench.tags")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void insertProtectedTag(false)}
                                aria-label={t("workbench.insertTag")}
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Tags size={12} />+
                              </button>
                              <button
                                type="button"
                                onClick={() => void insertProtectedTag(true)}
                                aria-label={t("workbench.insertTagPair")}
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Tags size={12} />±
                              </button>
                              <button
                                type="button"
                                onClick={() => void splitActiveSegment()}
                                aria-label={t("workbench.splitSegment")}
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Split size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void mergeActiveSegment()}
                                aria-label={t("workbench.mergeNext")}
                                disabled={
                                  !mergeEligible ||
                                  editorRow?.workflowState === "signed"
                                }
                                title={
                                  mergeEligible
                                    ? "Merge split siblings"
                                    : "Only sibling segments created by Split can be merged safely"
                                }
                              >
                                <Combine size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={openSourceCorrection}
                                aria-label={t("workbench.correctSource")}
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setChineseConversionOpen(true)}
                                aria-label={t("workbench.openChinese")}
                                disabled={
                                  editorRow?.workflowState === "signed" ||
                                  !(
                                    drafts[segment.id] ?? segment.targetText
                                  ).trim()
                                }
                              >
                                <Languages size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setCommentsOpen(true)}
                                aria-label={t("workbench.openCommentsShort")}
                              >
                                <MessageSquare size={12} />
                                {editorRow?.comments.filter(
                                  (comment) => !comment.resolved,
                                ).length ?? 0}
                              </button>
                              <button
                                type="button"
                                onClick={() => void openReviewPanel()}
                                aria-label={t("workbench.openReview")}
                              >
                                <GitCompareArrows size={12} />
                                {editorRow?.workflowState}
                              </button>
                            </div>
                          ) : null}
                          {editorRow?.targetTags.length ? (
                            <div
                              className="target-tag-strip"
                              aria-label={t("workbench.targetTags")}
                            >
                              {editorRow.targetTags.map((tag) => (
                                <button
                                  type="button"
                                  className={
                                    selectedTargetTagId === tag.id
                                      ? "tag-capsule selected"
                                      : "tag-capsule"
                                  }
                                  key={tag.id}
                                  onClick={() => setSelectedTargetTagId(tag.id)}
                                  disabled={
                                    editorRow.workflowState === "signed"
                                  }
                                  aria-label={t(
                                    "workbench.selectProtectedTag",
                                    {
                                      tag: tag.displayText || tag.kind,
                                      position: tag.position,
                                    },
                                  )}
                                  title={t("workbench.moveTagHint")}
                                >
                                  {tag.displayText || tag.kind}
                                  <small>{tag.position}</small>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <textarea
                            data-editor-for={segment.id}
                            value={drafts[segment.id] ?? segment.targetText}
                            placeholder={t("workbench.untranslated")}
                            aria-label={t("workbench.targetSegment", {
                              ordinal: segment.ordinal + 1,
                            })}
                            aria-invalid={Boolean(issue)}
                            disabled={editorRow?.workflowState === "signed"}
                            onFocus={() => setActiveId(segment.id)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              updateDraft(
                                segment.id,
                                event.currentTarget.value,
                              );
                              if (!composingRef.current.has(segment.id))
                                scheduleSave(segment.id);
                            }}
                            onCompositionStart={() =>
                              onCompositionStart(segment.id)
                            }
                            onCompositionEnd={(event) =>
                              onCompositionEnd(event, segment.id)
                            }
                            onKeyDown={(event) =>
                              onTargetKeyDown(event, segment.id)
                            }
                          />
                          {autocomplete ? (
                            <button
                              type="button"
                              className="autocomplete-tail"
                              onClick={(event) => {
                                event.stopPropagation();
                                updateDraft(
                                  segment.id,
                                  autocomplete.targetText,
                                );
                                scheduleSave(segment.id, 80);
                              }}
                              aria-label={t("workbench.acceptAutocomplete", {
                                provider: autocomplete.provider,
                              })}
                            >
                              <small>{autocomplete.provider}</small>
                              <span>{autocomplete.tail}</span>
                              <kbd>{t("workbench.tab")}</kbd>
                            </button>
                          ) : null}
                          {issue ? (
                            <span className="inline-issue">
                              <AlertTriangle size={12} />
                              {issue.message}
                            </span>
                          ) : null}
                          {(drafts[segment.id] ?? segment.targetText).trim()
                            ? editorRow?.tagIssues.map((tagIssue) => (
                                <span
                                  className="inline-issue tag-issue"
                                  key={`${tagIssue.code}-${tagIssue.tagId ?? "all"}`}
                                >
                                  <Tags size={12} />
                                  {tagIssue.message}
                                </span>
                              ))
                            : null}
                          {active && spellFindings.length ? (
                            <div
                              className="spell-findings"
                              aria-label={t("workbench.spellFindingsFrom", {
                                provider: spellProvider,
                              })}
                            >
                              {spellFindings.slice(0, 4).map((finding) => (
                                <button
                                  key={`${finding.provider}-${finding.start}-${finding.word}`}
                                  type="button"
                                  onClick={() =>
                                    void addDictionaryFinding(finding)
                                  }
                                  title={t("workbench.addDictionary")}
                                >
                                  <AlertTriangle size={10} />
                                  {finding.word}
                                  <small>{finding.provider}</small>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {editorTotal > editorOffset + visibleSegments.length ? (
                    <tr className="virtual-spacer" aria-hidden="true">
                      <td
                        colSpan={4}
                        style={{
                          height:
                            (editorTotal -
                              editorOffset -
                              visibleSegments.length) *
                            EDITOR_ROW_HEIGHT,
                        }}
                      />
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {visibleSegments.length === 0 ? (
                <div className="empty-grid">
                  {t("workbench.noSegmentsMatch")}
                </div>
              ) : null}
            </div>
            <DocumentPreview
              document={document}
              activeSegment={activeSegment}
              segments={segments}
              mode={previewMode}
              onModeChange={setPreviewMode}
              height={previewHeight}
              onHeightChange={setPreviewHeight}
              followActive={followActivePreview}
              onFollowActiveChange={setFollowActivePreview}
              onSourceCorrected={applyCorrectedSource}
            />
          </div>
        </section>

        <SuggestionsPanel
          projectId={snapshot.project.id}
          mode={suggestionsMode}
          onModeChange={setSuggestionsMode}
          tab={suggestionTab}
          onTabChange={setSuggestionTab}
          activeSegment={activeSegment}
          activeIssue={activeIssue}
          issues={issues}
          matches={matches}
          termMatches={termMatches}
          onInsert={insertMatch}
          onApplyMutation={applyEditorMutation}
        />
      </main>

      {commandPaletteOpen ? (
        <div
          className="editor-overlay"
          role="presentation"
          onMouseDown={() => setCommandPaletteOpen(false)}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label={t("workbench.commandPalette")}
            onMouseDown={(event) => event.stopPropagation()}
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
                onClick={() => setCommandPaletteOpen(false)}
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

      <footer className="status-bar">
        <span>
          Segment{" "}
          <strong>{activeSegment ? activeSegment.ordinal + 1 : 0}</strong> of{" "}
          {counts.total}
        </span>
        <div className="status-counts">
          <StatusCount
            className="confirmed"
            value={counts.confirmed}
            label="confirmed"
          />
          <StatusCount className="draft" value={counts.draft} label="draft" />
          <StatusCount
            className="untranslated"
            value={counts.untranslated}
            label="untranslated"
          />
          <StatusCount
            className="issues"
            value={counts.openIssues}
            label="QA issues"
          />
        </div>
        <span className={`save-indicator ${saveState}`}>
          {saveState === "saving" ? (
            <RefreshCw size={12} />
          ) : saveState === "error" ? (
            <AlertTriangle size={12} />
          ) : (
            <CheckCircle2 size={12} />
          )}
          {saveState === "saving"
            ? "Saving"
            : saveState === "error"
              ? "Save failed"
              : "Saved"}
        </span>
        <div className="status-dots" aria-hidden="true" />
      </footer>

      {toast ? (
        <button className="toast" type="button" onClick={() => setToast(null)}>
          {toast}
        </button>
      ) : null}
    </div>
  );
}

interface FilterButtonProps {
  label: string;
  count: number;
  value: SegmentFilter;
  active: SegmentFilter;
  onChange(value: SegmentFilter): void;
}

function FilterButton({
  label,
  count,
  value,
  active,
  onChange,
}: FilterButtonProps) {
  return (
    <button
      type="button"
      className="filter-button"
      aria-pressed={active === value}
      onClick={() => onChange(value)}
    >
      {label}
      <span>{count}</span>
    </button>
  );
}

function StatusLamp({
  segment,
  hasIssue,
}: {
  segment: Segment;
  hasIssue: boolean;
}) {
  const state = hasIssue ? "issues" : segment.state;
  const label = hasIssue
    ? "Issues"
    : state[0]?.toLocaleUpperCase() + state.slice(1);
  return (
    <span className={`status-lamp ${state}`}>
      <i />
      {label}
    </span>
  );
}

function StatusCount({
  className,
  value,
  label,
}: {
  className: string;
  value: number;
  label: string;
}) {
  return (
    <span>
      <i className={className} />
      {value} {label}
    </span>
  );
}

function TaggedText({
  text,
  tags,
  showNonprinting,
}: {
  text: string;
  tags: InlineTag[];
  showNonprinting: boolean;
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
      content.push(
        <span
          className="tag-capsule source-tag"
          key={`${tag.id}-${position}`}
          tabIndex={0}
          title={tag.payload}
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

interface PreviewProps {
  document: Document;
  activeSegment: Segment | undefined;
  segments: Segment[];
  mode: PanelMode;
  onModeChange(mode: PanelMode): void;
  height: number;
  onHeightChange(height: number): void;
  followActive: boolean;
  onFollowActiveChange(follow: boolean): void;
  onSourceCorrected(segment: Segment): void;
}

function DocumentPreview({
  document,
  activeSegment,
  segments,
  mode,
  onModeChange,
  height,
  onHeightChange,
  followActive,
  onFollowActiveChange,
  onSourceCorrected,
}: PreviewProps) {
  const { t } = useLocale();
  const resizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const [previewAnchorId, setPreviewAnchorId] = useState(
    activeSegment?.id ?? "",
  );
  const [pdfPages, setPdfPages] = useState<PdfPageSummary[]>([]);
  const [pdfPage, setPdfPage] = useState<PdfPageDetail | null>(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionBusy, setCorrectionBusy] = useState(false);

  useEffect(() => {
    if (followActive && activeSegment) setPreviewAnchorId(activeSegment.id);
  }, [activeSegment, followActive]);

  useEffect(() => {
    if (document.filterId !== "builtin.pdf") return;
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    void window.translunar
      .invoke("pdf.page.list", { documentId: document.id })
      .then((result) => {
        if (cancelled) return;
        setPdfPages(result.pages);
        const activePage = result.pages.find((page) =>
          activeSegment ? page.segmentIds.includes(activeSegment.id) : false,
        );
        setPdfPageNumber(activePage?.page ?? result.pages[0]?.page ?? 1);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setPdfError(formatError(reason));
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSegment, document.filterId, document.id]);

  useEffect(() => {
    if (
      document.filterId !== "builtin.pdf" ||
      mode === "collapsed" ||
      pdfPages.length === 0
    ) {
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    void window.translunar
      .invoke("pdf.page.get", {
        documentId: document.id,
        page: pdfPageNumber,
        dpi: 144,
      })
      .then((result) => {
        if (!cancelled) setPdfPage(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setPdfError(formatError(reason));
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [document.filterId, document.id, mode, pdfPageNumber, pdfPages.length]);

  useEffect(() => {
    if (!followActive || !activeSegment || pdfPages.length === 0) return;
    const page = pdfPages.find((candidate) =>
      candidate.segmentIds.includes(activeSegment.id),
    );
    if (page) setPdfPageNumber(page.page);
  }, [activeSegment, followActive, pdfPages]);

  const activePdfBlock =
    pdfPage?.blocks.find((block) => block.segmentId === activeSegment?.id) ??
    null;

  useEffect(() => {
    setCorrectionOpen(false);
    setCorrectionText(activePdfBlock?.sourceText ?? "");
    setCorrectionReason("");
  }, [activePdfBlock?.segmentId, activePdfBlock?.revision]);

  const submitOcrCorrection = async () => {
    if (!activePdfBlock || !correctionReason.trim() || !correctionText.trim())
      return;
    setCorrectionBusy(true);
    setPdfError(null);
    try {
      const corrected = await window.translunar.invoke("pdf.correctOcr", {
        segmentId: activePdfBlock.segmentId,
        sourceText: correctionText,
        reason: correctionReason,
        expectedRevision: activePdfBlock.revision,
      });
      onSourceCorrected(corrected);
      setPdfPage((current) =>
        current
          ? {
              ...current,
              blocks: current.blocks.map((block) =>
                block.segmentId === corrected.id
                  ? {
                      ...block,
                      sourceText: corrected.sourceText,
                      revision: corrected.revision,
                      state: corrected.state,
                    }
                  : block,
              ),
            }
          : current,
      );
      setCorrectionOpen(false);
      setCorrectionReason("");
    } catch (reason) {
      setPdfError(formatError(reason));
    } finally {
      setCorrectionBusy(false);
    }
  };

  const previewAnchor =
    segments.find((segment) => segment.id === previewAnchorId) ?? activeSegment;
  const activeIndex = previewAnchor
    ? segments.findIndex((segment) => segment.id === previewAnchor.id)
    : 0;
  const start = Math.max(0, activeIndex - 2);
  const previewSegments = segments.slice(start, start + 5);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "docked") return;
    event.preventDefault();
    resizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onHeightChange(
      clampPreviewHeight(drag.startHeight + drag.startY - event.clientY),
    );
  };

  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "docked") return;
    const nextHeight =
      event.key === "ArrowUp"
        ? height + 8
        : event.key === "ArrowDown"
          ? height - 8
          : event.key === "Home"
            ? PREVIEW_MIN_HEIGHT
            : event.key === "End"
              ? PREVIEW_MAX_HEIGHT
              : null;
    if (nextHeight === null) return;
    event.preventDefault();
    onHeightChange(clampPreviewHeight(nextHeight));
  };

  return (
    <section
      className="document-preview"
      aria-label={t("workbench.documentPreview")}
    >
      <div
        className="preview-resizer"
        role="separator"
        aria-label={t("workbench.resizePreview")}
        aria-orientation="horizontal"
        aria-valuemin={PREVIEW_MIN_HEIGHT}
        aria-valuemax={PREVIEW_MAX_HEIGHT}
        aria-valuenow={height}
        tabIndex={mode === "docked" ? 0 : -1}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onKeyDown={resizeWithKeyboard}
      />
      <header>
        <strong>{t("workbench.documentPreview")}</strong>
        <span>{document.name}</span>
        <small>
          {activeSegment
            ? t("workbench.segmentLabel", {
                number: activeSegment.ordinal + 1,
              })
            : ""}
        </small>
        <label className="preview-follow">
          <input
            type="checkbox"
            aria-label={t("workbench.followActiveSegment")}
            checked={followActive}
            onChange={(event) =>
              onFollowActiveChange(event.currentTarget.checked)
            }
          />
          <span>{t("workbench.followActive")}</span>
        </label>
        <div className="preview-actions">
          <button
            type="button"
            className="icon-button"
            title={
              mode === "collapsed"
                ? t("workbench.openPreview")
                : t("workbench.collapsePreview")
            }
            aria-label={
              mode === "collapsed"
                ? t("workbench.openPreview")
                : t("workbench.collapsePreview")
            }
            onClick={() => onModeChange(togglePanelCollapsed(mode))}
          >
            {mode === "collapsed" ? (
              <PanelBottomOpen size={14} />
            ) : (
              <PanelBottomClose size={14} />
            )}
          </button>
          <button
            type="button"
            className="icon-button"
            title={
              mode === "maximized" ? "Restore preview" : "Maximize preview"
            }
            aria-label={
              mode === "maximized" ? "Restore preview" : "Maximize preview"
            }
            onClick={() => onModeChange(togglePanelMaximized(mode))}
          >
            {mode === "maximized" ? (
              <Minimize2 size={14} />
            ) : (
              <Maximize2 size={14} />
            )}
          </button>
        </div>
      </header>
      {document.filterId === "builtin.pdf" ? (
        <div className="preview-content pdf-preview-content">
          <div className="pdf-preview-toolbar">
            <span className="pdf-page-label">
              Page {pdfPageNumber} of {pdfPages.length || "..."}
            </span>
            <div
              className="pdf-page-picker"
              role="listbox"
              aria-label={t("workbench.pdfPage")}
            >
              {pdfPages.map((page) => (
                <button
                  key={page.page}
                  type="button"
                  className={page.page === pdfPageNumber ? "active" : ""}
                  aria-selected={page.page === pdfPageNumber}
                  onClick={() => setPdfPageNumber(page.page)}
                >
                  {page.page}
                </button>
              ))}
            </div>
          </div>
          {pdfError ? (
            <p className="form-error pdf-preview-error" role="alert">
              {pdfError}
            </p>
          ) : null}
          <div className="pdf-preview-grid">
            <div className="pdf-page-image">
              {pdfPage ? (
                <img
                  src={"data:image/png;base64," + pdfPage.imagePngBase64}
                  alt={"Original PDF page " + pdfPage.page}
                />
              ) : (
                <span>
                  {pdfLoading ? "Rendering page..." : "No page loaded"}
                </span>
              )}
            </div>
            <div
              className="pdf-block-list"
              aria-label={t("workbench.extractedBlocks")}
            >
              {pdfPage?.blocks.map((block) => (
                <article
                  key={block.segmentId}
                  className={
                    block.segmentId === activeSegment?.id
                      ? "pdf-block active"
                      : "pdf-block"
                  }
                >
                  <div className="pdf-block-meta">
                    <span>{block.kind}</span>
                    <span
                      className={
                        block.sourceKind === "ocr" ? "ocr-confidence" : ""
                      }
                    >
                      {block.sourceKind === "ocr"
                        ? "OCR " + block.confidence / 10 + "%"
                        : "Text layer"}
                    </span>
                  </div>
                  <p>{block.sourceText}</p>
                  {block.sourceKind === "ocr" &&
                  block.segmentId === activeSegment?.id &&
                  block.state !== "confirmed" ? (
                    correctionOpen ? (
                      <div className="ocr-correction">
                        <textarea
                          aria-label={t("workbench.correctOcr")}
                          value={correctionText}
                          onChange={(event) =>
                            setCorrectionText(event.currentTarget.value)
                          }
                        />
                        <input
                          aria-label={t("workbench.ocrReason")}
                          placeholder={t("workbench.reasonForCorrection")}
                          value={correctionReason}
                          onChange={(event) =>
                            setCorrectionReason(event.currentTarget.value)
                          }
                        />
                        <div className="ocr-correction-actions">
                          <button
                            className="button primary"
                            type="button"
                            disabled={
                              correctionBusy ||
                              !correctionReason.trim() ||
                              !correctionText.trim()
                            }
                            onClick={() => void submitOcrCorrection()}
                          >
                            <Save size={13} />
                            {correctionBusy ? "Saving" : "Save correction"}
                          </button>
                          <button
                            className="button ghost"
                            type="button"
                            onClick={() => setCorrectionOpen(false)}
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="ocr-edit-button"
                        type="button"
                        onClick={() => {
                          setCorrectionText(block.sourceText);
                          setCorrectionOpen(true);
                        }}
                      >
                        <Pencil size={12} />
                        {t("workbench.correctOcrBtn")}
                      </button>
                    )
                  ) : null}
                </article>
              ))}
              {!pdfLoading && !pdfPage?.blocks.length ? (
                <p className="empty-grid">{t("workbench.noExtractedBlocks")}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="preview-content">
          <div className="page-thumb">
            <FileText size={18} />
            <span>1</span>
          </div>
          <div className="preview-lines">
            {previewSegments.map((segment) => (
              <div
                key={segment.id}
                className={
                  segment.id === activeSegment?.id
                    ? "preview-line active"
                    : "preview-line"
                }
              >
                <span>{segment.ordinal + 1}</span>
                <p>{segment.sourceText}</p>
              </div>
            ))}
          </div>
          <div className="preview-dot-field" aria-hidden="true" />
        </div>
      )}
    </section>
  );
}

interface SuggestionsProps {
  projectId: string;
  mode: PanelMode;
  onModeChange(mode: PanelMode): void;
  tab: SuggestionTab;
  onTabChange(tab: SuggestionTab): void;
  activeSegment: Segment | undefined;
  activeIssue: QaIssue | undefined;
  issues: QaIssue[];
  matches: TmEntry[];
  termMatches: TermMatch[];
  onInsert(target: string): void;
  onApplyMutation(mutation: EditorMutationResult): void;
}

function SuggestionsPanel({
  projectId,
  mode,
  onModeChange,
  tab,
  onTabChange,
  activeSegment,
  activeIssue,
  issues,
  matches,
  termMatches,
  onInsert,
  onApplyMutation,
}: SuggestionsProps) {
  const { t, formatDate } = useLocale();
  const openIssues = issues.filter((issue) => issue.status === "open");
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterModeRef = useRef<"content" | "rail" | null>(null);

  useEffect(() => {
    const focusTarget = focusAfterModeRef.current;
    if (!focusTarget) return;
    focusAfterModeRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (focusTarget === "rail") expandButtonRef.current?.focus();
      else collapseButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  return (
    <aside className="suggestions-panel" aria-label={t("common.suggestions")}>
      <div
        className={
          tab === "assistant"
            ? "suggestions-content assistant-tab"
            : "suggestions-content"
        }
        aria-hidden={mode === "collapsed"}
        inert={mode === "collapsed" ? true : undefined}
      >
        <header className="suggestions-header">
          <strong>{t("common.suggestions")}</strong>
          <div className="suggestions-dots" aria-hidden="true" />
          <button
            type="button"
            className="icon-button"
            ref={collapseButtonRef}
            onClick={() => {
              focusAfterModeRef.current = "rail";
              onModeChange(togglePanelCollapsed(mode));
            }}
            title={t("workbench.collapseSuggestions")}
            aria-label={t("workbench.collapseSuggestions")}
          >
            <PanelRightClose size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => onModeChange(togglePanelMaximized(mode))}
            title={
              mode === "maximized"
                ? t("workbench.restoreSuggestions")
                : t("workbench.maximizeSuggestions")
            }
            aria-label={
              mode === "maximized"
                ? t("workbench.restoreSuggestions")
                : t("workbench.maximizeSuggestions")
            }
          >
            {mode === "maximized" ? (
              <Minimize2 size={14} />
            ) : (
              <Maximize2 size={14} />
            )}
          </button>
        </header>
        <div className="suggestion-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "matches"}
            onClick={() => onTabChange("matches")}
          >
            {t("workbench.matches")} <span>{matches.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "terms"}
            onClick={() => onTabChange("terms")}
          >
            {t("common.terms")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "assistant"}
            onClick={() => onTabChange("assistant")}
          >
            <Sparkles size={11} /> {t("workbench.assistant")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "qa"}
            onClick={() => onTabChange("qa")}
          >
            QA <span>{openIssues.length}</span>
          </button>
        </div>
        {tab !== "assistant" ? (
          <div className="suggestion-context">
            <span>{t("common.active")}</span>
            <strong>{activeSegment ? activeSegment.ordinal + 1 : "—"}</strong>
            <p>{activeSegment?.sourceText ?? ""}</p>
          </div>
        ) : null}
        <div
          className={
            tab === "assistant"
              ? "suggestion-scroll assistant-open"
              : "suggestion-scroll"
          }
        >
          {tab === "matches" ? (
            matches.length ? (
              matches.map((match) => (
                <article className="match-card" key={match.id}>
                  <header>
                    <span className="match-score">100%</span>
                    <strong>{t("workbench.projectTm")}</strong>
                    <time>
                      {formatDate(match.confirmedAtMs, { dateStyle: "medium" })}
                    </time>
                  </header>
                  <label>{t("common.source")}</label>
                  <p>{match.sourceText}</p>
                  <label>{t("common.target")}</label>
                  <p className="match-target">{match.targetText}</p>
                  <footer>
                    <span>
                      <Database size={12} />
                      {t("workbench.segmentLabel", {
                        number: match.originSegmentId.slice(0, 8),
                      })}
                    </span>
                    <button
                      type="button"
                      className="insert-button"
                      onClick={() => onInsert(match.targetText)}
                    >
                      {t("workbench.insert")}
                    </button>
                  </footer>
                </article>
              ))
            ) : (
              <EmptySuggestion
                icon={<Database size={20} />}
                label={t("workbench.noExactMatch")}
              />
            )
          ) : tab === "terms" ? (
            termMatches.length ? (
              termMatches.map((match) => {
                const translation =
                  match.translations.find((item) => item.preferred) ??
                  match.translations[0];
                return (
                  <article className="match-card term-card" key={match.entryId}>
                    <header>
                      <BookOpen size={13} />
                      <strong>{match.sourceTerm}</strong>
                      <small>{match.termbaseId.slice(0, 8)}</small>
                    </header>
                    <label>{t("workbench.preferredTarget")}</label>
                    <p className="match-target">
                      {translation?.term ?? t("workbench.noTargetTranslation")}
                    </p>
                    {translation ? (
                      <footer>
                        <span>{translation.locale}</span>
                        <button
                          type="button"
                          className="insert-button"
                          onClick={() => onInsert(translation.term)}
                        >
                          {t("workbench.insert")}
                        </button>
                      </footer>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <EmptySuggestion
                icon={<BookOpen size={20} />}
                label={t("workbench.noTermHits")}
              />
            )
          ) : tab === "assistant" ? (
            <AssistantPanel
              activeSegment={activeSegment}
              onUseTarget={onInsert}
              projectId={projectId}
              onApplyMutation={onApplyMutation}
            />
          ) : openIssues.length ? (
            openIssues.map((issue) => (
              <article
                className={
                  issue.id === activeIssue?.id ? "qa-card active" : "qa-card"
                }
                key={issue.id}
              >
                <header>
                  <AlertTriangle size={14} />
                  <strong>{issue.ruleId}</strong>
                  <span>{issue.severity}</span>
                </header>
                <p>{issue.message}</p>
                <div className="qa-evidence">
                  <span>
                    Source{" "}
                    <b>{issue.evidence.sourceNumbers.join(", ") || "—"}</b>
                  </span>
                  <span>
                    Target{" "}
                    <b>{issue.evidence.targetNumbers.join(", ") || "—"}</b>
                  </span>
                </div>
              </article>
            ))
          ) : (
            <EmptySuggestion
              icon={<CheckCircle2 size={20} />}
              label="No open QA issues"
            />
          )}
        </div>
      </div>
      <div
        className="suggestions-rail"
        aria-hidden={mode !== "collapsed"}
        inert={mode !== "collapsed" ? true : undefined}
      >
        <button
          type="button"
          className="suggestions-expand"
          ref={expandButtonRef}
          onClick={() => {
            focusAfterModeRef.current = "content";
            onModeChange(togglePanelCollapsed(mode));
          }}
          title={t("workbench.openSuggestions")}
          aria-label={t("workbench.openSuggestions")}
        >
          <PanelRightOpen size={15} />
        </button>
        <span>{t("common.suggestions")}</span>
        <div className="rail-dots" aria-hidden="true" />
      </div>
    </aside>
  );
}

function EmptySuggestion({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="empty-suggestion">
      {icon}
      <span>{label}</span>
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
