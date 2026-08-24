import { useEffect, useMemo, useState } from "react";
import type {
  EditorWorkflowState,
  InlineTag,
  ProjectBatchImportResult,
  TermMatch,
  TmMatch,
} from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import {
  readGroupAdjacentTags,
  readProtectTags,
  writeGroupAdjacentTags,
  writeProtectTags,
  type SessionContext,
} from "../state/app-state";
import type { SegmentEditState } from "../state/save-coordinator";
import {
  applyDisplayFilter,
  EMPTY_FILTER,
  isFilterActive,
  repeatedSources,
  type DisplayFilter,
} from "../state/display-filter";
import { useEditorDisplay } from "../state/use-editor-display";
import { DisplayFilterBar } from "../workbench/DisplayFilterBar";
import {
  canStoreTerm,
  readSegmentSelection,
  type SegmentSelection,
} from "../state/editor-selection";
import { useAcpChat } from "../state/use-acp-chat";
import { useTermExtract } from "../state/use-term-extract";
import {
  readWorkbenchLayout,
  writeWorkbenchLayout,
} from "../state/workbench-layout";
import { ActivityBar } from "../workbench/ActivityBar";
import { AcpChatPanel } from "../workbench/AcpChatPanel";
import { DockSash } from "../workbench/DockSash";
import { SegmentContextMenu } from "../workbench/SegmentContextMenu";
import {
  segmentContextActions,
  splicePlain,
  type ContextMenuField,
} from "../workbench/segment-context-menu";
import {
  nextInsertableTerm,
  termSourceHighlights,
} from "../lib/term-source";
import { segmentNumber } from "../lib/format";
import { toggleDockFocus } from "../workbench/dock-focus";
import { matchLabel, rankMatches, type SegmentIntel } from "../state/segment-intel";
import { nextFindSegmentId } from "../state/search-navigation";
import { useSegmentSelection } from "../state/use-segment-selection";
import { useSuggestions } from "../state/use-suggestions";
import { useAiSuggest } from "../state/use-ai-suggest";
import {
  completionSuffix,
  firstAcceptUnit,
} from "../lib/inline-completion";
import { isOcrStructuralPath } from "../lib/structure-label";
import { countWords } from "../lib/word-count";
import { useSegmentAi } from "../state/use-segment-ai";
import { useEditorShortcuts } from "../workbench/use-editor-shortcuts";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { shouldMountPdfDock } from "../state/pdf-review";
import type { PdfReviewApi } from "../state/use-pdf-review";
import type { ReimportApi } from "../state/use-reimport-controller";
import { useContainerDensity } from "../state/use-container-density";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { ToastStack, type ToastItem } from "../shell/ToastStack";
import { ReimportDialog } from "../insights/ReimportDialog";
import { BatchImportSummary } from "../workbench/BatchImportSummary";
import { FileNav } from "../workbench/FileNav";
import { WorkbenchStatus } from "../workbench/WorkbenchStatus";
import { StructurePreview } from "../workbench/StructurePreview";
import { useDocumentProgress } from "../state/use-document-progress";
import { EditorCommandBar } from "../workbench/EditorCommandBar";
import { EditorPanels } from "../workbench/EditorPanels";
import { PdfPageReview } from "../workbench/PdfPageReview";
import { SegmentGrid } from "../workbench/SegmentGrid";
import { IntelDock } from "../workbench/IntelDock";
import { GoToDialog } from "../workbench/GoToDialog";

