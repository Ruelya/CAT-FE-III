import { useEffect, useMemo, useState } from "react";
import type {
  EditorWorkflowState,
  InlineTag,
  ProjectBatchImportResult,
  TmMatch,
} from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import type { SessionContext } from "../state/app-state";
import type { SegmentEditState } from "../state/save-coordinator";
import {
  applyDisplayFilter,
  EMPTY_FILTER,
  isFilterActive,
  repeatedSources,
  type DisplayFilter,
} from "../state/display-filter";
import { DisplayFilterBar } from "../workbench/DisplayFilterBar";
import { canStoreTerm, type SegmentSelection } from "../state/editor-selection";
import { rankMatches, type SegmentIntel } from "../state/segment-intel";
import { useSegmentSelection } from "../state/use-segment-selection";
import { useSuggestions } from "../state/use-suggestions";
import { useSegmentAi } from "../state/use-segment-ai";
import { useEditorShortcuts } from "../workbench/use-editor-shortcuts";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { shouldMountPdfDock } from "../state/pdf-review";
import type { PdfReviewApi } from "../state/use-pdf-review";
import type { ReimportApi } from "../state/use-reimport-controller";
import { shareStyle } from "../lib/dom";
import { useContainerDensity } from "../state/use-container-density";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { ReimportDialog } from "../insights/ReimportDialog";
import { BatchImportSummary } from "../workbench/BatchImportSummary";
import { DocumentSwitcher } from "../workbench/DocumentSwitcher";
import { FileNav } from "../workbench/FileNav";
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
  onInsights: () => void;
  onAssets?: () => void;
  onSwitchDocument: (documentId: string) => void;
  onAddFiles: () => void;
  onRecycleDocument: (reason: string) => Promise<boolean>;
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
  onCopySourceToTarget,
  onClearTarget,
  onAcceptSuggestion,
  onApplyAiProposal,
  onPretranslate,
  onPlaceTags,
  pretranslatePending,
  onQa,
  onExport,
  onInsights,
  onAssets,
  onSwitchDocument,
  onAddFiles,
  onRecycleDocument,
  onDismissBatch,
}: WorkbenchProps) {
  const counts = ctx.counts;
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [recycleReason, setRecycleReason] = useState("");
  const [recyclePending, setRecyclePending] = useState(false);
  const [recycleError, setRecycleError] = useState<string | null>(null);
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
  const suggest = useSuggestions({
    enabled: !disabled && editorOps?.preferences?.autocomplete !== false,
    projectId: ctx.project.id,
    segmentId: activeSegmentId,
  });

  const [previewOpen, setPreviewOpen] = useState(true);
  const [quickPlaceOpen, setQuickPlaceOpen] = useState(false);
  useEffect(() => {
    setQuickPlaceOpen(false);
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
    onQuickPlace: () => setQuickPlaceOpen(true),
    onFind: () => editorOps?.openPanel("findReplace"),
    onFindNext: () => {
      const matches = editorOps?.findReplace.matches ?? [];
      if (matches.length === 0) return;
      const current = matches.findIndex((m) => m.segmentId === activeSegmentId);
      const next = matches[(current + 1) % matches.length];
      if (next) void editorOps?.selectFindMatch(next.segmentId);
    },
  });
  // Container-responsive density: dock changes resize the editor without
  // resizing the window, so this cannot be a viewport media query.
  const editorRegionRef = useContainerDensity<HTMLDivElement>();

  // Review mode. Filtering is local to the loaded rows: the Engine already
  // sent them, and a filter that round-trips per keystroke stutters.
  const [filter, setFilter] = useState<DisplayFilter>(EMPTY_FILTER);
  const [goToOpen, setGoToOpen] = useState(false);
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

  return (
    <section className="workbench" data-testid="workbench">
      <div className="workbench__header">
        <div className="workbench__header-meta">
          <h1 className="workbench__header-title">{ctx.document.name}</h1>
          {counts && counts.total > 0 ? (
            // The brand ribbon doing real work: confirmed, draft, and open
            // shares of the document, with a text equivalent beside it.
            // data-geometry: every share below is an Engine count proportion.
            <span
              className="progress-bar workbench__progress"
              role="img"
              aria-label={`${counts.confirmed} of ${counts.total} segments confirmed`}
              title={`${counts.confirmed} confirmed, ${counts.draft} draft, ${counts.untranslated} open`}
            >
              <span
                className="progress-bar__segment progress-bar__segment--confirmed"
                // data-geometry: Engine count proportion.
                style={shareStyle(counts.confirmed, counts.total)}
              />
              <span
                className="progress-bar__segment progress-bar__segment--draft"
                // data-geometry: Engine count proportion.
                style={shareStyle(counts.draft, counts.total)}
              />
              <span
                className="progress-bar__segment progress-bar__segment--open"
                // data-geometry: Engine count proportion.
                style={shareStyle(counts.untranslated, counts.total)}
              />
            </span>
          ) : null}
          <p className="workbench__header-sub">
            <span className="truncate">{ctx.project.name}</span>
            {counts ? (
              <span
                className="counts-bar"
                title={`${counts.confirmed} confirmed, ${counts.draft} draft, ${counts.untranslated} open, ${counts.total} total`}
              >
                <span>
                  <span className="counts-bar__value" data-abbr="C">
                    {counts.confirmed}
                  </span>
                  confirmed
                </span>
                <span>
                  <span className="counts-bar__value" data-abbr="D">
                    {counts.draft}
                  </span>
                  draft
                </span>
                <span>
                  <span className="counts-bar__value" data-abbr="O">
                    {counts.untranslated}
                  </span>
                  open
                </span>
                <span>
                  <span className="counts-bar__value" data-abbr="T">
                    {counts.total}
                  </span>
                  total
                </span>
              </span>
            ) : null}
            {pendingConfirm ? (
              <span className="inline-status" role="status">
                Confirming
              </span>
            ) : null}
          </p>
          <DocumentSwitcher
            documents={ctx.documents}
            activeDocumentId={ctx.document.id}
            disabled={headerBusy}
            pending={switchPending === true}
            onSelect={onSwitchDocument}
            onRecycle={() => {
              setRecycleError(null);
              setRecycleReason("");
              setRecycleOpen(true);
            }}
          />
        </div>
        <div className="workbench__header-actions">
          <div className="workbench__header-secondary">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={headerBusy}
              aria-pressed={previewOpen}
              onClick={() => setPreviewOpen((open) => !open)}
              data-testid="toggle-preview"
            >
              {previewOpen ? "Hide preview" : "Preview"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={headerBusy}
              onClick={onAddFiles}
              data-testid="add-files"
            >
              {addFilesPending ? "Importing" : "Add files"}
            </button>
            {onAssets ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={headerBusy}
                onClick={onAssets}
                data-testid="nav-assets-workbench"
              >
                Assets
              </button>
            ) : null}
            {reimport ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={headerBusy}
                onClick={() => reimport.open()}
                data-testid="reimport-open"
              >
                Reimport
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={headerBusy}
              onClick={onInsights}
            >
              Insights
            </button>
          </div>
          <div className="workbench__header-primary" role="group" aria-label="Job actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={headerBusy || pretranslatePending === true}
              onClick={onPretranslate}
              data-testid="pretranslate"
              title="Fill empty targets from translation memory (Ctrl+Shift+P)"
            >
              {pretranslatePending ? "Pretranslating" : "Pretranslate"}
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={headerBusy}
              onClick={onQa}
              data-testid="workbench-qa"
            >
              QA
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={headerBusy}
              onClick={onExport}
              data-testid="workbench-export"
            >
              Export
            </button>
          </div>
        </div>
      </div>

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
          "workbench__body--with-files",
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
      >
        <FileNav
          documents={ctx.documents}
          activeDocumentId={ctx.document.id}
          progress={progress}
          disabled={headerBusy}
          pending={switchPending === true}
          onSelect={onSwitchDocument}
        />
        {pdfReview &&
        shouldMountPdfDock({
          pageCount: pdfReview.state.pages.length,
          listStatus: pdfReview.state.listStatus,
          listError: pdfReview.state.listError,
        }) ? (
          <PdfPageReview
            pdf={pdfReview}
            {...(disabled !== undefined ? { disabled } : {})}
          />
        ) : null}
        <div className="editor-region" ref={editorRegionRef}>
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
              request: suggest.request,
              dismiss: suggest.dismiss,
              move: suggest.move,
              accept: suggest.accept,
              setActiveIndex: suggest.setActiveIndex,
              onAccepted: (suggestion) =>
                onAcceptSuggestion(suggestion.text, suggest.prefix),
            }}
            quickPlaceOpen={quickPlaceOpen}
            onQuickPlaceOpenChange={setQuickPlaceOpen}
            onPlaceAllTags={onPlaceTags}
          />
          {previewOpen ? (
            <StructurePreview
              rows={visibleRows}
              activeSegmentId={activeSegmentId}
              onJump={(id) => {
                void onSelectSegment(id);
              }}
            />
          ) : null}
          {editorOps ? (
            <EditorPanels
              ops={editorOps}
              disabled={disabled === true}
              sourceTags={activeRow?.sourceTags ?? []}
              tagIssues={activeRow?.tagIssues ?? []}
            />
          ) : null}
        </div>
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
          ai={segmentAi}
          onApplyAiProposal={onApplyAiProposal}
        />
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

      {recycleOpen ? (
        <ConfirmDialog
          title="Recycle document"
          body={`${ctx.document.name} will move to recycle.`}
          confirmLabel="Recycle"
          pending={recyclePending}
          error={recycleError}
          reasonLabel="Reason"
          reason={recycleReason}
          onReasonChange={setRecycleReason}
          onCancel={() => setRecycleOpen(false)}
          onConfirm={() => {
            if (recyclePending) return;
            setRecyclePending(true);
            setRecycleError(null);
            void onRecycleDocument(recycleReason.trim()).then((ok) => {
              setRecyclePending(false);
              if (ok) {
                setRecycleOpen(false);
              } else {
                setRecycleError("Recycle failed.");
              }
            });
          }}
          testId="recycle-document-confirm"
        />
      ) : null}
    </section>
  );
}
