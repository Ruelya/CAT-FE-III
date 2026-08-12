import { formatUiError } from "../lib/errors";
import { applyButtonLabel, basenameFromPath } from "../state/interop-view";
import type { InteropControllerApi } from "../state/use-interop-controller";
import { isTerminalPreviewStatus } from "../state/interop-view";

export interface InteropReviewPanelProps {
  interop: InteropControllerApi;
  disabled?: boolean;
  hasDocument: boolean;
}

export function InteropReviewPanel({
  interop,
  disabled,
  hasDocument,
}: InteropReviewPanelProps) {
  const { state, canApply } = interop;
  const preview = state.reviewPreview;
  const terminal = preview ? isTerminalPreviewStatus(preview.status) : false;
  const busy = Boolean(disabled || state.pending);

  return (
    <div className="interop-panel" data-testid="interop-review-panel">
      <div className="interop-panel__toolbar">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !hasDocument}
          onClick={() => {
            void interop.exportReview();
          }}
          data-testid="interop-review-export"
        >
          Export
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => {
            void interop.pickInput();
          }}
          data-testid="interop-review-open"
        >
          Open
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !state.path}
          onClick={() => {
            void interop.preview(0);
          }}
          data-testid="interop-review-preview"
        >
          Preview
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canApply || busy || terminal}
          onClick={() => {
            void interop.apply();
          }}
          data-testid="interop-review-apply"
        >
          {applyButtonLabel(
            preview?.status ?? "open",
            state.selectedRowIds.size,
          )}
        </button>
      </div>

      <div className="interop-panel__fields">
        <div className="field">
          <label className="field__label" htmlFor="interop-review-actor">
            Actor
          </label>
          <input
            id="interop-review-actor"
            className="field__control"
            value={state.actor}
            disabled={busy || terminal}
            onChange={(e) => interop.setActor(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="interop-review-reason">
            Reason
          </label>
          <input
            id="interop-review-reason"
            className="field__control"
            value={state.reason}
            disabled={busy || terminal}
            onChange={(e) => interop.setReason(e.target.value)}
          />
        </div>
      </div>

      {state.path ? (
        <p className="muted" data-testid="interop-review-path">
          {basenameFromPath(state.path)}
        </p>
      ) : null}
      {state.exportNotice ? (
        <p className="muted" data-testid="interop-review-export-notice">
          {state.exportNotice}
        </p>
      ) : null}
      {state.notice ? (
        <p className="muted" data-testid="interop-review-notice">
          {state.notice}
        </p>
      ) : null}
      {state.error ? (
        <p className="error-text">{formatUiError(state.error)}</p>
      ) : null}
      {state.pending ? <p className="muted">Working</p> : null}

      {preview ? (
        <>
          <p className="muted" data-testid="interop-review-status">
            {preview.status}
          </p>
          <table className="data-table" data-testid="interop-review-table">
            <thead>
              <tr>
                <th scope="col">Select</th>
                <th scope="col">Row</th>
                <th scope="col">Disposition</th>
                <th scope="col">Source</th>
                <th scope="col">Target</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => {
                const eligible = row.disposition === "changed";
                return (
                  <tr key={row.rowId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={state.selectedRowIds.has(row.rowId)}
                        disabled={busy || terminal || !eligible}
                        onChange={(e) =>
                          interop.toggleRow(row.rowId, e.target.checked)
                        }
                        aria-label={`Select ${row.rowId}`}
                        data-testid={`interop-review-row-${row.rowId}`}
                      />
                    </td>
                    <td>{row.sourceRow}</td>
                    <td>{row.disposition}</td>
                    <td>{row.sourceText}</td>
                    <td>{row.targetText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {preview.total > preview.limit ? (
            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy || preview.offset <= 0}
                onClick={() => {
                  void interop.preview(
                    Math.max(0, preview.offset - preview.limit),
                  );
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={
                  busy || preview.offset + preview.limit >= preview.total
                }
                onClick={() => {
                  void interop.preview(preview.offset + preview.limit);
                }}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