export interface WorkbenchProps {
  ctx: SessionContext;
  activeSegmentId: string | null;
  focusSegmentId: string | null;
  editState: SegmentEditState | null;
  intel: SegmentIntel;
  tmCollapsed: boolean;
  transitionError: UiError | null;
  pendingConfirm: boolean;
  switchPending?: boolean;
  addFilesPending?: boolean;
  batchResult?: ProjectBatchImportResult | null;
  propagatedFrom?: {
    segmentId: string;
    count: number;
    otherFiles?: number;
  } | null;
  /** Per-segment QA finding counts, for row marks and the QA filter. */
  qaCounts: Readonly<Record<string, number>>;
  disabled?: boolean;
  editorOps?: EditorOperationsApi | null;
  pdfReview?: PdfReviewApi | null;
  reimport?: ReimportApi | null;
  selectedSegmentIds?: string[];
  onToggleSelect?: (segmentId: string) => void;
  onSelectSegment: (segmentId: string) => void;
  onDraftChange: (text: string) => void;
  onTagsChange?: (tags: InlineTag[]) => void;
  onSetWorkflow?: (
    segmentId: string,
    state: EditorWorkflowState,
    reason?: string,
  ) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onConfirm: (event?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
    altKey?: boolean;
    shiftKey?: boolean;
  }) => void;
  onToggleTm: () => void;
  onApplyMatch: (match: TmMatch) => void;
  onInsertTerm: (translation: string) => void;
  onConcordance: (
    query: string | undefined,
    selection: SegmentSelection,
  ) => void;
  onQuickAddTerm: (selection: SegmentSelection) => void;
  /** Look a phrase up in mounted termbases, not just the current segment. */
  onSearchTerms?: (query: string) => Promise<TermMatch[]>;
  onCopySourceToTarget: () => void;
  onClearTarget: () => void;
  /** Replace the partially typed word with the accepted completion. */
  onAcceptSuggestion: (text: string, prefix: string) => void;
  onApplyAiProposal: (text: string) => void;
  onPretranslate: () => void;
  /** Ctrl+S / File → Save: flush the active draft now. */
  onSave?: () => void;
  onPlaceTags: () => void;
  pretranslatePending?: boolean;
  onPage?: (offset: number) => void;
  /** Go To a segment that lives on another engine page. */
  onGoToOrdinal?: (ordinal: number) => void;
  onSwitchDocument: (documentId: string) => void;
  onAddFiles: () => void;
  onAssets?: () => void;
  onDismissBatch?: () => void;
}

