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
import { BrandMark } from "./BrandMark";
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
  label: string;
}[] = [
  {
    value: "simplifiedToTraditional",
    label: "Simplified → Traditional",
  },
  {
    value: "simplifiedToTaiwan",
    label: "Simplified → Taiwan (vocabulary)",
  },
  {
    value: "simplifiedToHongKong",
    label: "Simplified → Hong Kong",
  },
  {
    value: "traditionalToSimplified",
    label: "Traditional → Simplified",
  },
  {
    value: "taiwanToSimplified",
    label: "Taiwan vocabulary → Simplified",
  },
  {
    value: "hongKongToSimplified",
    label: "Hong Kong → Simplified",
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
  onStartAnotherProject(): void;
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
  onStartAnotherProject,
  onNavigate,
  focusSegmentId,
}: WorkbenchProps) {
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
  const composingRef = useRef(new Set<string>());
  const pendingSavesRef = useRef(0);
  const editorGridRef = useRef<HTMLDivElement>(null);
  const editorWindowRequestRef = useRef(0);
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

  const updateDraft = (segmentId: string, targetText: string) => {
    const next = { ...draftsRef.current, [segmentId]: targetText };
    draftsRef.current = next;
    setDrafts(next);
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
    const latest = await window.translunar.invoke("project.get", {
      projectId: snapshot.project.id,
    });
    setCounts(latest.counts);
  };

  const persistSegment = async (segmentId: string): Promise<Segment> => {
    const timer = timersRef.current.get(segmentId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(segmentId);
    }
    const existing = inFlightRef.current.get(segmentId);
    if (existing) {
      await existing;
      return persistSegment(segmentId);
    }
    const base = segmentsRef.current.find(
      (segment) => segment.id === segmentId,
    );
    if (!base) throw new Error("The segment is no longer available.");
    const targetText = draftsRef.current[segmentId] ?? base.targetText;
    if (targetText === base.targetText) return base;

    pendingSavesRef.current += 1;
    setSaveState("saving");
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
      applySegment(saved);
      succeeded = true;
    } catch (error) {
      setSaveState("error");
      setToast(formatError(error));
      throw error;
    } finally {
      inFlightRef.current.delete(segmentId);
      pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
      if (pendingSavesRef.current === 0 && succeeded) setSaveState("saved");
    }

    if (
      (draftsRef.current[segmentId] ?? saved.targetText) !== saved.targetText
    ) {
      return persistSegment(segmentId);
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
    const requestId = editorWindowRequestRef.current + 1;
    editorWindowRequestRef.current = requestId;
    setEditorLoading(true);
    try {
      await persistAllSegments();
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
      if (editorWindowRequestRef.current !== requestId) return;
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
      setToast(formatError(error));
    } finally {
      if (editorWindowRequestRef.current === requestId) setEditorLoading(false);
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
        `Exported ${result.translatedSegments} translated segments to ${fileName(result.outputPath)}.`,
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

  const startAnotherProject = async () => {
    setActionBusy("navigate");
    setToast(null);
    try {
      await persistAllSegments();
      onStartAnotherProject();
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
    } catch (error) {
      setToast(formatError(error));
    } finally {
      setConcordanceBusy(false);
    }
  };

  const setWorkflowState = async (next: EditorWorkflowState) => {
    if (!activeEditorRow) return;
    try {
      const saved = await persistSegment(activeEditorRow.segment.id);
      applyEditorMutation(
        await window.translunar.invoke("segment.workflow.set", {
          segmentId: saved.id,
          state: next,
          expectedRevision: saved.revision,
        }),
      );
    } catch (error) {
      setToast(formatError(error));
    }
  };

  const advanceWorkflow = async () => {
    if (!activeEditorRow) return;
    const next: EditorWorkflowState =
      activeEditorRow.workflowState === "translation"
        ? "review"
        : activeEditorRow.workflowState === "review"
          ? "signed"
          : "translation";
    await setWorkflowState(next);
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
        setToast(
          "Signed segments are read-only. Return the segment to review or translation first.",
        );
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
            <span>{snapshot.project.domain || "Translation project"}</span>
          </div>
        </div>
        <div className="document-switcher" aria-label="Active document">
          <FileText size={15} />
          <span>{document.name}</span>
          <small>{counts.total} segments</small>
        </div>
        <label className="project-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search in document"
            aria-label="Search in document"
          />
        </label>
        <div className="app-actions">
          <button
            className="top-command"
            type="button"
            onClick={runQa}
            disabled={actionBusy !== null}
          >
            <ShieldCheck size={15} />
            Run QA
          </button>
          <button
            className="top-command export-command"
            type="button"
            onClick={exportDocument}
            disabled={actionBusy !== null}
          >
            <Download size={15} />
            Export
          </button>
          <div className="surface-menu-wrap">
            <button
              className="icon-button dark"
              type="button"
              title="More actions"
              aria-label="More actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={17} />
            </button>
            {menuOpen ? (
              <nav className="surface-menu" aria-label="Application views">
                <span>Views</span>
                <button type="button" aria-current="page" disabled>
                  Workbench
                </button>
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("qa-review")}
                >
                  QA review
                </button>
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("export-review")}
                >
                  Export review
                </button>
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("translation-memory")}
                >
                  Translation memory
                </button>
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void navigateToSurface("ai-control")}
                >
                  AI control
                </button>
                <hr />
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={() => void startAnotherProject()}
                >
                  New project
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
        <section className="editor-region">
          <div className="editor-toolbar">
            <div
              className="filter-group"
              role="group"
              aria-label="Segment filters"
            >
              <FilterButton
                label="All"
                count={counts.total}
                value="all"
                active={filter}
                onChange={setFilter}
              />
              <FilterButton
                label="Untranslated"
                count={counts.untranslated}
                value="untranslated"
                active={filter}
                onChange={setFilter}
              />
              <FilterButton
                label="Draft"
                count={counts.draft}
                value="draft"
                active={filter}
                onChange={setFilter}
              />
              <FilterButton
                label="Confirmed"
                count={counts.confirmed}
                value="confirmed"
                active={filter}
                onChange={setFilter}
              />
              <FilterButton
                label="Issues"
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
                aria-label="Additional segment filters"
              >
                <option value="" disabled>
                  More
                </option>
                <option value="tagged">Tagged</option>
                <option value="commented">Commented</option>
              </select>
            </div>
            <div className="match-scope" aria-label="Exact TM matching">
              <Database size={13} />
              <span>Exact TM</span>
            </div>
            <div
              className="editor-command-strip"
              role="toolbar"
              aria-label="Editor commands"
            >
              <button
                type="button"
                className="icon-button"
                onClick={() => setCommandPaletteOpen(true)}
                title="Command palette"
                aria-label="Open command palette"
              >
                <Command size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFindOpen(true)}
                title="Find and replace"
                aria-label="Open find and replace"
              >
                <Search size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void undoEditor()}
                title="Undo"
                aria-label="Undo editor operation"
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void redoEditor()}
                title="Redo"
                aria-label="Redo editor operation"
              >
                <RotateCw size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setCommentsOpen(true)}
                title="Comments"
                aria-label="Open segment comments"
              >
                <MessageSquare size={14} />
              </button>
            </div>
            <div className="issue-nav" aria-label="Issue navigation">
              <span>Issue</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => navigateIssue(-1)}
                disabled={!openIssueIds.length}
                title="Previous issue"
                aria-label="Previous issue"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="issue-position">
                {issuePosition} of {openIssueIds.length}
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => navigateIssue(1)}
                disabled={!openIssueIds.length}
                title="Next issue"
                aria-label="Next issue"
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
                Confirm
              </button>
            ) : null}
          </div>

          <div className="editor-body">
            <div
              className="segment-grid"
              role="region"
              aria-label="Translation segments"
              aria-busy={editorLoading}
              ref={editorGridRef}
              onScroll={onEditorScroll}
            >
              <table>
                <thead>
                  <tr>
                    <th className="id-column">ID</th>
                    <th className="status-column">Status</th>
                    <th>Source ({snapshot.project.sourceLocale})</th>
                    <th>Target ({snapshot.project.targetLocale})</th>
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
                        className={
                          active ? "segment-row active" : "segment-row"
                        }
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
                              aria-label="Active segment tools"
                            >
                              <button
                                type="button"
                                onClick={() => void copyProtectedTags()}
                                aria-label="Copy protected tags"
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Tags size={12} />
                                Tags
                              </button>
                              <button
                                type="button"
                                onClick={() => void insertProtectedTag(false)}
                                aria-label="Insert protected tag"
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Tags size={12} />+
                              </button>
                              <button
                                type="button"
                                onClick={() => void insertProtectedTag(true)}
                                aria-label="Insert protected tag pair"
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Tags size={12} />±
                              </button>
                              <button
                                type="button"
                                onClick={() => void splitActiveSegment()}
                                aria-label="Split segment"
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Split size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void mergeActiveSegment()}
                                aria-label="Merge with next segment"
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
                                aria-label="Correct source"
                                disabled={editorRow?.workflowState === "signed"}
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setChineseConversionOpen(true)}
                                aria-label="Open Chinese conversion"
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
                                aria-label="Open comments"
                              >
                                <MessageSquare size={12} />
                                {editorRow?.comments.filter(
                                  (comment) => !comment.resolved,
                                ).length ?? 0}
                              </button>
                              <button
                                type="button"
                                onClick={() => void openReviewPanel()}
                                aria-label="Open review panel"
                              >
                                <GitCompareArrows size={12} />
                                {editorRow?.workflowState}
                              </button>
                            </div>
                          ) : null}
                          {editorRow?.targetTags.length ? (
                            <div
                              className="target-tag-strip"
                              aria-label="Target protected tags"
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
                                  aria-label={`Select protected tag ${tag.displayText || tag.kind} at position ${tag.position}`}
                                  title="Select, then use Move tag to caret"
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
                            placeholder="Untranslated"
                            aria-label={`Target segment ${segment.ordinal + 1}`}
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
                              aria-label={`Accept ${autocomplete.provider} autocomplete`}
                            >
                              <small>{autocomplete.provider}</small>
                              <span>{autocomplete.tail}</span>
                              <kbd>Tab</kbd>
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
                              aria-label={`Spell findings from ${spellProvider}`}
                            >
                              {spellFindings.slice(0, 4).map((finding) => (
                                <button
                                  key={`${finding.provider}-${finding.start}-${finding.word}`}
                                  type="button"
                                  onClick={() =>
                                    void addDictionaryFinding(finding)
                                  }
                                  title="Add to user dictionary"
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
                <div className="empty-grid">No segments match this view.</div>
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
            aria-label="Command palette"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <Command size={16} />
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.currentTarget.value)}
                placeholder="Type a command"
                aria-label="Filter commands"
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => setCommandPaletteOpen(false)}
                aria-label="Close command palette"
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
            aria-label="Editor preferences"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>Workspace preferences</small>
                <strong>Editor and shortcuts</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPreferencesOpen(false)}
                aria-label="Close editor preferences"
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
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
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
              aria-label="Shortcut presets"
            >
              <button
                type="button"
                onClick={() => applyShortcutPreset("default")}
              >
                Default
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
                Save shortcuts
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
            aria-label="Concordance"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>Translation memory</small>
                <strong>Concordance</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setConcordanceOpen(false)}
                aria-label="Close concordance"
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
                aria-label="Concordance query"
              />
              <select
                value={concordanceSide}
                onChange={(event) =>
                  setConcordanceSide(
                    event.currentTarget.value as typeof concordanceSide,
                  )
                }
                aria-label="Concordance direction"
              >
                <option value="both">Source and target</option>
                <option value="source">Source</option>
                <option value="target">Target</option>
              </select>
              <button
                type="button"
                className="confirm-button"
                onClick={() => void runConcordance()}
                disabled={!concordanceQuery.trim() || concordanceBusy}
              >
                Search
              </button>
            </div>
            <div className="concordance-results" aria-live="polite">
              <small>{concordanceTotal} results</small>
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
                    Insert target
                  </button>
                </article>
              ))}
              {!concordanceBusy && concordanceHits.length === 0 ? (
                <div className="empty-comment">No concordance results.</div>
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
            aria-label="Correct source"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>Audited source edit</small>
                <strong>Correct source</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setSourceCorrectionOpen(false)}
                aria-label="Close source correction"
              >
                <X size={14} />
              </button>
            </header>
            <label>
              Corrected source
              <textarea
                autoFocus
                value={sourceCorrectionText}
                onChange={(event) =>
                  setSourceCorrectionText(event.currentTarget.value)
                }
                aria-label="Corrected source"
              />
            </label>
            <label>
              Reason
              <input
                value={sourceCorrectionReason}
                onChange={(event) =>
                  setSourceCorrectionReason(event.currentTarget.value)
                }
                aria-label="Source correction reason"
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
                Apply correction
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
            aria-label="Chinese conversion"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>Embedded OpenCC dictionaries</small>
                <strong>Simplified / Traditional Chinese</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setChineseConversionOpen(false)}
                aria-label="Close Chinese conversion"
              >
                <X size={14} />
              </button>
            </header>
            <label>
              Conversion profile
              <select
                autoFocus
                value={chineseConversionProfile}
                onChange={(event) =>
                  setChineseConversionProfile(
                    event.currentTarget.value as ChineseConversionProfile,
                  )
                }
                aria-label="Chinese conversion profile"
              >
                {CHINESE_CONVERSION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              The Engine converts the complete active target with embedded
              OpenCC-grade phrase dictionaries. The change is revisioned and can
              be undone or redone.
            </p>
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
                Apply conversion
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
            aria-label="Find and replace"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>Project transform</small>
                <strong>Find and replace</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFindOpen(false)}
                aria-label="Close find and replace"
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
              Replace with
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
                Scope
                <select
                  value={findField}
                  onChange={(event) => {
                    setFindField(event.currentTarget.value as typeof findField);
                    setReplacePreview(null);
                  }}
                >
                  <option value="target">Target</option>
                  <option value="source">Source</option>
                  <option value="both">Source and target</option>
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
                Regular expression
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
                Case sensitive
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
                Whole word
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
                Preview
              </button>
              <button
                type="button"
                className="confirm-button"
                onClick={() => void applyReplacement()}
                disabled={!replacePreview?.items.length}
              >
                Apply unchanged preview
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {commentsOpen ? (
        <aside className="comments-sheet" aria-label="Segment comments">
          <header>
            <div>
              <small>
                Segment {activeSegment ? activeSegment.ordinal + 1 : "—"}
              </small>
              <strong>Comments</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setCommentsOpen(false)}
              aria-label="Close comments"
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
                        ? "import note"
                        : `r${comment.revision}`}
                    </small>
                  </header>
                  {editingCommentId === comment.id ? (
                    <label className="comment-editor">
                      Edit comment
                      <textarea
                        autoFocus
                        value={commentEditText}
                        onChange={(event) =>
                          setCommentEditText(event.currentTarget.value)
                        }
                        aria-label="Edited comment text"
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
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateComment(comment)}
                            disabled={
                              !commentEditText.trim() ||
                              commentEditText.trim() === comment.text
                            }
                          >
                            Save edit
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
                          Edit
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
                        {comment.resolved ? "Reopen" : "Resolve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteComment(comment)}
                      >
                        Delete
                      </button>
                    </footer>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-comment">No comments on this segment.</div>
            )}
          </div>
          <footer>
            <textarea
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.currentTarget.value)}
              placeholder="Add a durable comment"
              aria-label="New comment"
            />
            <button
              type="button"
              onClick={() => void createComment()}
              disabled={!commentDraft.trim()}
              aria-label="Add comment"
            >
              <Send size={14} />
            </button>
          </footer>
        </aside>
      ) : null}

      {reviewOpen ? (
        <aside
          className="comments-sheet review-sheet"
          aria-label="Review revisions"
        >
          <header>
            <div>
              <small>Local review workflow</small>
              <strong>Review revisions</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setReviewOpen(false)}
              aria-label="Close review panel"
            >
              <X size={14} />
            </button>
          </header>
          <div className="comment-thread review-thread">
            <div
              className="workflow-controls"
              role="group"
              aria-label="Segment workflow state"
            >
              {(["translation", "review", "signed"] as const).map((state) => (
                <button
                  type="button"
                  key={state}
                  aria-pressed={activeEditorRow?.workflowState === state}
                  disabled={activeEditorRow?.workflowState === state}
                  onClick={() => void setWorkflowState(state)}
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
                      <small>Source revision</small>
                      <WordDiff
                        before={review.beforeSource ?? ""}
                        after={review.proposedSource ?? ""}
                      />
                    </div>
                  ) : null}
                  <small>Target revision</small>
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
                No review proposals for this segment.
              </div>
            ) : null}
          </div>
          <footer className="review-composer">
            <textarea
              value={reviewSource}
              onChange={(event) => setReviewSource(event.currentTarget.value)}
              placeholder="Proposed source revision"
              aria-label="Proposed source revision"
            />
            <textarea
              value={reviewTarget}
              onChange={(event) => setReviewTarget(event.currentTarget.value)}
              placeholder="Proposed target revision"
              aria-label="Proposed target revision"
            />
            <label className="review-tag-option">
              <input
                type="checkbox"
                checked={reviewCopyTags}
                onChange={(event) =>
                  setReviewCopyTags(event.currentTarget.checked)
                }
              />
              Propose protected tags copied from source
            </label>
            <button
              type="button"
              onClick={() => void createReview()}
              aria-label="Create review proposal"
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
      aria-label={`Changed from ${before} to ${after}`}
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
    <section className="document-preview" aria-label="Document preview">
      <div
        className="preview-resizer"
        role="separator"
        aria-label="Resize document preview"
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
        <strong>Document preview</strong>
        <span>{document.name}</span>
        <small>
          {activeSegment ? `Segment ${activeSegment.ordinal + 1}` : ""}
        </small>
        <label className="preview-follow">
          <input
            type="checkbox"
            aria-label="Follow active segment"
            checked={followActive}
            onChange={(event) =>
              onFollowActiveChange(event.currentTarget.checked)
            }
          />
          <span>Follow active</span>
        </label>
        <div className="preview-actions">
          <button
            type="button"
            className="icon-button"
            title={mode === "collapsed" ? "Open preview" : "Collapse preview"}
            aria-label={
              mode === "collapsed" ? "Open preview" : "Collapse preview"
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
              aria-label="PDF page"
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
            <div className="pdf-block-list" aria-label="Extracted PDF blocks">
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
                          aria-label="Correct OCR source"
                          value={correctionText}
                          onChange={(event) =>
                            setCorrectionText(event.currentTarget.value)
                          }
                        />
                        <input
                          aria-label="OCR correction reason"
                          placeholder="Reason for correction"
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
                            Cancel
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
                        Correct OCR
                      </button>
                    )
                  ) : null}
                </article>
              ))}
              {!pdfLoading && !pdfPage?.blocks.length ? (
                <p className="empty-grid">No extracted blocks on this page.</p>
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
    <aside className="suggestions-panel" aria-label="Suggestions">
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
          <strong>Suggestions</strong>
          <div className="suggestions-dots" aria-hidden="true" />
          <button
            type="button"
            className="icon-button"
            ref={collapseButtonRef}
            onClick={() => {
              focusAfterModeRef.current = "rail";
              onModeChange(togglePanelCollapsed(mode));
            }}
            title="Collapse Suggestions"
            aria-label="Collapse Suggestions"
          >
            <PanelRightClose size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => onModeChange(togglePanelMaximized(mode))}
            title={
              mode === "maximized"
                ? "Restore Suggestions"
                : "Maximize Suggestions"
            }
            aria-label={
              mode === "maximized"
                ? "Restore Suggestions"
                : "Maximize Suggestions"
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
            Matches <span>{matches.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "terms"}
            onClick={() => onTabChange("terms")}
          >
            Terms
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "assistant"}
            onClick={() => onTabChange("assistant")}
          >
            <Sparkles size={11} /> Assistant
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
            <span>Active</span>
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
                    <strong>Project TM</strong>
                    <time>
                      {new Date(match.confirmedAtMs).toLocaleDateString()}
                    </time>
                  </header>
                  <label>Source</label>
                  <p>{match.sourceText}</p>
                  <label>Target</label>
                  <p className="match-target">{match.targetText}</p>
                  <footer>
                    <span>
                      <Database size={12} />
                      Segment {match.originSegmentId.slice(0, 8)}
                    </span>
                    <button
                      type="button"
                      className="insert-button"
                      onClick={() => onInsert(match.targetText)}
                    >
                      Insert
                    </button>
                  </footer>
                </article>
              ))
            ) : (
              <EmptySuggestion
                icon={<Database size={20} />}
                label="No exact TM match"
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
                    <label>Preferred target</label>
                    <p className="match-target">
                      {translation?.term ?? "No target translation"}
                    </p>
                    {translation ? (
                      <footer>
                        <span>{translation.locale}</span>
                        <button
                          type="button"
                          className="insert-button"
                          onClick={() => onInsert(translation.term)}
                        >
                          Insert
                        </button>
                      </footer>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <EmptySuggestion
                icon={<BookOpen size={20} />}
                label="No term hits"
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
          title="Open Suggestions"
          aria-label="Open Suggestions"
        >
          <PanelRightOpen size={15} />
        </button>
        <span>Suggestions</span>
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
