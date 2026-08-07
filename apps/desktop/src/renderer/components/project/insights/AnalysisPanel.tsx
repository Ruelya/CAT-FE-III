import type {
  AnalysisProfile,
  AnalysisRunResult} from "@translunar/contracts";
import { BarChart3, Check, FileClock, ShieldAlert } from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";
import {
  Definition,
  Metric,
  SectionHeading,
  UnavailableState} from "./insightsShared";

export interface AnalysisPanelProps {
  profiles: AnalysisProfile[];
  profileId: string;
  result: AnalysisRunResult | null;
  busy: boolean;
  onProfile(value: string): void;
  onRun(): void;
}

export function AnalysisPanel({
  profiles,
  profileId,
  result,
  busy,
  onProfile,
  onRun}: AnalysisPanelProps) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="insights-analysis-layout">
      <section className="insights-section analysis-controls">
        <SectionHeading
          eyebrow={t("insights.engineSnapshot")}
          title={t("insights.analysis")}
          icon={<FileClock size={18} aria-hidden="true" />}
        />
        <label>
          <span>{t("setup.analysisProfile")}</span>
          <select
            value={profileId}
            onChange={(event) => onProfile(event.currentTarget.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · r{profile.revision}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          type="button"
          onClick={onRun}
          disabled={busy || profiles.length === 0}
        >
          {busy ? null : (
            <BarChart3 size={14} aria-hidden="true" />
          )}
          {t("insights.runAnalysis")}
        </button>
      </section>

      {result ? (
        <section className="insights-section analysis-results">
          <SectionHeading
            eyebrow={t("insights.profileRevision", {
              profile: result.profileId,
              revision: result.profileRevision})}
            title={
              result.stale
                ? t("insights.staleAnalysis")
                : t("insights.analysisSnapshot")
            }
            icon={
              result.stale ? (
                <ShieldAlert size={18} aria-hidden="true" />
              ) : (
                <Check size={18} aria-hidden="true" />
              )
            }
          />
          {result.stale ? (
            <div className="insights-stale-banner" role="status">
              <span>{t("insights.staleAnalysisBanner")}</span>
              <button
                type="button"
                className="button secondary"
                onClick={onRun}
                disabled={busy}
              >
                {t("insights.runAnalysis")}
              </button>
            </div>
          ) : null}
          <div className="analysis-summary-grid">
            <Metric
              label={t("common.segments")}
              value={formatNumber(result.summary.segments)}
            />
            <Metric
              label={t("insights.sourceWords")}
              value={formatNumber(result.summary.sourceWords)}
            />
            <Metric
              label={t("insights.sourceChars")}
              value={formatNumber(result.summary.sourceCharacters)}
            />
            <Metric
              label={t("insights.sourceCjk")}
              value={formatNumber(result.summary.sourceCjkCharacters)}
            />
            <Metric
              label={t("insights.targetWords")}
              value={formatNumber(result.summary.targetWords)}
            />
            <Metric
              label={t("insights.targetChars")}
              value={formatNumber(result.summary.targetCharacters)}
            />
            <Metric
              label={t("insights.targetCjk")}
              value={formatNumber(result.summary.targetCjkCharacters)}
            />
            <Metric
              label={t("insights.repetitions")}
              value={formatNumber(result.summary.repeatedSegments)}
            />
            <Metric
              label={t("insights.weightedEffort")}
              value={t("insights.milliUnits", {
                value: formatNumber(result.summary.weightedEffortMilliUnits)})}
            />
          </div>
          <div className="analysis-detail-grid">
            <div>
              <h3>{t("insights.matchBands")}</h3>
              <dl>
                <Definition
                  label={t("insights.exact")}
                  value={formatNumber(result.summary.matchBands.exact)}
                />
                <Definition
                  label={t("insights.match9599")}
                  value={formatNumber(result.summary.matchBands.match9599)}
                />
                <Definition
                  label={t("insights.match8594")}
                  value={formatNumber(result.summary.matchBands.match8594)}
                />
                <Definition
                  label={t("insights.match7584")}
                  value={formatNumber(result.summary.matchBands.match7584)}
                />
                <Definition
                  label={t("insights.match5074")}
                  value={formatNumber(result.summary.matchBands.match5074)}
                />
                <Definition
                  label={t("insights.noMatch")}
                  value={formatNumber(result.summary.matchBands.noMatch)}
                />
                <Definition
                  label={t("insights.repetitions")}
                  value={formatNumber(result.summary.matchBands.repetitions)}
                />
              </dl>
            </div>
            <div>
              <h3>{t("common.workflow")}</h3>
              <dl>
                <Definition
                  label={t("insights.translation")}
                  value={formatNumber(result.summary.workflowTranslation)}
                />
                <Definition
                  label={t("insights.review")}
                  value={formatNumber(result.summary.workflowReview)}
                />
                <Definition
                  label={t("insights.signed")}
                  value={formatNumber(result.summary.workflowSigned)}
                />
              </dl>
            </div>
            <div>
              <h3>{t("insights.aiContribution")}</h3>
              <dl>
                <Definition
                  label={t("insights.appliedSegments")}
                  value={formatNumber(
                    result.summary.aiContribution.appliedSegments,
                  )}
                />
                <Definition
                  label={t("insights.retainedSegments")}
                  value={formatNumber(
                    result.summary.aiContribution.retainedSegments,
                  )}
                />
                <Definition
                  label={t("insights.replacedSegments")}
                  value={formatNumber(
                    result.summary.aiContribution.replacedSegments,
                  )}
                />
                <Definition
                  label={t("insights.editDistance")}
                  value={formatNumber(
                    result.summary.aiContribution.editDistance,
                  )}
                />
              </dl>
            </div>
          </div>
        </section>
      ) : (
        <UnavailableState label={t("insights.noAnalysis")} />
      )}
    </div>
  );
}
