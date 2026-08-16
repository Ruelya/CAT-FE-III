import {
  CheckCircle,
  Prohibit,
  Export as ExportIcon,
} from "@phosphor-icons/react";
import type { QaGateResult } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import type { JobScope } from "../lib/job-scope";
import type { SessionContext } from "../state/app-state";
import { JobScopeToggle } from "../workbench/JobScopeToggle";

export interface ExportReviewProps {
  ctx: SessionContext;
  gate: QaGateResult | null;
  loading: boolean;
  exporting: boolean;
  error: UiError | null;
  resultPath: string | null;
  disabled?: boolean;
  scope: JobScope;
  blockedFiles?: Array<{ id: string; name: string; errorCount: number }>;
  resultFiles?: Array<{ name: string; path: string }>;
  onScopeChange: (scope: JobScope) => void;
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
  scope,
  blockedFiles = [],
  resultFiles = [],
  onScopeChange,
  onExport,
  onBack,
  onQa,
}: ExportReviewProps) {
  const busy = disabled || loading || exporting;
  const pending = loading || exporting;
  const jobWide = scope === "job" && ctx.documents.length > 1;

  return (
    <section className="surface" data-testid="export-review">
      <div className="surface__inner">
        <div className="surface__masthead">
          <div className="surface__masthead-meta">
            <h1 className="surface__title">Export</h1>
            <p className="surface__subtitle">
              Generate the translated file in the original format (Generate
              Target Translation)
              {jobWide
                ? ` · ${ctx.documents.length} files in this job`
                : ` · ${ctx.document.name}`}
            </p>
          </div>
          <div className="surface__actions">
            <JobScopeToggle
              scope={scope}
              fileCount={ctx.documents.length}
              disabled={busy}
              onChange={onScopeChange}
            />
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
              onClick={onQa}
            >
              QA
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              data-pending={pending ? "true" : undefined}
              onClick={onExport}
            >
              {loading ? "Checking gate" : exporting ? "Exporting" : "Export"}
            </button>
          </div>
        </div>

        {gate ? (
          <div
            className={`gate-card gate-card--${gate.clear ? "clear" : "blocked"}`}
            data-testid="export-gate"
          >
            <div className="gate-card__head">
              {gate.clear ? (
                <CheckCircle size={20} weight="bold" aria-hidden="true" />
              ) : (
                <Prohibit size={20} weight="bold" aria-hidden="true" />
              )}
              <p className="gate-card__title">
                Quality gate {gate.clear ? "clear" : "blocked"}
              </p>
            </div>
            <span className="counts-bar">
              <span>
                <span className="counts-bar__value">{gate.errorCount}</span>
                errors
              </span>
              <span>
                <span className="counts-bar__value">{gate.warningCount}</span>
                warnings
              </span>
            </span>
            {blockedFiles.length > 0 ? (
              <ul className="export-blocked" data-testid="export-blocked-files">
                {blockedFiles.map((file) => (
                  <li key={file.id}>
                    {file.name}: {file.errorCount}{" "}
                    {file.errorCount === 1 ? "error" : "errors"}
                  </li>
                ))}
              </ul>
            ) : null}
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
        ) : !pending && !error ? (
          // No action here: Export in the masthead is the single primary
          // action for this surface, and repeating it would be a duplicate.
          <div className="empty-state" data-testid="export-idle">
            <ExportIcon
              size={24}
              weight="regular"
              className="empty-state__icon"
              aria-hidden="true"
            />
            <h2 className="empty-state__title">Quality gate not checked yet</h2>
          </div>
        ) : null}

        {pending && !gate ? (
          <div
            className="skeleton-stack"
            role="status"
            aria-label="Checking the quality gate"
          >
            <div className="skeleton skeleton-row" />
          </div>
        ) : null}

        {error ? (
          <p className="error-text" role="alert">
            {formatUiError(error)}
          </p>
        ) : null}

        {resultPath ? (
          <div
            className="export-result settle-pulse"
            role="status"
            data-testid="export-result"
          >
            <p>
              <CheckCircle size={16} weight="bold" aria-hidden="true" />
              Exported to <span className="mono">{resultPath}</span>
            </p>
            {resultFiles.length > 1 ? (
              <ul data-testid="export-result-files">
                {resultFiles.map((file) => (
                  <li key={file.path}>
                    {file.name}: <span className="mono">{file.path}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
