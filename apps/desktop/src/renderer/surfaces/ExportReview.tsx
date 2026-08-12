import type { QaGateResult } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import type { SessionContext } from "../state/app-state";

export interface ExportReviewProps {
  ctx: SessionContext;
  gate: QaGateResult | null;
  loading: boolean;
  exporting: boolean;
  error: UiError | null;
  resultPath: string | null;
  disabled?: boolean;
  onExport: () => void;
  onBack: () => void;
  onQa: () => void;
}

export function ExportReview({
  ctx,
  gate,
  loading,
  exporting,
  error,
  resultPath,
  disabled,
  onExport,
  onBack,
  onQa,
}: ExportReviewProps) {
  const busy = disabled || loading || exporting;

  return (
    <section className="surface" data-testid="export-review">
      <div className="surface__masthead">
        <div>
          <h1 className="surface__title">Export</h1>
          <p className="muted">{ctx.document.name}</p>
        </div>
        <div className="workbench__header-actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={disabled}
            onClick={onBack}
          >
            Workbench
          </button>
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
            className="btn btn--primary"
            disabled={busy}
            onClick={onExport}
          >
            {loading ? "Checking gate" : exporting ? "Exporting" : "Export"}
          </button>
        </div>
      </div>

      {gate ? (
        <div className="surface__panel">
          <p>
            Gate: <strong>{gate.clear ? "Clear" : "Blocked"}</strong>
            {` · ${gate.errorCount} errors · ${gate.warningCount} warnings`}
          </p>
          {!gate.clear ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={disabled}
              onClick={onQa}
            >
              Open QA
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="error-text">{formatUiError(error)}</p> : null}
      {resultPath ? (
        <p className="inline-status" data-testid="export-result">
          Exported: {resultPath}
        </p>
      ) : null}
    </section>
  );
}
