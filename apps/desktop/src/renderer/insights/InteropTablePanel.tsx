import { formatUiError } from "../lib/errors";
import {
  applyButtonLabel,
  basenameFromPath,
  isTerminalPreviewStatus,
} from "../state/interop-view";
import type { InteropControllerApi } from "../state/use-interop-controller";

export interface InteropTablePanelProps {
  interop: InteropControllerApi;
  disabled?: boolean;
}

export function InteropTablePanel({
  interop,
  disabled,
}: InteropTablePanelProps) {
  const { state, canApply, matchingLibraries } = interop;
  const preview = state.tablePreview;
  const terminal = preview
    ? isTerminalPreviewStatus(preview.status)
    : false;
  const busy = Boolean(disabled || state.pending);
  const noLibrary = matchingLibraries.length === 0;

  return (
    <div className="interop-panel" data-testid="interop-table-panel">
      <div className="interop-panel__toolbar">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => {
            void interop.pickInput();
          }}
          data-testid="interop-table-open"
        >
          Open
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !state.path || noLibrary}
          onClick={() => {
            void interop.preview(0);
          }}
          data-testid="interop-table-preview"
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
          data-testid="interop-table-apply"
        >
          {applyButtonLabel(
            preview?.status ?? "open",
            state.selectedRowIds.size,
          )}
        </button>
      </div>

      <div className="interop-panel__fields">
        <div className="field">
          <label className="field__label" htmlFor="interop-table-library">
            Library
          </label>
          <select
            id="interop-table-library"
            className="field__control"
            value={state.libraryId ?? ""}
            disabled={busy || terminal || noLibrary}
            onChange={(e) =>
              interop.setLibraryId(e.target.value || null)
            }
            data-testid="interop-table-library"
          >
            {noLibrary ? (
              <option value="">No matching library</option>
            ) : (
              matchingLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="interop-table-actor">
            Actor
          </label>
          <input
            id="interop-table-actor"
            className="field__control"
            value={state.actor}
            disabled={busy || terminal}
            onChange={(e) => interop.setActor(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="interop-table-reason">
            Reason
          </label>
          <input
            id="interop-table-reason"
            className="field__control"
            value={state.reason}
            disabled={busy || terminal}
            onChange={(e) => interop.setReason(e.target.value)}
          />
        </div>
      </div>

      {state.path ? (
        <p className="muted" data-testid="interop-table-path">
          {basenameFromPath(state.path)}
        </p>
      ) : null}
      {state.notice ? (
        <p className="muted" data-testid="interop-table-notice">
          {state.notice}
        </p>
      ) : null}
      {state.error ? (
        <p className="error-text">{formatUiError(state.error)}</p>
      ) : null}
      {state.librariesError ? (
        <p className="error-text">{formatUiError(state.librariesError)}</p>
      ) : null}
      {state.pending ? <p className="muted">Working</p> : null}

      {preview ? (
        <>
          <p className="muted" data-testid="interop-table-status">
            {preview.status}
          </p>
          <table className="data-table" data-testid="interop-table-rows">
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
                const eligible = row.disposition === "valid";
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
                        data-testid={`interop-table-row-${row.rowId}`}
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
        </>
      ) : null}
    </div>
  );
}