export function Workbench({
  ctx,
  activeSegmentId,
  focusSegmentId,
  editState,
  intel,
  tmCollapsed,
  transitionError,
  pendingConfirm,
  switchPending,
  addFilesPending,
  batchResult,
  propagatedFrom,
  qaCounts,
  disabled,
  editorOps,
  pdfReview,
  reimport,
  selectedSegmentIds = [],
  onToggleSelect,
  onSelectSegment,
  onDraftChange,
  onTagsChange,
  onSetWorkflow,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onToggleTm,
  onApplyMatch,
  onInsertTerm,
  onConcordance,
  onQuickAddTerm,
  onSearchTerms,
  onCopySourceToTarget,
  onClearTarget,
  onAcceptSuggestion,
  onApplyAiProposal,
  onPretranslate,
  onSave,
  onPlaceTags,
  pretranslatePending,
  onPage,
  onGoToOrdinal,
  onSwitchDocument,
  onAddFiles,
  onAssets,
  onDismissBatch,
}: WorkbenchProps) {
  const counts = ctx.counts;
  const headerBusy = Boolean(
    disabled || switchPending || addFilesPending || pendingConfirm,
  );

  const activeRow = ctx.rows.find((r) => r.segment.id === activeSegmentId);
  const segmentAi = useSegmentAi({
    enabled: !disabled,
    projectId: ctx.project.id,
    segmentId: activeSegmentId,
    segmentRevision: activeRow?.segment.revision ?? null,
  });
  // Selection-driven controls must know whether they can act before they are
  // pressed; a button that silently does nothing teaches users to distrust it.
  const selection = useSegmentSelection(activeSegmentId);
  const canQuickAddTerm = canStoreTerm(selection);

  // As-you-type completion. Enabled from the editor preference that until now
  // had a checkbox and no behaviour behind it.
  const autocompleteOn =
    !disabled && editorOps?.preferences?.autocomplete !== false;
  const suggest = useSuggestions({
    enabled: autocompleteOn,
    projectId: ctx.project.id,
    segmentId: activeSegmentId,
  });
  const [layout, setLayout] = useState(readWorkbenchLayout);
  const persistLayout = (next: typeof layout) => {
    setLayout(writeWorkbenchLayout(next));
  };
  const previewOpen = layout.previewOpen;
  const [quickPlaceOpen, setQuickPlaceOpen] = useState(false);
  const aiSuggest = useAiSuggest({
    enabled: autocompleteOn && !quickPlaceOpen,
    projectId: ctx.project.id,
    segmentId: activeSegmentId,
    segmentRevision: activeRow?.segment.revision ?? null,
  });
  const activeSuggestion = suggest.suggestions[suggest.activeIndex] ?? null;
  const deterministicSuffix = activeSuggestion
    ? completionSuffix(activeSuggestion.text, suggest.prefix)
    : "";
  const inlineText = deterministicSuffix || aiSuggest.suffix;
  const [sourceHighlight, setSourceHighlight] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [termFocusIndex, setTermFocusIndex] = useState(0);
  const [protectTags, setProtectTags] = useState(readProtectTags);
  const [groupAdjacent, setGroupAdjacent] = useState(readGroupAdjacentTags);
  /* M9: each bump replays the leverage flash on the active target cell. */
  const [applyFlashTick, setApplyFlashTick] = useState(0);
  const applyMatchWithFlash = (match: TmMatch) => {
    setApplyFlashTick((tick) => tick + 1);
    onApplyMatch(match);
  };
  const insertTermWithFlash = (translation: string) => {
    setApplyFlashTick((tick) => tick + 1);
    onInsertTerm(translation);
  };
  const [editorDisplay] = useEditorDisplay();
  const termHighlights = useMemo(
    () => termSourceHighlights(intel.terms.matches, onInsertTerm),
    [intel.terms.matches, onInsertTerm],
  );
  useEffect(() => {
    setQuickPlaceOpen(false);
    setSourceHighlight(null);
    setTermFocusIndex(0);
  }, [activeSegmentId]);
  const [signReason, setSignReason] = useState<{
    segmentId: string;
    reason: string;
  } | null>(null);
  const progress = useDocumentProgress(
    ctx.documents,
    ctx.document.id,
    counts ?? null,
  );

  const requestWorkflow = (state: "translation" | "review" | "signed") => {
    if (!activeSegmentId || !onSetWorkflow) return;
    if (state === "signed") {
      setSignReason({ segmentId: activeSegmentId, reason: "" });
      return;
    }
    onSetWorkflow(activeSegmentId, state);
  };

  useEditorShortcuts(!disabled, {
    onConcordance: () => onConcordance(undefined, selection),
    onQuickAddTerm: () => onQuickAddTerm(selection),
    onCopySource: onCopySourceToTarget,
    onClearTarget,
    onGoTo: () => setGoToOpen(true),
    onPretranslate,
    onSave: () => {
      onSave?.();
    },
    onPlaceTags,
    onWorkflowTranslation: () => requestWorkflow("translation"),
    onWorkflowReview: () => requestWorkflow("review"),
    onQuickPlace: () => {
      setQuickPlaceOpen(true);
    },
    onFind: () => editorOps?.openPanel("findReplace"),
    onFindNext: () => {
      const next = nextFindSegmentId(
        editorOps?.findReplace.matches ?? [],
        activeSegmentId,
      );
      if (!next) return;
      void editorOps?.selectFindMatch(next);
    },
    onInsertTerm: () => {
      const hit = nextInsertableTerm(intel.terms.matches, termFocusIndex);
      if (!hit) return;
      insertTermWithFlash(hit.translation);
      setTermFocusIndex(
        intel.terms.matches.length === 0
          ? 0
          : (hit.index + 1) % intel.terms.matches.length,
      );
    },
    onLock: () => requestWorkflow("signed"),
    onToggleDockFocus: () => {
      toggleDockFocus({
        activeSegmentId,
        collapsed: tmCollapsed,
        expand: onToggleTm,
      });
    },
  });
  // Container-responsive density: dock changes resize the editor without
  // resizing the window, so this cannot be a viewport media query.
  const editorRegionRef = useContainerDensity<HTMLDivElement>();

  // Review mode. Filtering is local to the loaded rows: the Engine already
  // sent them, and a filter that round-trips per keystroke stutters.
  const [filter, setFilter] = useState<DisplayFilter>(EMPTY_FILTER);
  const [goToOpen, setGoToOpen] = useState(false);
  const [dismissedToasts, setDismissedToasts] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    field: ContextMenuField;
  } | null>(null);
  const acpChat = useAcpChat({
    enabled: layout.chatOpen && !disabled,
    projectId: ctx.project.id,
    segmentId: activeSegmentId,
    segmentRevision: activeRow?.segment.revision ?? null,
  });
  const termExtract = useTermExtract(ctx.document.id);
  const [termsFocusTick, setTermsFocusTick] = useState(0);
  // Comment counts ride along on the rows the Engine already sent; only the
  // QA counts need their own query.
  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of ctx.rows) {
      const open = row.comments.filter((comment) => !comment.resolved).length;
      if (open > 0) counts[row.segment.id] = open;
    }
    return counts;
  }, [ctx.rows]);
  const filterContext = useMemo(
    () => ({ commentCounts, qaCounts }),
    [commentCounts, qaCounts],
  );
  const visibleRows = useMemo(
    () => applyDisplayFilter(ctx.rows, filter, filterContext),
    [ctx.rows, filter, filterContext],
  );
  const repeats = useMemo(() => repeatedSources(ctx.rows), [ctx.rows]);
  const topTmMatch = rankMatches(intel.tm.matches)[0];

  const runContextAction = async (id: string) => {
    const live = readSegmentSelection(activeSegmentId ?? "");
    const draft =
      editState?.segmentId === activeSegmentId
        ? editState.draftTarget
        : (activeRow?.segment.targetText ?? "");
    if (id === "copy") {
      const text = live.target || live.source || draft || activeRow?.segment.sourceText || "";
      if (text) await navigator.clipboard?.writeText(text);
      return;
    }
    if (id === "cut" && live.target) {
      await navigator.clipboard?.writeText(live.target);
      onDraftChange(splicePlain(draft, live.targetStart, live.targetEnd, ""));
      return;
    }
    if (id === "paste") {
      const clip = (await navigator.clipboard?.readText()) ?? "";
      onDraftChange(splicePlain(draft, live.targetStart, live.targetEnd, clip));
      return;
    }
    if (id === "copySource") {
      onCopySourceToTarget();
      return;
    }
    if (id === "clearTarget") {
      onClearTarget();
      return;
    }
    if (id === "confirm") {
      onConfirm();
      return;
    }
    if (id === "concordance") {
      onConcordance(undefined, live);
      return;
    }
    if (id === "insertTerm") {
      const hit = nextInsertableTerm(intel.terms.matches, termFocusIndex);
      if (hit) insertTermWithFlash(hit.translation);
      return;
    }
    if (id === "addTerm") {
      onQuickAddTerm(live);
      return;
    }
    if (id === "placeTags") {
      onPlaceTags();
      return;
    }
    if (id === "quickPlace") {
      setQuickPlaceOpen(true);
      return;
    }
    if (id === "protectTags") {
      const next = !protectTags;
      setProtectTags(next);
      writeProtectTags(next);
      return;
    }
    if (id === "statusTranslation" && activeSegmentId && onSetWorkflow) {
      onSetWorkflow(activeSegmentId, "translation");
      return;
    }
    if (id === "statusReview" && activeSegmentId && onSetWorkflow) {
      onSetWorkflow(activeSegmentId, "review");
      return;
    }
    if (id === "lock" && activeSegmentId && onSetWorkflow) {
      setSignReason({ segmentId: activeSegmentId, reason: "" });
      return;
    }
    if (id === "goTo") {
      setGoToOpen(true);
      return;
    }
    if (id === "find") {
      editorOps?.runCommand("editor.findReplace");
      return;
    }
    if (id === "split") {
      editorOps?.runCommand("editor.split");
      return;
    }
    if (id === "merge") {
      editorOps?.runCommand("editor.merge");
      return;
    }
    if (id === "comment") {
      editorOps?.runCommand("editor.comments");
      return;
    }
    if (id === "extractTerms") {
      setTermsFocusTick((tick) => tick + 1);
      void termExtract.extract();
    }
  };

  useEffect(() => {
    if (!batchResult || batchResult.failed > 0 || !onDismissBatch) return;
    const timer = window.setTimeout(() => onDismissBatch(), 8000);
    return () => window.clearTimeout(timer);
  }, [batchResult, onDismissBatch]);

  useEffect(() => {
    setDismissedToasts((current) => {
      if (!current.has("transition")) return current;
      const next = new Set(current);
      next.delete("transition");
      return next;
    });
  }, [transitionError]);

  useEffect(() => {
    setDismissedToasts((current) => {
      if (!current.has("journal")) return current;
      const next = new Set(current);
      next.delete("journal");
      return next;
    });
  }, [editState?.journalError]);

  useEffect(() => {
    setDismissedToasts((current) => {
      if (!current.has("propagation")) return current;
      const next = new Set(current);
      next.delete("propagation");
      return next;
    });
  }, [propagatedFrom]);

  useEffect(() => {
    setDismissedToasts((current) => {
      if (!current.has("batch")) return current;
      const next = new Set(current);
      next.delete("batch");
      return next;
    });
  }, [batchResult]);

  const toasts: ToastItem[] = [];
  const toastVisible = (id: string) => !dismissedToasts.has(id);
  if (transitionError && toastVisible("transition")) {
    toasts.push({
      id: "transition",
      tone: "danger",
      children: formatUiError(transitionError),
    });
  }
  if (editState?.journalError && toastVisible("journal")) {
    toasts.push({
      id: "journal",
      tone: "danger",
      testId: "journal-error",
      children: formatUiError(editState.journalError),
    });
  }
  if (propagatedFrom && toastVisible("propagation")) {
    toasts.push({
      id: "propagation",
      tone: "info",
      testId: "propagation-notice",
      children: `Reused this translation in ${propagatedFrom.count} repeated ${
        propagatedFrom.count === 1 ? "segment" : "segments"
      }${
        propagatedFrom.otherFiles
          ? ` (${propagatedFrom.otherFiles} in other files)`
          : ""
      }.`,
    });
  }
  if (batchResult && toastVisible("batch")) {
    toasts.push({
      id: "batch",
      tone: batchResult.failed > 0 ? "danger" : "success",
      children: <BatchImportSummary result={batchResult} />,
    });
  }

  /*
   * Info and success toasts retire on their own: they sit over the term pane,
   * and a notice that needs a pointer trip to clear defeats a keyboard-first
   * editor. Errors stay until the translator closes them.
   */
  const transientToastIds = toasts
    .filter((toast) => toast.tone !== "danger")
    .map((toast) => toast.id)
    .join(" ");
  useEffect(() => {
    if (!transientToastIds) return;
    const ids = transientToastIds.split(" ");
    const timer = window.setTimeout(() => {
      setDismissedToasts((current) => new Set([...current, ...ids]));
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [transientToastIds]);

  return (
    <section className="workbench" data-testid="workbench">
      {editorOps ? (
        <EditorCommandBar
          ops={editorOps}
          disabled={disabled === true}
          extras={{
            onCopySource: onCopySourceToTarget,
            onPlaceTags,
            ...(onSave ? { onSave } : {}),
            onPretranslate,
            pretranslatePending: pretranslatePending === true,
            canCopySource: Boolean(activeRow?.segment.sourceText.trim()),
            canPlaceTags: Boolean(activeRow),
            canSave: Boolean(onSave),
          }}
          {...(activeRow && onSetWorkflow
            ? {
                workflow: {
                  state: activeRow.workflowState,
                  disabled: pendingConfirm,
                  onChange: requestWorkflow,
                },
              }
            : {})}
          {...(activeRow
            ? {
                confirm: {
                  segmentId: activeRow.segment.id,
                  ordinal: activeRow.segment.ordinal,
                  disabled: pendingConfirm,
                  onConfirm: () => onConfirm(),
                },
              }
            : {})}
        />
      ) : null}

      <div
        className={[
          "workbench__body",
          "workbench__body--ide",
          layout.filesOpen ? "workbench__body--with-files" : "",
          layout.chatOpen ? "workbench__body--with-chat" : "",
          tmCollapsed ? "workbench__body--tm-collapsed" : "",
          pdfReview &&
          shouldMountPdfDock({
            pageCount: pdfReview.state.pages.length,
            listStatus: pdfReview.state.listStatus,
            listError: pdfReview.state.listError,
          })
            ? "workbench__body--with-pdf"
            : "",
          pdfReview?.state.dockMode === "collapsed"
            ? "workbench__body--pdf-collapsed"
            : "",
          pdfReview?.state.dockMode === "maximized"
            ? "workbench__body--pdf-maximized"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-geometry="dock widths track the user's sash drags"
        style={{
          ["--file-nav-w" as string]: `${layout.fileNavW}px`,
          ["--panel-w-tm" as string]: `${layout.intelW}px`,
        }}
      >
        <div className="workbench__west">
          <ActivityBar
            filesOpen={layout.filesOpen}
            chatOpen={layout.chatOpen}
            onToggle={(id) => {
              if (id === "files") {
                persistLayout({ ...layout, filesOpen: !layout.filesOpen });
                return;
              }
              persistLayout({ ...layout, chatOpen: !layout.chatOpen });
            }}
          />
          {layout.filesOpen ? (
            <>
              <FileNav
                documents={ctx.documents}
                activeDocumentId={ctx.document.id}
                progress={progress}
                disabled={headerBusy}
                pending={switchPending === true}
                addFilesPending={addFilesPending === true}
                onSelect={onSwitchDocument}
                onAddFiles={onAddFiles}
                onCollapse={() =>
                  persistLayout({ ...layout, filesOpen: false })
                }
              />
              <DockSash
                label="Resize file list"
                onDelta={(delta) =>
                  persistLayout({
                    ...layout,
                    fileNavW: layout.fileNavW + delta,
                  })
                }
              />
            </>
          ) : null}
        </div>
        {pdfReview &&
        shouldMountPdfDock({
          pageCount: pdfReview.state.pages.length,
          listStatus: pdfReview.state.listStatus,
          listError: pdfReview.state.listError,
        }) ? (
          <PdfPageReview
            pdf={pdfReview}
            {...(disabled !== undefined ? { disabled } : {})}
            onSelectSegment={(id) => {
              void onSelectSegment(id);
            }}
          />
        ) : null}
        <div className="editor-region" ref={editorRegionRef}>
          <DisplayFilterBar
            filter={filter}
            shown={visibleRows.length}
            total={ctx.editorPage.total}
            disabled={disabled === true}
            onChange={setFilter}
          />
          <SegmentGrid
            rows={visibleRows}
            page={ctx.editorPage}
            filtered={isFilterActive(filter)}
            commentCounts={commentCounts}
            qaCounts={qaCounts}
            repeatedSources={repeats}
            activeSegmentId={activeSegmentId}
            focusSegmentId={focusSegmentId}
            selectedSegmentIds={selectedSegmentIds}
            editState={editState}
            disabled={disabled ?? false}
            onSelect={(id) => {
              void onSelectSegment(id);
            }}
            {...(onToggleSelect ? { onToggleSelect } : {})}
            onDraftChange={onDraftChange}
            {...(onTagsChange ? { onTagsChange } : {})}
            highlightedSegmentId={
              editorOps?.findReplace.matches.find((m) => m.segmentId === activeSegmentId)
                ? activeSegmentId
                : (editorOps?.findReplace.matches[0]?.segmentId ?? null)
            }
            {...(topTmMatch ? { activeMatchLabel: matchLabel(topTmMatch) } : {})}
            applyFlashTick={applyFlashTick}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onConfirm={onConfirm}
            {...(onPage ? { onPage } : {})}
            onApplyMatchByIndex={(index) => {
              const ranked = rankMatches(intel.tm.matches);
              const match = ranked[index];
              if (match) applyMatchWithFlash(match);
            }}
            suggestions={{
              items: suggest.suggestions,
              activeIndex: suggest.activeIndex,
              request: (text, caret) => {
                suggest.request(text, caret);
                aiSuggest.request(text, caret);
              },
              dismiss: () => {
                suggest.dismiss();
                aiSuggest.dismiss();
              },
              move: suggest.move,
              accept: suggest.accept,
              setActiveIndex: suggest.setActiveIndex,
              onAccepted: (suggestion) =>
                onAcceptSuggestion(suggestion.text, suggest.prefix),
            }}
            {...(inlineText
              ? {
                  inlineCompletion: {
                    text: inlineText,
                    source: deterministicSuffix ? ("suggest" as const) : ("ai" as const),
                    onAccept: () => {
                      if (deterministicSuffix && activeSuggestion) {
                        const chosen = suggest.accept();
                        if (chosen) {
                          onAcceptSuggestion(chosen.text, suggest.prefix);
                        }
                        return;
                      }
                      if (!aiSuggest.suffix) return;
                      onAcceptSuggestion(aiSuggest.suffix, "");
                      aiSuggest.dismiss();
                    },
                    onAcceptWord: () => {
                      const unit = firstAcceptUnit(inlineText);
                      if (!unit) return;
                      onAcceptSuggestion(unit, "");
                      if (deterministicSuffix) {
                        suggest.extendPrefix(unit);
                      } else {
                        suggest.dismiss();
                      }
                      aiSuggest.consume(unit);
                    },
                    onDismiss: () => {
                      suggest.dismiss();
                      aiSuggest.dismiss();
                    },
                  },
                }
              : {})}
            quickPlaceOpen={quickPlaceOpen}
            onQuickPlaceOpenChange={setQuickPlaceOpen}
            onPlaceAllTags={onPlaceTags}
            sourceHighlight={sourceHighlight}
            onSourceHighlight={setSourceHighlight}
            termHighlights={termHighlights}
            protectTags={protectTags}
            onProtectTagsChange={(next) => {
              setProtectTags(next);
              writeProtectTags(next);
            }}
            groupAdjacent={groupAdjacent}
            onGroupAdjacentChange={(next) => {
              setGroupAdjacent(next);
              writeGroupAdjacentTags(next);
            }}
            display={editorDisplay}
            onContextMenu={({ event, field }) => {
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                field,
              });
            }}
          />
          {editorOps ? (
            <EditorPanels
              ops={editorOps}
              disabled={disabled === true}
              sourceTags={activeRow?.sourceTags ?? []}
              tagIssues={activeRow?.tagIssues ?? []}
            />
          ) : null}
        </div>
        <div className="intel-wrap">
          <DockSash
            label="Resize translation memory"
            onDelta={(delta) =>
              persistLayout({
                ...layout,
                intelW: layout.intelW + delta,
              })
            }
          />
          <IntelDock
            placement="stack"
            intel={intel}
            collapsed={tmCollapsed}
            disabled={disabled === true}
            onToggle={onToggleTm}
            onApplyMatch={applyMatchWithFlash}
            onInsertTerm={insertTermWithFlash}
            onConcordance={(query) => onConcordance(query, selection)}
            onQuickAddTerm={() => onQuickAddTerm(selection)}
            canQuickAddTerm={canQuickAddTerm}
            {...(onSearchTerms ? { onSearchTerms } : {})}
            {...(onAssets ? { onAssets } : {})}
            focusedTermIndex={termFocusIndex}
            onFocusedTermIndex={setTermFocusIndex}
            onHighlightTerm={(span) => {
              if (quickPlaceOpen) return;
              setSourceHighlight(span);
            }}
            ai={segmentAi}
            ocrSource={isOcrStructuralPath(activeRow?.segment.structuralPath ?? "")}
            onApplyAiProposal={onApplyAiProposal}
            extract={{
              pending: termExtract.pending,
              error: termExtract.error ? formatUiError(termExtract.error) : null,
              candidates: termExtract.candidates,
              onExtract: () => {
                setTermsFocusTick((tick) => tick + 1);
                void termExtract.extract();
              },
            }}
            termsFocusTick={termsFocusTick}
          />
        </div>
        {layout.chatOpen ? (
          <AcpChatPanel chat={acpChat} disabled={disabled === true} />
        ) : null}
      </div>

      {previewOpen ? (
        <div
          className="preview-drawer"
          data-geometry="drawer height tracks the user's sash drags"
          style={{ ["--preview-h" as string]: `${layout.previewH}px` }}
        >
          <DockSash
            orientation="horizontal"
            label="Resize preview"
            onDelta={(delta) =>
              persistLayout({
                ...layout,
                previewH: layout.previewH - delta,
              })
            }
          />
          <StructurePreview
            rows={visibleRows}
            filterId={ctx.document.filterId}
            format={ctx.document.format}
            documentId={ctx.document.id}
            documentName={ctx.document.name}
            relativePath={ctx.document.relativePath}
            activeSegmentId={activeSegmentId}
            onJump={(id) => {
              void onSelectSegment(id);
            }}
          />
        </div>
      ) : null}

      {reimport ? (
        <ReimportDialog
          reimport={reimport}
          {...(disabled !== undefined ? { disabled } : {})}
        />
      ) : null}

      <WorkbenchStatus
        documentName={ctx.document.name}
        documents={ctx.documents}
        activeDocumentId={ctx.document.id}
        sourceLocale={ctx.project.sourceLocale}
        targetLocale={ctx.project.targetLocale}
        segmentLabel={
          activeRow
            ? `Segment ${segmentNumber(activeRow.segment.ordinal)} of ${
                ctx.editorPage.total || ctx.rows.length
              }`
            : `${ctx.editorPage.total || ctx.rows.length} segments`
        }
        counts={counts}
        wordCount={countWords(
          editState?.segmentId === activeSegmentId
            ? editState.draftTarget
            : (activeRow?.segment.targetText ?? ""),
        )}
        {...(topTmMatch ? { tmLabel: matchLabel(topTmMatch) } : {})}
        {...(isFilterActive(filter)
          ? { filterLabel: `Filter: ${visibleRows.length} shown` }
          : {})}
        {...(editState?.saveState && editState.saveState !== "idle"
          ? { saveState: editState.saveState }
          : {})}
        headerBusy={headerBusy}
        switchPending={switchPending === true}
        pretranslatePending={pretranslatePending === true}
        pendingConfirm={pendingConfirm}
        autocomplete={
          editorOps?.preferences != null
            ? editorOps.preferences.autocomplete !== false
            : null
        }
        previewOpen={previewOpen}
        onSelectDocument={onSwitchDocument}
        onTogglePreview={() =>
          persistLayout({ ...layout, previewOpen: !previewOpen })
        }
        onPretranslate={onPretranslate}
        {...(editorOps
          ? {
              onAutocompleteChange: (next: boolean) => {
                void editorOps.persistPreferenceField("autocomplete", next);
              },
            }
          : {})}
      />
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => {
          setDismissedToasts((current) => new Set([...current, id]));
          if (id === "batch") onDismissBatch?.();
        }}
      />

      {goToOpen ? (
        <GoToDialog
          maxOrdinal={ctx.editorPage.total || ctx.rows.length}
          onClose={() => setGoToOpen(false)}
          onGo={(ordinal) => {
            setGoToOpen(false);
            // The dialog speaks in displayed numbers (engine ordinal + 1),
            // the same numbers the # column shows. Rows hold one engine page,
            // so a number outside it means the target lives on another page.
            const row = ctx.rows.find(
              (item) => segmentNumber(item.segment.ordinal) === ordinal,
            );
            if (row) {
              onSelectSegment(row.segment.id);
              return;
            }
            if (
              onGoToOrdinal &&
              ctx.editorPage.filter === "all" &&
              !ctx.editorPage.query.trim()
            ) {
              onGoToOrdinal(ordinal);
            }
          }}
        />
      ) : null}

      {contextMenu ? (
        <SegmentContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={segmentContextActions({
            field: contextMenu.field,
            hasSourceSelection: Boolean(selection.source),
            hasTargetSelection: Boolean(selection.target),
            canStoreTerm: canQuickAddTerm,
            canInsertTerm: intel.terms.matches.length > 0,
            canConfirm: Boolean(activeRow && !pendingConfirm && !disabled),
            targetHasText: Boolean(
              (editState?.segmentId === activeSegmentId
                ? editState.draftTarget
                : activeRow?.segment.targetText)?.trim(),
            ),
            canCopySource: Boolean(activeRow?.segment.sourceText.trim()),
            canFind: Boolean(editorOps),
            canSplit: Boolean(editorOps?.isAvailable("editor.split")),
            canMerge: Boolean(editorOps?.isAvailable("editor.merge")),
            canComment: Boolean(editorOps?.isAvailable("editor.comments")),
            protectTags,
            canLock: Boolean(activeRow && onSetWorkflow && !disabled),
            canSetWorkflow: Boolean(activeRow && onSetWorkflow && !disabled),
            ...(activeRow ? { workflowState: activeRow.workflowState } : {}),
          })}
          onClose={() => setContextMenu(null)}
          onSelect={(id) => {
            void runContextAction(id);
          }}
        />
      ) : null}

      {signReason && onSetWorkflow ? (
        <ConfirmDialog
          title="Sign off segment"
          body="Signing off locks the segment. The engine will reject further target edits until the workflow is opened again."
          confirmLabel="Sign off"
          reasonLabel="Reason"
          reason={signReason.reason}
          onReasonChange={(reason) =>
            setSignReason((current) =>
              current ? { ...current, reason } : current,
            )
          }
          onCancel={() => setSignReason(null)}
          onConfirm={() => {
            if (!signReason.reason.trim()) return;
            onSetWorkflow(signReason.segmentId, "signed", signReason.reason.trim());
            setSignReason(null);
          }}
          testId="sign-off-confirm"
        />
      ) : null}

    </section>
  );
}
