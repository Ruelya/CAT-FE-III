import type {
  AnalyticsTrendBucket,
  OptionalCountMetric,
  ProgressSummary,
} from "@translunar/contracts";

/** Format basis points (0–10000) as a percentage label. */
export function formatBasisPoints(basisPoints: number): string {
  if (!Number.isFinite(basisPoints)) return "—";
  const pct = basisPoints / 100;
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(1)}%`;
}

/** Format a duration in milliseconds for compact display. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60)
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) {
    return Number.isInteger(minutes)
      ? `${minutes} min`
      : `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} min`;
  }
  const hours = minutes / 60;
  return Number.isInteger(hours)
    ? `${hours} h`
    : `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

export function formatTimestampMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export type MetricDisplay =
  { kind: "value"; value: string } | { kind: "unavailable"; reason: string };

/** Present an optional Engine metric without fabricating zero. */
export function presentOptionalMetric(
  metric: OptionalCountMetric | null | undefined,
  format: (value: number) => string = String,
): MetricDisplay {
  if (!metric) {
    return { kind: "unavailable", reason: "Unavailable" };
  }
  if (!metric.available) {
    return {
      kind: "unavailable",
      reason: metric.reason?.trim() || "Unavailable",
    };
  }
  if (metric.value === null || metric.value === undefined) {
    return {
      kind: "unavailable",
      reason: metric.reason?.trim() || "Unavailable",
    };
  }
  return { kind: "value", value: format(metric.value) };
}

export interface ProgressRow {
  label: string;
  value: string;
}

export function progressRows(progress: ProgressSummary): ProgressRow[] {
  return [
    {
      label: "Completion",
      value: formatBasisPoints(progress.completionBasisPoints),
    },
    { label: "Confirmed", value: String(progress.confirmedSegments) },
    { label: "Draft", value: String(progress.draftSegments) },
    { label: "Untranslated", value: String(progress.untranslatedSegments) },
    { label: "Reviewed", value: String(progress.reviewedSegments) },
    { label: "QA blockers", value: String(progress.qaBlockers) },
    { label: "Total", value: String(progress.totalSegments) },
  ];
}

export interface TrendRow {
  startMs: number;
  endMs: number;
  rangeLabel: string;
  confirmations: number;
  targetEdits: number;
  qaRunsCompleted: number;
  workflowTransitions: number;
  maxActivity: number;
}

export function trendRows(
  buckets: readonly AnalyticsTrendBucket[],
): TrendRow[] {
  return buckets.map((bucket) => {
    const maxActivity = Math.max(
      bucket.confirmations,
      bucket.targetEdits,
      bucket.qaRunsCompleted,
      bucket.workflowTransitions,
      0,
    );
    return {
      startMs: bucket.startMs,
      endMs: bucket.endMs,
      rangeLabel: `${formatTimestampMs(bucket.startMs)} – ${formatTimestampMs(bucket.endMs)}`,
      confirmations: bucket.confirmations,
      targetEdits: bucket.targetEdits,
      qaRunsCompleted: bucket.qaRunsCompleted,
      workflowTransitions: bucket.workflowTransitions,
      maxActivity,
    };
  });
}

export function documentDisplayName(
  documentId: string,
  documents: readonly { id: string; name: string }[],
): string {
  const found = documents.find((d) => d.id === documentId);
  return found?.name ?? documentId;
}
