import { useState } from "react";
import type { ProjectBatchImportResult, TmEntry } from "@translunar/contracts";

import type { EditorListFilter } from "../lib/bilingual-row-view";
import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import type { SessionContext } from "../state/app-state";
import type { SegmentEditState } from "../state/save-coordinator";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { shouldMountPdfDock } from "../state/pdf-review";
import type { PdfReviewApi } from "../state/use-pdf-review";
import type { LayoutPreviewApi } from "../state/use-layout-preview";
import type { ReimportApi } from "../state/use-reimport-controller";
import { shareStyle } from "../lib/dom";
import { useContainerDensity } from "../state/use-container-density";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { ReimportDialog } from "../insights/ReimportDialog";
import { BatchImportSummary } from "../workbench/BatchImportSummary";
import { DocumentSwitcher } from "../workbench/DocumentSwitcher";
import { EditorCommandBar } from "../workbench/EditorCommandBar";
import { EditorPanels } from "../workbench/EditorPanels";
import { LayoutPreview } from "../workbench/LayoutPreview";
import { PdfPageReview } from "../workbench/PdfPageReview";
import { SegmentGrid } from "../workbench/SegmentGrid";
import { TmExactPanel } from "../workbench/TmExactPanel";

export interface WorkbenchProps {
  ctx: SessionContext;
  activeSegmentId: string | null;
  focusSegmentId: string | null;
  editState: SegmentEditState | null;
  tmMatches: TmEntry[];
  tmLoading: boolean;
  tmError: UiError | null;
  tmCollapsed: boolean;
  transitionError: UiError | null;
  pendingConfirm: boolean;
  switchPending?: boolean;
  addFilesPending?: boolean;
  batchResult?: ProjectBatchImportResult | null;
  disabled?: boolean;
  editorOps?: EditorOperationsApi | null;
  pdfReview?: PdfReviewApi | null;
  reimport?: ReimportApi | null;
  layoutPreview?: LayoutPreviewApi | null;
  selectedSegmentIds?: string[];
  onToggleSelect?: (segmentId: string) => void;
  onSelectSegment: (segmentId: string) => void;
  onDraftChange: (text: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onConfirm: (event?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  }) => void;
  onToggleTm: () => void;
  onQa: () => void;
  onExport: () => void;
  onInsights: () => void;
  onAssets?: () => void;
  onPage?: (offset: number) => void;
  onFilter?: (filter: EditorListFilter) => void;
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
  tmMatches,
  tmLoading,
  tmError,
  tmCollapsed,
  transitionError,
  pendingConfirm,
  switchPending,
  addFilesPending,
  batchResult,
  disabled,
  editorOps,
  pdfReview,
  reimport,
  layoutPreview,
  selectedSegmentIds = [],
  onToggleSelect,
  onSelectSegment,
  onDraftChange,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onToggleTm,
  onPage,
  onFilter,
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
  // Container-responsive density: dock changes resize the editor without
  // resizing the window, so this cannot be a viewport media query.
  const editorRegionRef = useContainerDensity<HTMLDivElement>();

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
          <button
            type="button"
            className="btn btn--secondary"
            disabled={headerBusy}
            onClick={onAddFiles}
            data-testid="add-files"
          >
            {addFilesPending ? "Importing" : "Add files"}
          </button>
          {onAssets ? (
            <button
              type="button"
              className="btn btn--secondary"
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
              className="btn btn--secondary"
              disabled={headerBusy}
              onClick={() => reimport.open()}
              data-testid="reimport-open"
            >
              Reimport
            </button>
          ) : null}
          {layoutPreview ? (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={headerBusy || layoutPreview.loading}
              onClick={() => {
                void layoutPreview.show();
              }}
              data-testid="layout-preview-open"
            >
              {layoutPreview.loading ? "Previewing" : "Layout"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--secondary"
            disabled={headerBusy}
            onClick={onInsights}
          >
            Insights
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={headerBusy}
            onClick={onQa}
          >
            QA
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={headerBusy}
            onClick={onExport}
          >
            Export
          </button>
        </div>
      </div>

      {transitionError || editState?.journalError || batchResult ? (
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
          <SegmentGrid
            rows={ctx.rows}
            page={ctx.editorPage}
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
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onConfirm={onConfirm}
            {...(onPage ? { onPage } : {})}
            {...(onFilter ? { onFilter } : {})}
          />
          {editorOps ? (
            <EditorPanels
              ops={editorOps}
              disabled={disabled === true}
              sourceTags={activeRow?.sourceTags ?? []}
              tagIssues={activeRow?.tagIssues ?? []}
            />
          ) : null}
          {layoutPreview ? <LayoutPreview preview={layoutPreview} /> : null}
        </div>
        <TmExactPanel
          collapsed={tmCollapsed}
          matches={tmMatches}
          loading={tmLoading}
          error={tmError}
          onToggle={onToggleTm}
        />
      </div>

      {reimport ? (
        <ReimportDialog
          reimport={reimport}
          {...(disabled !== undefined ? { disabled } : {})}
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
