import type { TmLibrary } from "@translunar/contracts";

/** Review apply only for Engine disposition `changed`. */
export function eligibleReviewRowIds(
  rows: readonly { rowId: string; disposition: string }[],
): string[] {
  return rows.filter((r) => r.disposition === "changed").map((r) => r.rowId);
}

/** Table apply only for Engine disposition `valid`. */
export function eligibleTableRowIds(
  rows: readonly { rowId: string; disposition: string }[],
): string[] {
  return rows.filter((r) => r.disposition === "valid").map((r) => r.rowId);
}

export function isTerminalPreviewStatus(status: string): boolean {
  return status === "applied" || status === "discarded";
}

export function canApplySelection(
  selected: ReadonlySet<string>,
  status: string,
): boolean {
  if (isTerminalPreviewStatus(status)) return false;
  return selected.size > 0;
}

/** Writable libraries matching project locales (Engine fields only). */
export function filterWritableMatchingLibraries(
  libraries: readonly TmLibrary[],
  sourceLocale: string,
  targetLocale: string,
): TmLibrary[] {
  const src = sourceLocale.trim().toLowerCase();
  const tgt = targetLocale.trim().toLowerCase();
  return libraries.filter((lib) => {
    if (!lib.writable) return false;
    return (
      lib.sourceLocale.trim().toLowerCase() === src &&
      lib.targetLocale.trim().toLowerCase() === tgt
    );
  });
}

export function basenameFromPath(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function toggleIdInSet(
  current: ReadonlySet<string>,
  id: string,
  selected: boolean,
): Set<string> {
  const next = new Set(current);
  if (selected) next.add(id);
  else next.delete(id);
  return next;
}

export function initialSelectionFromEligible(
  eligibleIds: readonly string[],
): Set<string> {
  return new Set(eligibleIds);
}

export function applyButtonLabel(
  status: string,
  selectedCount: number,
): string {
  if (status === "applied") return "Applied";
  if (status === "discarded") return "Discarded";
  return `Apply ${selectedCount}`;
}
