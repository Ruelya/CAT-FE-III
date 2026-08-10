import type { Document, ProjectAnalyticsSummary } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import {
  documentDisplayName,
  formatDurationMs,
  presentOptionalMetric,
  progressRows,
  trendRows,
} from "../state/analytics-view";

export interface ProjectInsightsProps {
  projectName: string;
  analytics: ProjectAnalyticsSummary | null;
  documents: Document[];
  loading: boolean;
  error: UiError | null;
  disabled?: boolean;
  onBack: () => void;
  onRetry: () => void;
}

export function ProjectInsights({
  projectName,
  analytics,
  documents,
  loading,
  error,
  disabled,
  onBack,
  onRetry,
}: ProjectInsightsProps) {
  const progress = analytics ? progressRows(analytics.progress) : [];
  const trends = analytics ? trendRows(analytics.trends) : [];
  const productivity = analytics?.productivity;

  return (
    <section className="surface" data-testid="project-insights">
      <div className="surface__masthead">
        <h1 className="surface__title">{projectName}</h1>
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={disabled}
            onClick={onBack}
          >
            Back
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={disabled || loading}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      </div>

      {error ? <p className="error-text">{formatUiError(error)}</p> : null}
      {loading ? <p className="muted">Loading</p> : null}

      {analytics ? (
        <div className="insights-stack">
          <section aria-labelledby="insights-progress">
            <h2 id="insights-progress" className="insights-heading">
              Progress
            </h2>
            <table className="data-table">
              <tbody>
                {progress.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="insights-docs">
            <h2 id="insights-docs" className="insights-heading">
              Documents
            </h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Completion</th>
                  <th scope="col">Confirmed</th>
                  <th scope="col">Draft</th>
                  <th scope="col">Open</th>
                  <th scope="col">QA</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(analytics.documentProgress).map(
                  ([documentId, docProgress]) => (
                    <tr key={documentId}>
                      <th scope="row">
                        {documentDisplayName(documentId, documents)}
                      </th>
                      <td>
                        {(docProgress.completionBasisPoints / 100).toFixed(
                          docProgress.completionBasisPoints % 100 === 0 ? 0 : 1,
                        )}
                        %
                      </td>
                      <td>{docProgress.confirmedSegments}</td>
                      <td>{docProgress.draftSegments}</td>
                      <td>{docProgress.untranslatedSegments}</td>
                      <td>{docProgress.qaBlockers}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </section>

          {productivity ? (
            <section aria-labelledby="insights-productivity">
              <h2 id="insights-productivity" className="insights-heading">
                Productivity
              </h2>
              <table className="data-table">
                <tbody>
                  <tr>
                    <th scope="row">Active editing</th>
                    <td>
                      {formatOptional(
                        presentOptionalMetric(
                          productivity.activeEditingMs,
                          formatDurationMs,
                        ),
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Confirmed / hour</th>
                    <td>
                      {formatOptional(
                        presentOptionalMetric(
                          productivity.confirmedSegmentsPerHourMilli,
                          (v) => (v / 1000).toFixed(2),
                        ),
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Activity events</th>
                    <td>{productivity.activityEvents}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          ) : null}

          <section aria-labelledby="insights-trends">
            <h2 id="insights-trends" className="insights-heading">
              Activity
            </h2>
            {trends.length === 0 ? (
              <p className="muted">No trend data</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Range</th>
                    <th scope="col">Confirmations</th>
                    <th scope="col">Edits</th>
                    <th scope="col">QA runs</th>
                    <th scope="col">Workflow</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.map((row) => (
                    <tr key={`${row.startMs}-${row.endMs}`}>
                      <th scope="row">{row.rangeLabel}</th>
                      <td>{row.confirmations}</td>
                      <td>{row.targetEdits}</td>
                      <td>{row.qaRunsCompleted}</td>
                      <td>{row.workflowTransitions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function formatOptional(
  display:
    { kind: "value"; value: string } | { kind: "unavailable"; reason: string },
): string {
  return display.kind === "value" ? display.value : display.reason;
}
