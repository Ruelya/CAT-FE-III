import { formatUiError } from "../lib/errors";
import type { ReimportApi } from "../state/use-reimport-controller";
import { ModalDialog } from "../shell/ModalDialog";
import { basenameFromPath } from "../state/interop-view";

export interface ReimportDialogProps {
  reimport: ReimportApi;
  disabled?: boolean;
}

export function ReimportDialog({ reimport, disabled }: ReimportDialogProps) {
  const { state, summary, canApply } = reimport;
  if (!state.open) return null;

  const busy = Boolean(disabled || state.pending);

  return (
    <ModalDialog
      title="Reimport"
      testId="reimport-dialog"
      pending={state.pending}
      onCancel={reimport.close}
      initialFocus="first"
      actions={
        <>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => {
              void reimport.pickAndPreview();
            }}
            data-testid="reimport-pick"
          >
            Choose file
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canApply || busy}
            onClick={() => {
              void reimport.apply();
            }}
            data-testid="reimport-apply"
          >
            {state.pending && state.status === "applying"
              ? "Applying"
              : "Apply"}
          </button>
        </>
      }
    >
      {state.path ? (
        <p className="muted" data-testid="reimport-path">
          {basenameFromPath(state.path)}
        </p>
      ) : null}
      {summary ? (
        <p className="muted" data-testid="reimport-summary">
          {summary}
        </p>
      ) : null}
      {state.preview ? (
        <table className="data-table" data-testid="reimport-plan">
          <thead>
            <tr>
              <th scope="col">Disposition</th>
              <th scope="col">Reason</th>
              <th scope="col">Old</th>
              <th scope="col">New</th>
            </tr>
          </thead>
          <tbody>
            {state.preview.plan.items.map((item, index) => (
              <tr key={`${item.disposition}-${index}`}>
                <td>{item.disposition}</td>
                <td>{item.reason}</td>
                <td>{item.oldSegmentId ?? "—"}</td>
                <td>{item.newSegmentId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {state.error ? (
        <p className="field__error">{formatUiError(state.error)}</p>
      ) : null}
      {state.notice ? <p className="muted">{state.notice}</p> : null}
      {state.pending && state.status === "previewing" ? (
        <p className="muted">Loading</p>
      ) : null}
    </ModalDialog>
  );
}
