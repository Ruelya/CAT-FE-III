import {
  SealCheck,
  WarningCircle,
  WarningDiamond,
  Info,
} from "@phosphor-icons/react";
import type { QaIssueView, QaRun } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { rowEnterProps, withListClass } from "../lib/dom";
import { formatUiError } from "../lib/errors";
import { segmentNumber } from "../lib/format";
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

/** Severity is communicated by colour, icon, and text, never colour alone. */
function SeverityMark({ severity }: { severity: string }) {
  const Icon =
    severity === "error"
      ? WarningCircle
      : severity === "warning"
        ? WarningDiamond
        : Info;
  return (
    <span className={`issue-row__severity issue-row__severity--${severity}`}>
      <Icon size={12} weight="bold" aria-hidden="true" />
      {severity}
    </span>
  );
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
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return (
    <section className="surface" data-testid="qa-review">
      <div className="surface__inner">
        <div className="surface__masthead">
          <div className="surface__masthead-meta">
            <h1 className="surface__title">QA</h1>
            <p className="surface__subtitle">{ctx.document.name}</p>
          </div>
          <div className="surface__actions">
            <button
              type="button"
              className="btn btn--ghost"
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
              data-pending={loading ? "true" : undefined}
              onClick={onRun}
            >
              {loading ? "Running" : "Run QA"}
            </button>
          </div>
        </div>

        {run ? (
          <div className="qa-summary" data-testid="qa-summary">
            <span
              className={`chip chip--${run.errors > 0 ? "error" : "success"}`}
            >
              <span className="chip__dot" aria-hidden="true" />
              {run.status}
            </span>
            <span className="counts-bar">
              <span>
                <span className="counts-bar__value">{run.errors}</span>
                errors
              </span>
              <span>
                <span className="counts-bar__value">{run.warnings}</span>
                warnings
              </span>
            </span>
          </div>
        ) : null}

        {error ? (
          <p className="error-text" role="alert">
            {formatUiError(error)}
          </p>
        ) : null}

        {loading && !issuesLoaded ? (
          <div
            className="skeleton-stack"
            role="status"
            aria-label="Running QA"
            data-testid="qa-loading"
          >
            {[0, 1, 2].map((row) => (
              <div key={row} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}

        {!loading && !error && issuesLoaded && issues.length === 0 ? (
          // Export in the masthead already carries this intent, so the empty
          // state states the fact and does not duplicate the action.
          <div className="empty-state" data-testid="qa-empty">
            <SealCheck
              size={24}
              weight="regular"
              className="empty-state__icon"
              aria-hidden="true"
            />
            <h2 className="empty-state__title">No issues</h2>
          </div>
        ) : null}

        {issues.length > 0 ? (
          <>
            <p className="inline-status" role="status">
              {errorCount} errors and {warningCount} warnings across{" "}
              {issues.length} issues
            </p>
            <ul className="issue-list">
              {issues.map((issue, index) => {
                const canJump = segmentIds.has(issue.segmentId);
                return (
                  <li
                    key={issue.id}
                    {...withListClass("issue-list__item", rowEnterProps(index))}
                  >
                    <div className="issue-row">
                      <div className="issue-row__body">
                        <p className="issue-row__message">
                          <SeverityMark severity={issue.severity} />
                          {issue.message}
                        </p>
                        <p className="issue-row__meta">
                          <span className="mono">
                            #{segmentNumber(issue.segmentOrdinal)}
                          </span>
                          <span className="mono">{issue.ruleId}</span>
                        </p>
                      </div>
                      {canJump ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={disabled}
                          onClick={() => onJump(issue.segmentId)}
                          aria-label={`Jump to segment ${segmentNumber(issue.segmentOrdinal)}`}
                        >
                          Jump
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}
