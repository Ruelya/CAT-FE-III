import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type CompositionEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  Document,
  ProjectSnapshot,
  QaIssue,
  Segment,
  SegmentCounts,
  TmEntry,
} from "@translunar/contracts";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileText,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { AssistantPanel } from "./AssistantPanel";
import { BrandMark } from "./BrandMark";
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

interface InitialWorkspace {
  snapshot: ProjectSnapshot;
  document: Document;
  segments: Segment[];
  issues: QaIssue[];
}

interface WorkbenchProps {
  initialWorkspace: InitialWorkspace;
  onStartAnotherProject(): void;
  onNavigate(surface: AppSurface): Promise<void>;
  focusSegmentId: string | null;
}

type SegmentFilter = "all" | "untranslated" | "draft" | "confirmed" | "issues";
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
  const timersRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Map<string, Promise<Segment>>());
  const composingRef = useRef(new Set<string>());
  const pendingSavesRef = useRef(0);

  const openIssueBySegment = useMemo(
    () =>
      new Map(
        issues
          .filter((issue) => issue.status === "open")
          .map((issue) => [issue.segmentId, issue]),
      ),
    [issues],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleSegments = useMemo(
    () =>
      segments.filter((segment) => {
        const hasIssue = openIssueBySegment.has(segment.id);
        const matchesFilter =
          filter === "all" ||
          (filter === "issues" ? hasIssue : segment.state === filter);
        if (!matchesFilter) return false;
        if (!normalizedSearch) return true;
        const target = drafts[segment.id] ?? segment.targetText;
        return `${segment.sourceText}\n${target}`
          .toLocaleLowerCase()
          .includes(normalizedSearch);
      }),
    [drafts, filter, normalizedSearch, openIssueBySegment, segments],
  );
  const activeSegment =
    segments.find((segment) => segment.id === activeId) ?? segments[0];
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
      setCounts(result.counts);
      await Promise.all([refreshOpenIssues(), refreshMatches(result.segment)]);
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

  const onTargetKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    segmentId: string,
  ) => {
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
      const suggestedName = document.name.replace(
        /\.docx$/iu,
        "-translated.docx",
      );
      const outputPath =
        await window.translunar.selectExportPath(suggestedName);
      if (!outputPath) return;
      const result = await window.translunar.invoke("document.exportDocx", {
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

  const applicationClasses = [
    "workbench-app",
    `suggestions-${suggestionsMode}`,
    `preview-${previewMode}`,
  ].join(" ");
  const applicationStyle = {
    "--preview-height": `${previewHeight}px`,
  } as CSSProperties;
  const issuePosition =
    Math.max(0, openIssueIds.indexOf(activeId)) + (openIssueIds.length ? 1 : 0);

  return (
    <div className={applicationClasses} style={applicationStyle}>
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
            </div>
            <div className="match-scope" aria-label="Exact TM matching">
              <Database size={13} />
              <span>Exact TM</span>
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
                disabled={actionBusy !== null}
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
                  {visibleSegments.map((segment) => {
                    const issue = openIssueBySegment.get(segment.id);
                    const active = segment.id === activeId;
                    return (
                      <tr
                        key={segment.id}
                        className={
                          active ? "segment-row active" : "segment-row"
                        }
                        data-segment-row={segment.id}
                        onClick={() => setActiveId(segment.id)}
                      >
                        <td className="id-cell">{segment.ordinal + 1}</td>
                        <td className="status-cell">
                          <StatusLamp
                            segment={segment}
                            hasIssue={Boolean(issue)}
                          />
                        </td>
                        <td className="source-cell">{segment.sourceText}</td>
                        <td className="target-cell">
                          <textarea
                            data-editor-for={segment.id}
                            value={drafts[segment.id] ?? segment.targetText}
                            placeholder="Untranslated"
                            aria-label={`Target segment ${segment.ordinal + 1}`}
                            aria-invalid={Boolean(issue)}
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
                          {issue ? (
                            <span className="inline-issue">
                              <AlertTriangle size={12} />
                              {issue.message}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
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
            />
          </div>
        </section>

        <SuggestionsPanel
          mode={suggestionsMode}
          onModeChange={setSuggestionsMode}
          tab={suggestionTab}
          onTabChange={setSuggestionTab}
          activeSegment={activeSegment}
          activeIssue={activeIssue}
          issues={issues}
          matches={matches}
          onInsert={insertMatch}
        />
      </main>

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
}: PreviewProps) {
  const resizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const [previewAnchorId, setPreviewAnchorId] = useState(
    activeSegment?.id ?? "",
  );

  useEffect(() => {
    if (followActive && activeSegment) setPreviewAnchorId(activeSegment.id);
  }, [activeSegment, followActive]);

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
    </section>
  );
}

interface SuggestionsProps {
  mode: PanelMode;
  onModeChange(mode: PanelMode): void;
  tab: SuggestionTab;
  onTabChange(tab: SuggestionTab): void;
  activeSegment: Segment | undefined;
  activeIssue: QaIssue | undefined;
  issues: QaIssue[];
  matches: TmEntry[];
  onInsert(target: string): void;
}

function SuggestionsPanel({
  mode,
  onModeChange,
  tab,
  onTabChange,
  activeSegment,
  activeIssue,
  issues,
  matches,
  onInsert,
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
            <EmptySuggestion
              icon={<BookOpen size={20} />}
              label="No termbase attached"
            />
          ) : tab === "assistant" ? (
            <AssistantPanel
              activeSegment={activeSegment}
              onUseTarget={onInsert}
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
