import type {
  QaIssueDisposition,
  QaIssueView,
  QaSeverity,
  QaSpan,
  Segment,
} from "@translunar/contracts";

/** Severity sort order for list grouping (errors first). */
export const SEVERITY_GROUP_ORDER: readonly QaSeverity[] = [
  "error",
  "warning",
  "info",
] as const;

export type MatrixCellState = "none" | "warn" | "error" | "waived";

export interface HighlightSlice {
  text: string;
  hit: boolean;
}

/**
 * Project loaded issues onto segment ordinals for a Live Matrix cell state.
 * Prefer max severity among open issues; waived only when all issues waived.
 * Caps output length for large documents.
 */
export function buildSeverityMatrix(
  segmentCount: number,
  issues: readonly QaIssueView[],
  options?: { maxCells?: number },
): MatrixCellState[] {
  const maxCells = options?.maxCells ?? 2_000;
  const count = Math.max(0, Math.min(segmentCount, maxCells));
  const states: MatrixCellState[] = Array.from({ length: count }, () => "none");

  type Acc = {
    hasOpenError: boolean;
    hasOpenWarn: boolean;
    hasOpenInfo: boolean;
    hasWaived: boolean;
    hasOpen: boolean;
  };
  const byOrdinal = new Map<number, Acc>();

  for (const issue of issues) {
    const ordinal = issue.segmentOrdinal;
    if (ordinal < 0 || ordinal >= count) continue;
    let acc = byOrdinal.get(ordinal);
    if (!acc) {
      acc = {
        hasOpenError: false,
        hasOpenWarn: false,
        hasOpenInfo: false,
        hasWaived: false,
        hasOpen: false,
      };
      byOrdinal.set(ordinal, acc);
    }
    if (issue.disposition === "waived") {
      acc.hasWaived = true;
      continue;
    }
    if (issue.disposition !== "open") continue;
    acc.hasOpen = true;
    if (issue.severity === "error") acc.hasOpenError = true;
    else if (issue.severity === "warning") acc.hasOpenWarn = true;
    else acc.hasOpenInfo = true;
  }

  for (const [ordinal, acc] of byOrdinal) {
    if (acc.hasOpenError) states[ordinal] = "error";
    else if (acc.hasOpenWarn || acc.hasOpenInfo) states[ordinal] = "warn";
    else if (acc.hasWaived && !acc.hasOpen) states[ordinal] = "waived";
    else states[ordinal] = "none";
  }

  return states;
}

export function countSeverities(issues: readonly QaIssueView[]): {
  error: number;
  warning: number;
  info: number;
  waived: number;
} {
  const counts = { error: 0, warning: 0, info: 0, waived: 0 };
  for (const issue of issues) {
    if (issue.disposition === "waived") {
      counts.waived += 1;
      continue;
    }
    if (issue.disposition !== "open") continue;
    if (issue.severity === "error") counts.error += 1;
    else if (issue.severity === "warning") counts.warning += 1;
    else counts.info += 1;
  }
  return counts;
}

export interface IssueSeverityGroup {
  severity: QaSeverity;
  issues: QaIssueView[];
}

/** Group issues by severity (error → warning → info). */
export function groupIssuesBySeverity(
  issues: readonly QaIssueView[],
): IssueSeverityGroup[] {
  const buckets = new Map<QaSeverity, QaIssueView[]>();
  for (const severity of SEVERITY_GROUP_ORDER) {
    buckets.set(severity, []);
  }
  for (const issue of issues) {
    const list = buckets.get(issue.severity);
    if (list) list.push(issue);
    else {
      const fallback = buckets.get("info")!;
      fallback.push(issue);
    }
  }
  return SEVERITY_GROUP_ORDER.map((severity) => ({
    severity,
    issues: buckets.get(severity) ?? [],
  })).filter((group) => group.issues.length > 0);
}

/**
 * Slice text into highlight ranges from spans. Overlapping spans are merged.
 * Out-of-range spans are clamped.
 */
export function sliceWithSpans(
  text: string,
  spans: readonly QaSpan[] | null | undefined,
): HighlightSlice[] {
  if (!text) {
    return spans?.length ? [] : [{ text: "", hit: false }];
  }
  if (!spans?.length) return [{ text, hit: false }];

  const marks = Array.from({ length: text.length }, () => false);
  for (const span of spans) {
    const start = Math.max(0, Math.min(text.length, Math.floor(span.start)));
    const end = Math.max(start, Math.min(text.length, Math.floor(span.end)));
    for (let i = start; i < end; i += 1) marks[i] = true;
  }

  const slices: HighlightSlice[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const hit = marks[cursor]!;
    let end = cursor + 1;
    while (end < text.length && marks[end] === hit) end += 1;
    slices.push({ text: text.slice(cursor, end), hit });
    cursor = end;
  }
  return slices;
}

/** Prefer human label: category-aware fallback then ruleId as last resort. */
export function ruleDisplayName(
  issue: Pick<QaIssueView, "ruleId" | "category" | "message">,
  categoryLabel?: string,
): string {
  if (categoryLabel?.trim()) return categoryLabel.trim();
  if (issue.category) return issue.category;
  return issue.ruleId;
}

export function findSegment(
  segments: readonly Segment[],
  segmentId: string,
): Segment | null {
  return segments.find((segment) => segment.id === segmentId) ?? null;
}

export function dispositionIsWaived(disposition: QaIssueDisposition): boolean {
  return disposition === "waived";
}

export function nextOpenIssueId(
  issues: readonly QaIssueView[],
  currentId: string | null,
): string | null {
  if (!issues.length) return null;
  const open = issues.filter((item) => item.disposition === "open");
  if (!open.length) return null;
  if (!currentId) return open[0]?.id ?? null;
  const index = open.findIndex((item) => item.id === currentId);
  if (index < 0) return open[0]?.id ?? null;
  return open[index + 1]?.id ?? open[0]?.id ?? null;
}
