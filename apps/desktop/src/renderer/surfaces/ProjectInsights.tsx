import { useState } from "react";
import type { Document, ProjectAnalyticsSummary } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { SectionNav } from "../shell/SectionNav";
import {
  documentDisplayName,
  formatDurationMs,
  presentOptionalMetric,
  progressRows,
  trendRows,
} from "../state/analytics-view";
import {
  InsightsSectionNav,
  type InsightsSection,
} from "../insights/InsightsSectionNav";
import { InteropReviewPanel } from "../insights/InteropReviewPanel";
import { InteropTablePanel } from "../insights/InteropTablePanel";
import { TaskPackagePanel } from "../insights/TaskPackagePanel";
import type { InteropControllerApi } from "../state/use-interop-controller";
import type { TaskPackageApi } from "../state/use-task-package-controller";

export interface ProjectInsightsProps {
  projectName: string;
  analytics: ProjectAnalyticsSummary | null;
  documents: Document[];
  loading: boolean;
  error: UiError | null;
  disabled?: boolean;
  onBack: () => void;
  onRetry: () => void;
  interop?: InteropControllerApi | null;
  taskPackage?: TaskPackageApi | null;
  hasDocument?: boolean;
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
  interop,
  taskPackage,
  hasDocument = false,
}: ProjectInsightsProps) {
  const [section, setSection] = useState<InsightsSection>("analytics");
  const progress = analytics ? progressRows(analytics.progress) : [];
  const trends = analytics ? trendRows(analytics.trends) : [];
  const productivity = analytics?.productivity;

  return (
    <section className="surface" data-testid="project-insights">
      <div className="surface__inner">
        <div className="surface__masthead">
          <h1 className="surface__title">{projectName}</h1>
          <div className="surface__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={disabled}
              onClick={onBack}
            >
              Back
            </button>
            {section === "analytics" ? (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={disabled || loading}
                onClick={onRetry}
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>

        <InsightsSectionNav
          section={section}
          onChange={setSection}
          {...(disabled !== undefined ? { disabled } : {})}
        />

        {section === "analytics" ? (
          <>
            {error ? (
              <p className="error-text">{formatUiError(error)}</p>
            ) : null}
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
                              {(
                                docProgress.completionBasisPoints / 100
                              ).toFixed(
                                docProgress.completionBasisPoints % 100 === 0
                                  ? 0
                                  : 1,
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
                            <OptionalMetric
                              display={presentOptionalMetric(
                                productivity.activeEditingMs,
                                formatDurationMs,
                              )}
                            />
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Confirmed / hour</th>
                          <td>
                            <OptionalMetric
                              display={presentOptionalMetric(
                                productivity.confirmedSegmentsPerHourMilli,
                                (v) => (v / 1000).toFixed(2),
                              )}
                            />
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
          </>
        ) : null}

        {section === "interop" && interop ? (
          <div className="insights-stack" data-testid="insights-interop">
            <SectionNav
              label="Interop mode"
              items={[
                {
                  id: "review" as const,
                  label: "Review",
                  testId: "interop-mode-review",
                },
                {
                  id: "table" as const,
                  label: "Table",
                  testId: "interop-mode-table",
                },
              ]}
              current={interop.state.mode === "table" ? "table" : "review"}
              {...(disabled !== undefined ? { disabled } : {})}
              onSelect={(mode) => interop.setMode(mode)}
            />
            {interop.state.mode === "review" ? (
              <InteropReviewPanel
                interop={interop}
                hasDocument={hasDocument}
                {...(disabled !== undefined ? { disabled } : {})}
              />
            ) : (
              <InteropTablePanel
                interop={interop}
                {...(disabled !== undefined ? { disabled } : {})}
              />
            )}
          </div>
        ) : null}

        {section === "taskPackage" && taskPackage ? (
          <TaskPackagePanel
            taskPackage={taskPackage}
            {...(disabled !== undefined ? { disabled } : {})}
          />
        ) : null}
      </div>
    </section>
  );
}

/**
 * Render an optional metric.
 *
 * An unavailable metric used to print its explanation into the value cell, so
 * a table of numbers contained sentences such as "at least two durable editing
 * events are required". The value column now stays a value column: unavailable
 * reads as a dash, and the Engine reason moves to the tooltip where a curious
 * user can still reach it.
 */
function OptionalMetric({
  display,
}: {
  display:
    { kind: "value"; value: string } | { kind: "unavailable"; reason: string };
}) {
  if (display.kind === "value") {
    return <span className="mono">{display.value}</span>;
  }
  return (
    <span className="metric-unavailable" title={display.reason}>
      <span aria-hidden="true">-</span>
      <span className="sr-only">Unavailable. {display.reason}</span>
    </span>
  );
}
