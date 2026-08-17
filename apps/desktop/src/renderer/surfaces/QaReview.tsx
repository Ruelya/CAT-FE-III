import { useState } from "react";
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
import type { JobScope } from "../lib/job-scope";
import type { SessionContext } from "../state/app-state";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { JobScopeToggle } from "../workbench/JobScopeToggle";

export interface QaReviewProps {
  ctx: SessionContext;
  issues: QaIssueView[];
  issuesLoaded: boolean;
  run: QaRun | null;
  loading: boolean;
  error: UiError | null;
  disabled?: boolean;
  scope: JobScope;
  onScopeChange: (scope: JobScope) => void;
  onRun: () => void;
  onJump: (segmentId: string, documentId: string) => void;
  /** Set a finding aside with a recorded reason so export can proceed. */
  onWaive: (issueId: string, reason: string) => Promise<boolean>;
  /** Put a waived finding back in force. */
  onRevoke: (issueId: string) => Promise<boolean>;
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
  scope,
  onScopeChange,
  onRun,
  onJump,
  onWaive,
  onRevoke,
  onBack,
  onExport,
}: QaReviewProps) {
  const jobWide = scope === "job" && ctx.documents.length > 1;
  // Waived findings still exist; they simply no longer block. Counting them
  // among the errors would keep telling a reviewer to fix what they have
  // already judged.
  const live = issues.filter((issue) => issue.disposition !== "waived");
  const errorCount = live.filter((i) => i.severity === "error").length;
  const warningCount = live.filter((i) => i.severity === "warning").length;
  const [waivingId, setWaiving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [waivePending, setWaivePending] = useState(false);
  const [waiveError, setWaiveError] = useState<string | null>(null);
  const waivingIssue = issues.find((issue) => issue.id === waivingId) ?? null;

  return (
    <section className="surface" data-testid="qa-review">
      <div className="surface__inner">
        <div className="surface__masthead">
          <div className="surface__masthead-meta">
            <h1 className="surface__title">QA</h1>
            <p className="surface__subtitle">
              {jobWide
                ? `${ctx.documents.length} files in this job`
                : ctx.document.name}
            </p>
          </div>
          <div className="surface__actions">
            <JobScopeToggle
              scope={scope}
              fileCount={ctx.documents.length}
              disabled={disabled || loading}
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
                          {jobWide ? (
                            <span className="truncate">
                              {issue.documentName}
                            </span>
                          ) : null}
                          <span className="mono">{issue.ruleId}</span>
                          {issue.disposition === "waived" ? (
                            <span className="issue-row__waived">
                              {issue.waiver?.reason
                                ? `Waived: ${issue.waiver.reason}`
                                : "Waived"}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="issue-row__actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={disabled}
                          onClick={() =>
                            onJump(issue.segmentId, issue.documentId)
                          }
                          aria-label={`Jump to segment ${segmentNumber(issue.segmentOrdinal)}`}
                        >
                          Jump
                        </button>
                        {issue.disposition === "waived" ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={disabled}
                            data-testid={`revoke-${issue.id}`}
                            onClick={() => {
                              void onRevoke(issue.id);
                            }}
                            aria-label={`Reinstate finding on segment ${segmentNumber(issue.segmentOrdinal)}`}
                          >
                            Reinstate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={disabled}
                            data-testid={`waive-${issue.id}`}
                            onClick={() => setWaiving(issue.id)}
                            aria-label={`Waive finding on segment ${segmentNumber(issue.segmentOrdinal)}`}
                          >
                            Waive
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>

      {waivingId ? (
        <ConfirmDialog
          title="Waive this finding"
          body={
            waivingIssue
              ? `${waivingIssue.message} · #${segmentNumber(waivingIssue.segmentOrdinal)} · ${waivingIssue.ruleId}. The note is stored on this finding. Export then ignores it.`
              : "The note is stored on this finding. Export then ignores it."
          }
          confirmLabel="Waive"
          pending={waivePending}
          error={waiveError}
          reasonLabel="Why export may ignore this"
          reasonHint="Kept on the finding for later review."
          reasonPlaceholder="False positive, client accepted, or intentional difference"
          reasonPresets={[
            "False positive",
            "Client accepted",
            "Intentional difference",
          ]}
          reason={reason}
          onReasonChange={setReason}
          onCancel={() => {
            setWaiving(null);
            setReason("");
            setWaiveError(null);
          }}
          onConfirm={() => {
            if (waivePending) return;
            if (reason.trim().length === 0) {
              setWaiveError("Give a reason before waiving.");
              return;
            }
            setWaivePending(true);
            setWaiveError(null);
            void onWaive(waivingId, reason.trim()).then((ok) => {
              setWaivePending(false);
              if (ok) {
                setWaiving(null);
                setReason("");
              } else {
                setWaiveError("Could not waive this finding.");
              }
            });
          }}
          testId="waive-confirm"
        />
      ) : null}
    </section>
  );
}
