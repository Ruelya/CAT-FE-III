import type { QaIssueView, QaRun } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import type { SessionContext } from "../state/app-state";

export interface QaReviewProps {
  ctx: SessionContext;
  issues: QaIssueView[];
  issuesLoaded: boolean;
  run: QaRun | null;
  loading: boolean;
  error: UiError | null;
  disabled?: boolean;
  onRun: () => void;
  onJump: (segmentId: string) => void;
  onBack: () => void;
  onExport: () => void;
}

export function QaReview({
  ctx,
  issues,
  issuesLoaded,
  run,
  loading,
  error,
  disabled,
  onRun,
  onJump,
  onBack,
  onExport,
}: QaReviewProps) {
  const segmentIds = new Set(ctx.rows.map((r) => r.segment.id));

  return (
    <section className="surface" data-testid="qa-review">
      <div className="surface__masthead">
        <div>
          <h1 className="surface__title">QA</h1>
          <p className="muted">
            {ctx.document.name}
            {run ? ` · ${run.status} · ${run.errors}E ${run.warnings}W` : ""}
          </p>
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
            onClick={onExport}
          >
            Export
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={disabled || loading}
            onClick={onRun}
          >
            {loading ? "Running" : "Run QA"}
          </button>
        </div>
      </div>
      {error ? <p className="error-text">{formatUiError(error)}</p> : null}
      {loading && !issuesLoaded ? (
        <div className="empty-state" data-testid="qa-loading">
          Loading
        </div>
      ) : null}
      {!loading && !error && issuesLoaded && issues.length === 0 ? (
        <div className="empty-state">No issues</div>
      ) : null}
      <ul className="issue-list">
        {issues.map((issue) => {
          const canJump = segmentIds.has(issue.segmentId);
          return (
            <li key={issue.id} className="issue-row">
              <div>
                <span
                  className={`issue-row__severity issue-row__severity--${issue.severity}`}
                >
                  {issue.severity}
                </span>
                <span>{issue.message}</span>
                <p className="issue-row__meta">
                  <span className="mono">#{issue.segmentOrdinal}</span>
                  <span className="mono">{issue.ruleId}</span>
                </p>
              </div>
              {canJump ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={disabled}
                  onClick={() => onJump(issue.segmentId)}
                >
                  Jump
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
