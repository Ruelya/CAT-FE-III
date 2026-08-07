import type { Document, ProjectAnalyticsSummary } from "@translunar/contracts";
import {
  ArrowRight,
  BarChart3,
  Clock3,
  History,
  ShieldAlert,
} from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";
import {
  Definition,
  formatBasisPoints,
  formatDuration,
  formatMilli,
  formatOptionalMetric,
  formatShortDate,
  Metric,
  OptionalReason,
  SectionHeading,
  UnavailableState,
} from "./insightsShared";

export interface OverviewPanelProps {
  analytics: ProjectAnalyticsSummary | null;
  documents: Document[];
  onOpenWorkbench(): void;
  onOpenFiles(): void;
  onOpenHistory(): void;
  onOpenAssets(): void;
  onRunAnalysis?(): void;
  analysisStale?: boolean;
  /** Residual when QA surface not wired. */
  qaActionLabel: string;
  onOpenQa?(): void;
  /** Residual when AI control not wired. */
  aiActionLabel: string;
  onOpenAiControl?(): void;
}

export function OverviewPanel({
  analytics,
  documents,
  onOpenWorkbench,
  onOpenFiles,
  onOpenHistory,
  onOpenAssets,
  onRunAnalysis,
  analysisStale = false,
  qaActionLabel,
  onOpenQa,
  aiActionLabel,
  onOpenAiControl,
}: OverviewPanelProps) {
  const { t, formatNumber, formatDate } = useLocale();
  if (!analytics) {
    return <UnavailableState label={t("insights.analyticsUnavailable")} />;
  }

  const firstDocumentId = documents[0]?.id;

  return (
    <div className="insights-overview">
      {analysisStale ? (
        <div className="insights-stale-banner" role="status">
          <span>{t("insights.staleAnalysisBanner")}</span>
          {onRunAnalysis ? (
            <button
              type="button"
              className="button secondary"
              onClick={onRunAnalysis}
            >
              {t("insights.runAnalysis")}
            </button>
          ) : null}
        </div>
      ) : null}

      <section
        className="insights-metric-strip"
        aria-label={t("insights.progressAria")}
      >
        <Metric
          label={t("insights.completionAria")}
          value={formatBasisPoints(
            analytics.progress.completionBasisPoints,
            formatNumber,
            t,
          )}
        />
        <Metric
          label={t("common.segments")}
          value={analytics.progress.totalSegments}
        />
        <Metric
          label={t("common.confirmed")}
          value={analytics.progress.confirmedSegments}
        />
        <Metric
          label={t("insights.qaBlockers")}
          value={analytics.progress.qaBlockers}
        />
        <Metric
          label={t("common.documents")}
          value={formatNumber(documents.length)}
        />
      </section>

      <div className="insights-overview-grid">
        <section className="insights-section">
          <SectionHeading
            eyebrow={t("common.workflow")}
            title={t("insights.progressAria")}
            icon={<BarChart3 size={18} aria-hidden="true" />}
          />
          <progress
            value={analytics.progress.completionBasisPoints}
            max={10_000}
            aria-label={t("insights.completionAria")}
          />
          <dl className="insights-definition-grid">
            <Definition
              label={t("insights.untranslated")}
              value={analytics.progress.untranslatedSegments}
            />
            <Definition
              label={t("insights.draft")}
              value={analytics.progress.draftSegments}
            />
            <Definition
              label={t("insights.reviewed")}
              value={analytics.progress.reviewedSegments}
            />
            <Definition
              label={t("insights.translation")}
              value={analytics.progress.workflowTranslation}
            />
            <Definition
              label={t("insights.review")}
              value={analytics.progress.workflowReview}
            />
            <Definition
              label={t("insights.signed")}
              value={analytics.progress.workflowSigned}
            />
          </dl>
          <button
            type="button"
            className="button secondary insights-section-action"
            disabled={!firstDocumentId}
            onClick={() => {
              if (firstDocumentId) onOpenWorkbench();
              else onOpenFiles();
            }}
          >
            {t("insights.actionOpenWorkbench")}
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        </section>

        <section className="insights-section">
          <SectionHeading
            eyebrow={t("insights.activity")}
            title={t("insights.productivity")}
            icon={<Clock3 size={18} aria-hidden="true" />}
          />
          <dl className="insights-definition-grid">
            <Definition
              label={t("insights.activeEditing")}
              value={formatOptionalMetric(
                analytics.productivity.activeEditingMs,
                t("insights.unavailable"),
                (value) => formatDuration(value, t, formatNumber),
              )}
            />
            <Definition
              label={t("insights.confirmedPerHour")}
              value={formatOptionalMetric(
                analytics.productivity.confirmedSegmentsPerHourMilli,
                t("insights.unavailable"),
                (value) => formatMilli(value, formatNumber),
              )}
            />
            <Definition
              label={t("insights.activityEvents")}
              value={analytics.productivity.activityEvents}
            />
            <Definition
              label={t("insights.idleThreshold")}
              value={formatDuration(
                analytics.productivity.idleGapMs,
                t,
                formatNumber,
              )}
            />
          </dl>
          <OptionalReason
            metrics={[
              analytics.productivity.activeEditingMs,
              analytics.productivity.confirmedSegmentsPerHourMilli,
            ]}
          />
          <button
            type="button"
            className="button secondary insights-section-action"
            onClick={onOpenHistory}
          >
            {t("insights.actionViewHistory")}
          </button>
        </section>

        <section className="insights-section">
          <SectionHeading
            eyebrow={t("insights.automation")}
            title={t("insights.aiContribution")}
            icon={<ArrowRight size={18} aria-hidden="true" />}
          />
          {analytics.ai.available ? (
            <dl className="insights-definition-grid">
              <Definition
                label={t("insights.appliedSegments")}
                value={analytics.ai.contribution.appliedSegments}
              />
              <Definition
                label={t("insights.retainedSegments")}
                value={analytics.ai.contribution.retainedSegments}
              />
              <Definition
                label={t("insights.replacedSegments")}
                value={analytics.ai.contribution.replacedSegments}
              />
              <Definition
                label={t("insights.retainedChars")}
                value={analytics.ai.contribution.retainedCharacters}
              />
            </dl>
          ) : (
            <UnavailableState
              label={analytics.ai.reason ?? t("insights.aiHistoryUnavailable")}
              compact
            />
          )}
          {onOpenAiControl ? (
            <button
              type="button"
              className="button secondary insights-section-action"
              onClick={onOpenAiControl}
            >
              {t("insights.actionOpenAi")}
            </button>
          ) : (
            <p className="insights-residual">{aiActionLabel}</p>
          )}
        </section>

        <section className="insights-section">
          <SectionHeading
            eyebrow={t("insights.assetHealth")}
            title={t("insights.assetHealth")}
            icon={<ShieldAlert size={18} aria-hidden="true" />}
          />
          <dl className="insights-definition-grid">
            <Definition
              label={t("insights.tmUnits")}
              value={analytics.assets.tmConfirmedUnits}
            />
            <Definition
              label={t("insights.termEntries")}
              value={analytics.assets.termEntries}
            />
            <Definition
              label={t("insights.openBlockers")}
              value={analytics.assets.qaOpenBlockers}
            />
            <Definition
              label={t("insights.tmReuse")}
              value={formatOptionalMetric(
                analytics.assets.tmReuseSegments,
                t("insights.unavailable"),
                formatNumber,
              )}
            />
            <Definition
              label={t("insights.mountedHits")}
              value={formatOptionalMetric(
                analytics.assets.mountedLibraryHitSegments,
                t("insights.unavailable"),
                formatNumber,
              )}
            />
            <Definition
              label={t("insights.curationOutcomes")}
              value={formatOptionalMetric(
                analytics.assets.curationOutcomes,
                t("insights.unavailable"),
                formatNumber,
              )}
            />
          </dl>
          <div className="insights-section-actions">
            <button
              type="button"
              className="button secondary insights-section-action"
              onClick={onOpenAssets}
            >
              {t("insights.actionOpenAssets")}
            </button>
            {onOpenQa ? (
              <button
                type="button"
                className="button secondary insights-section-action"
                onClick={onOpenQa}
              >
                {t("insights.actionOpenQa")}
              </button>
            ) : (
              <p className="insights-residual">{qaActionLabel}</p>
            )}
          </div>
        </section>
      </div>

      <section className="insights-section insights-trends">
        <SectionHeading
          eyebrow={t("insights.recentBuckets")}
          title={t("insights.trends")}
          icon={<History size={18} aria-hidden="true" />}
        />
        {analytics.trends.length ? (
          <div className="insights-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.period")}</th>
                  <th>{t("common.edits")}</th>
                  <th>{t("common.confirmed")}</th>
                  <th>{t("common.workflow")}</th>
                  <th>{t("insights.qaRuns")}</th>
                  <th>{t("insights.tmUnits")}</th>
                  <th>{t("common.terms")}</th>
                </tr>
              </thead>
              <tbody>
                {analytics.trends.map((bucket) => (
                  <tr key={`${bucket.startMs}-${bucket.endMs}`}>
                    <td>{formatShortDate(bucket.startMs, formatDate)}</td>
                    <td>{bucket.targetEdits}</td>
                    <td>{bucket.confirmations}</td>
                    <td>{bucket.workflowTransitions}</td>
                    <td>{bucket.qaRunsCompleted}</td>
                    <td>{bucket.tmUnitsAdded}</td>
                    <td>{bucket.termsAdded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <UnavailableState label={t("insights.noTrendBuckets")} compact />
        )}
        <button
          type="button"
          className="button secondary insights-section-action"
          onClick={onOpenHistory}
        >
          {t("insights.actionViewHistory")}
        </button>
      </section>
    </div>
  );
}
