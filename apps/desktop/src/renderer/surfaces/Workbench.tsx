import { useState } from "react";
import type { ProjectBatchImportResult, TmEntry } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import type { SessionContext } from "../state/app-state";
import type { SegmentEditState } from "../state/save-coordinator";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { shouldMountPdfDock } from "../state/pdf-review";
import type { PdfReviewApi } from "../state/use-pdf-review";
import type { ReimportApi } from "../state/use-reimport-controller";
import { useContainerDensity } from "../state/use-container-density";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { ReimportDialog } from "../insights/ReimportDialog";
import { BatchImportSummary } from "../workbench/BatchImportSummary";
import { DocumentSwitcher } from "../workbench/DocumentSwitcher";
import { EditorCommandBar } from "../workbench/EditorCommandBar";
import { EditorPanels } from "../workbench/EditorPanels";
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
  selectedSegmentIds = [],
  onToggleSelect,
  onSelectSegment,
  onDraftChange,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onToggleTm,
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
          <p className="workbench__header-sub">
            <span className="truncate">{ctx.project.name}</span>
            {counts ? (
              <span className="counts-bar">
                <span>
                  <span className="counts-bar__value">{counts.confirmed}</span>
                  confirmed
                </span>
                <span>
                  <span className="counts-bar__value">{counts.draft}</span>
                  draft
                </span>
                <span>
                  <span className="counts-bar__value">
                    {counts.untranslated}
                  </span>
                  open
                </span>
                <span>
                  <span className="counts-bar__value">{counts.total}</span>
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
