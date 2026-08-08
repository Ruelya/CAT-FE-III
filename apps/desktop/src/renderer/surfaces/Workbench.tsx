import type { TmEntry } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import type { SessionContext } from "../state/app-state";
import type { SegmentEditState } from "../state/save-coordinator";
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
  disabled?: boolean;
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
  disabled,
  onSelectSegment,
  onDraftChange,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onToggleTm,
  onQa,
  onExport,
}: WorkbenchProps) {
  const counts = ctx.counts;

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
          {transitionError ? (
            <p className="error-text">{formatUiError(transitionError)}</p>
          ) : null}
          {editState?.journalError ? (
            <p className="error-text" data-testid="journal-error">
              {formatUiError(editState.journalError)}
            </p>
          ) : null}
        </div>
        <div className="workbench__header-actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={disabled}
            onClick={onQa}
          >
            QA
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={disabled}
            onClick={onExport}
          >
            Export
          </button>
        </div>
      </div>
      <div
        className={
          tmCollapsed
            ? "workbench__body workbench__body--tm-collapsed"
            : "workbench__body"
        }
      >
        <SegmentGrid
          rows={ctx.rows}
          activeSegmentId={activeSegmentId}
          focusSegmentId={focusSegmentId}
          editState={editState}
          disabled={disabled ?? false}
          onSelect={(id) => {
            void onSelectSegment(id);
          }}
          onDraftChange={onDraftChange}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onConfirm={onConfirm}
        />
        <TmExactPanel
          collapsed={tmCollapsed}
          matches={tmMatches}
          loading={tmLoading}
          error={tmError}
          onToggle={onToggleTm}
        />
      </div>
    </section>
  );
}
