import { useEffect, useState } from "react";
import type { ProjectBatchImportResult, TmEntry } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import type { SessionContext } from "../state/app-state";
import type { SegmentEditState } from "../state/save-coordinator";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { BatchImportSummary } from "../workbench/BatchImportSummary";
import { DocumentSwitcher } from "../workbench/DocumentSwitcher";
import { EditorCommandBar } from "../workbench/EditorCommandBar";
import { EditorPanels } from "../workbench/EditorPanels";
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

  useEffect(() => {
    // Keep multi-select membership in sync when active changes without toggle
  }, [activeSegmentId]);

  return (
    <section className="workbench" data-testid="workbench">
      <div className="workbench__header">
        <div className="workbench__header-meta">
          <h1 className="workbench__header-title">{ctx.document.name}</h1>
          <p className="workbench__header-sub">
            {ctx.project.name}
            {counts ? (
              <span className="counts-bar" style={{ marginLeft: 12 }}>
                <span>{counts.confirmed} confirmed</span>
                <span>{counts.draft} draft</span>
                <span>{counts.untranslated} open</span>
                <span>{counts.total} total</span>
              </span>
            ) : null}
            {pendingConfirm ? (
              <span className="inline-status" style={{ marginLeft: 12 }}>
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
          {transitionError ? (
            <p className="error-text">{formatUiError(transitionError)}</p>
          ) : null}
          {editState?.journalError ? (
            <p className="error-text" data-testid="journal-error">
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

      {editorOps ? (
        <EditorCommandBar ops={editorOps} disabled={disabled === true} />
      ) : null}

      <div
        className={
          tmCollapsed
            ? "workbench__body workbench__body--tm-collapsed"
            : "workbench__body"
        }
      >
        <div className="workbench__main">
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
