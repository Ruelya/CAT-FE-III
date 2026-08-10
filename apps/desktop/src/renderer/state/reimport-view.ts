import type { ReimportDisposition, ReimportMatch } from "@translunar/contracts";

export function dispositionLabel(disposition: ReimportDisposition): string {
  return disposition;
}

export function canConfirmReimportApply(input: {
  hasPreview: boolean;
  pending: boolean;
  status:
    | "closed"
    | "picking"
    | "previewing"
    | "planReady"
    | "applying"
    | "applied"
    | "error";
}): boolean {
  if (input.pending) return false;
  if (!input.hasPreview) return false;
  return input.status === "planReady";
}

/** Ambiguous items stay visible; selection rules come from Engine plan only. */
export function countByDisposition(
  items: readonly ReimportMatch[],
): Record<ReimportDisposition, number> {
  const counts: Record<ReimportDisposition, number> = {
    unchanged: 0,
    changed: 0,
    new: 0,
    removed: 0,
    ambiguous: 0,
  };
  for (const item of items) {
    counts[item.disposition] = (counts[item.disposition] ?? 0) + 1;
  }
  return counts;
}

export function reimportSummaryLine(plan: {
  unchanged: number;
  changed: number;
  newSegments: number;
  removed: number;
  ambiguous: number;
}): string {
  return [
    `unchanged ${plan.unchanged}`,
    `changed ${plan.changed}`,
    `new ${plan.newSegments}`,
    `removed ${plan.removed}`,
    `ambiguous ${plan.ambiguous}`,
  ].join(" · ");
}
