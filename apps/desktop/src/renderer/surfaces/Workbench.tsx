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
import {
  readWorkbenchLayout,
  writeWorkbenchLayout,
} from "../state/workbench-layout";
import { ActivityBar } from "../workbench/ActivityBar";
import { AcpChatPanel } from "../workbench/AcpChatPanel";
import { DockSash } from "../workbench/DockSash";
import { EditorTabs } from "../workbench/EditorTabs";
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
import { rankMatches, type SegmentIntel } from "../state/segment-intel";
import { useSegmentSelection } from "../state/use-segment-selection";
import { useSuggestions } from "../state/use-suggestions";
import { useAiSuggest } from "../state/use-ai-suggest";
import {
  completionSuffix,
  firstAcceptUnit,
} from "../lib/inline-completion";
import { isOcrStructuralPath } from "../lib/structure-label";
import { useSegmentAi } from "../state/use-segment-ai";
import { useEditorShortcuts } from "../workbench/use-editor-shortcuts";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { shouldMountPdfDock } from "../state/pdf-review";
import type { PdfReviewApi } from "../state/use-pdf-review";
import type { ReimportApi } from "../state/use-reimport-controller";
import { useContainerDensity } from "../state/use-container-density";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { ReimportDialog } from "../insights/ReimportDialog";
import { BatchImportSummary } from "../workbench/BatchImportSummary";
import { FileNav } from "../workbench/FileNav";
import { WorkbenchHeader } from "../workbench/WorkbenchHeader";
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
  onPlaceTags: () => void;
  pretranslatePending?: boolean;
  onQa: () => void;
  onExport: () => void;
  onSwitchDocument: (documentId: string) => void;
  onAddFiles: () => void;
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
  onPlaceTags,
  pretranslatePending,
  onQa,
  onExport,
  onSwitchDocument,
  onAddFiles,
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
  const [previewOpen, setPreviewOpen] = useState(() => readWorkbenchLayout().previewSide);
  const persistLayout = (next: typeof layout) => {
    setLayout(writeWorkbenchLayout(next));
  };
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

  useEditorShortcuts(!disabled, {
    onConcordance: () => onConcordance(undefined, selection),
    onQuickAddTerm: () => onQuickAddTerm(selection),
    onCopySource: onCopySourceToTarget,
    onClearTarget,
    onGoTo: () => setGoToOpen(true),
    onPretranslate,
    onPlaceTags,
    onQuickPlace: () => {
      setQuickPlaceOpen(true);
    },
    onFind: () => editorOps?.openPanel("findReplace"),
    onFindNext: () => {
      const matches = editorOps?.findReplace.matches ?? [];
      if (matches.length === 0) return;
      const current = matches.findIndex((m) => m.segmentId === activeSegmentId);
      const next = matches[(current + 1) % matches.length];
      if (next) void editorOps?.selectFindMatch(next.segmentId);
    },
    onInsertTerm: () => {
      const hit = nextInsertableTerm(intel.terms.matches, termFocusIndex);
      if (!hit) return;
      onInsertTerm(hit.translation);
      setTermFocusIndex(
        intel.terms.matches.length === 0
          ? 0
          : (hit.index + 1) % intel.terms.matches.length,
      );
    },
  });
  // Container-responsive density: dock changes resize the editor without
  // resizing the window, so this cannot be a viewport media query.
  const editorRegionRef = useContainerDensity<HTMLDivElement>();

  // Review mode. Filtering is local to the loaded rows: the Engine already
  // sent them, and a filter that round-trips per keystroke stutters.
  const [filter, setFilter] = useState<DisplayFilter>(EMPTY_FILTER);
  const [goToOpen, setGoToOpen] = useState(false);
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
      if (hit) onInsertTerm(hit.translation);
      return;
    }
    if (id === "addTerm") {
      onQuickAddTerm(live);
      return;
    }
    if (id === "placeTags") {
      onPlaceTags();
    }
  };

  return (
    <section className="workbench" data-testid="workbench">
      <WorkbenchHeader
        documentName={ctx.document.name}
        projectName={ctx.project.name}
        documents={ctx.documents}
        activeDocumentId={ctx.document.id}
        counts={counts}
        headerBusy={headerBusy}
        switchPending={switchPending === true}
        addFilesPending={addFilesPending === true}
        pretranslatePending={pretranslatePending === true}
        pendingConfirm={pendingConfirm}
        previewOpen={previewOpen}
        autocomplete={
          editorOps?.preferences != null
            ? editorOps.preferences.autocomplete !== false
            : null
        }
        onPreviewOpenChange={(open) => {
          setPreviewOpen(open);
          persistLayout({ ...layout, previewSide: open });
        }}
        {...(editorOps
          ? {
              onAutocompleteChange: (next: boolean) => {
                void editorOps.persistPreferenceField("autocomplete", next);
              },
            }
          : {})}
        onSelectDocument={onSwitchDocument}
        onAddFiles={onAddFiles}
        onPretranslate={onPretranslate}
        onQa={onQa}
        onExport={onExport}
      />

      {transitionError ||
      editState?.journalError ||
      batchResult ||
      propagatedFrom ? (
        <div className="workbench__notice">
          {transitionError ? (
            <p className="error-text" role="alert">
              {formatUiError(transitionError)}
            </p>
          ) : null}
          {editState?.journalError ? (
            <p className="error-text" role="alert" data-testid="journal-error">
              {formatUiError(editState.journalError)}
            </p>
          ) : null}
          {propagatedFrom ? (
            <p
              className="inline-status inline-status--leverage"
              role="status"
              data-testid="propagation-notice"
            >
              {`Reused this translation in ${propagatedFrom.count} repeated ${
                propagatedFrom.count === 1 ? "segment" : "segments"
              }${
                propagatedFrom.otherFiles
                  ? ` (${propagatedFrom.otherFiles} in other files)`
                  : ""
              }.`}
            </p>
          ) : null}
          {batchResult ? (
            <BatchImportSummary
              result={batchResult}
              {...(onDismissBatch ? { onDismiss: onDismissBatch } : {})}
            />
          ) : null}
        </div>
      ) : null}

      <div
        className={[
          "workbench__body",
          "workbench__body--ide",
          layout.filesOpen ? "workbench__body--with-files" : "",
          previewOpen ? "workbench__body--with-preview" : "",
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
        style={{
          ["--file-nav-w" as string]: `${layout.fileNavW}px`,
          ["--panel-w-tm" as string]: `${layout.intelW}px`,
          ["--preview-w" as string]: `${layout.previewW}px`,
        }}
      >
        <div className="workbench__west">
          <ActivityBar
            filesOpen={layout.filesOpen}
            previewOpen={previewOpen}
            chatOpen={layout.chatOpen}
            onToggle={(id) => {
              if (id === "files") {
                persistLayout({ ...layout, filesOpen: !layout.filesOpen });
                return;
              }
              if (id === "preview") {
                const next = !previewOpen;
                setPreviewOpen(next);
                persistLayout({ ...layout, previewSide: next });
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
                onSelect={onSwitchDocument}
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
          <EditorTabs
            documents={ctx.documents}
            activeDocumentId={ctx.document.id}
            progress={progress}
            disabled={headerBusy}
            onSelect={onSwitchDocument}
            onAddFiles={onAddFiles}
          />
          {editorOps ? (
            <EditorCommandBar ops={editorOps} disabled={disabled === true} />
          ) : null}
          <DisplayFilterBar
            filter={filter}
            shown={visibleRows.length}
            total={ctx.rows.length}
            disabled={disabled === true}
            onChange={setFilter}
          />
          <SegmentGrid
            rows={visibleRows}
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
            {...(onSetWorkflow
              ? {
                  onSetWorkflow: (segmentId, state) => {
                    if (state === "signed") {
                      const row = ctx.rows.find((item) => item.segment.id === segmentId);
                      if (row && row.workflowState !== "review") {
                        setSignReason({ segmentId, reason: "" });
                        return;
                      }
                    }
                    onSetWorkflow(segmentId, state);
                  },
                }
              : {})}
            highlightedSegmentId={
              editorOps?.findReplace.matches.find((m) => m.segmentId === activeSegmentId)
                ? activeSegmentId
                : (editorOps?.findReplace.matches[0]?.segmentId ?? null)
            }
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onConfirm={onConfirm}
            onApplyMatchByIndex={(index) => {
              const ranked = rankMatches(intel.tm.matches);
              const match = ranked[index];
              if (match) onApplyMatch(match);
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
        {previewOpen ? (
          <div className="preview-dock">
            <DockSash
              label="Resize preview"
              onDelta={(delta) =>
                persistLayout({
                  ...layout,
                  previewW: layout.previewW + delta,
                })
              }
            />
            <StructurePreview
              rows={visibleRows}
              filterId={ctx.document.filterId}
              activeSegmentId={activeSegmentId}
              onJump={(id) => {
                void onSelectSegment(id);
              }}
            />
          </div>
        ) : null}
        {layout.chatOpen ? (
          <AcpChatPanel chat={acpChat} disabled={disabled === true} />
        ) : null}
        <div className="intel-wrap">
          <DockSash
            label="Resize intelligence"
            onDelta={(delta) =>
              persistLayout({
                ...layout,
                intelW: layout.intelW - delta,
              })
            }
          />
          <IntelDock
          intel={intel}
          collapsed={tmCollapsed}
          disabled={disabled === true}
          onToggle={onToggleTm}
          onApplyMatch={onApplyMatch}
          onInsertTerm={onInsertTerm}
          onConcordance={(query) => onConcordance(query, selection)}
          onQuickAddTerm={() => onQuickAddTerm(selection)}
          canQuickAddTerm={canQuickAddTerm}
          {...(onSearchTerms ? { onSearchTerms } : {})}
          focusedTermIndex={termFocusIndex}
          onFocusedTermIndex={setTermFocusIndex}
          onHighlightTerm={(span) => {
            if (quickPlaceOpen) return;
            setSourceHighlight(span);
          }}
          ai={segmentAi}
          ocrSource={isOcrStructuralPath(activeRow?.segment.structuralPath ?? "")}
          onApplyAiProposal={onApplyAiProposal}
        />
        </div>
      </div>

      {reimport ? (
        <ReimportDialog
          reimport={reimport}
          {...(disabled !== undefined ? { disabled } : {})}
        />
      ) : null}

      <div className="workbench__status" data-testid="workbench-status">
        <span>
          {activeSegmentId
            ? `Segment ${
                ctx.rows.findIndex((r) => r.segment.id === activeSegmentId) + 1
              } of ${ctx.rows.length}`
            : `${ctx.rows.length} segments`}
        </span>
        {isFilterActive(filter) ? (
          <span data-testid="status-filter">
            {`Filter: ${visibleRows.length} shown`}
          </span>
        ) : null}
        {pretranslatePending ? (
          <span className="inline-status" role="status">
            Pretranslating
          </span>
        ) : null}
        <span
          className="workbench__status-hint"
          title="Ctrl+G go to · Ctrl+, place tags · Ctrl+Shift+, QuickPlace · Ctrl+Shift+P pretranslate · F3 concordance · Ctrl+1..9 apply match"
        >
          Shortcuts
        </span>
      </div>

      {goToOpen ? (
        <GoToDialog
          maxOrdinal={ctx.rows.length}
          onClose={() => setGoToOpen(false)}
          onGo={(ordinal) => {
            const row = ctx.rows[ordinal - 1];
            setGoToOpen(false);
            if (row) onSelectSegment(row.segment.id);
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
