/** Only Engine-safe rows are selectable. */
export function isSafeSelectableRow(row: {
  safeToApply?: boolean;
  disposition?: string;
}): boolean {
  return row.safeToApply === true;
}

/**
 * Merge selection for the current page into the full selection set.
 * Rows not on this page are retained; page rows follow `selectedOnPage`.
 */
export function mergePageSelection(
  current: ReadonlySet<string>,
  pageRowIds: readonly string[],
  selectedOnPage: ReadonlySet<string>,
): Set<string> {
  const next = new Set(current);
  for (const id of pageRowIds) {
    if (selectedOnPage.has(id)) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function isTerminalTaskPreviewStatus(status: string): boolean {
  return status === "applied" || status === "discarded";
}

export function canExportAssignment(input: {
  hasDocuments: boolean;
  actor: string;
  pending: boolean;
}): boolean {
  if (input.pending) return false;
  if (!input.hasDocuments) return false;
  return input.actor.trim().length > 0;
}

export function canExportReturn(input: {
  hasTaskPackageRef: boolean;
  actor: string;
  pending: boolean;
}): boolean {
  if (input.pending) return false;
  if (!input.hasTaskPackageRef) return false;
  return input.actor.trim().length > 0;
}

export function canMutateTaskPreview(input: {
  status: string;
  actor: string;
  pending: boolean;
  selectedCount: number;
}): boolean {
  if (input.pending) return false;
  if (isTerminalTaskPreviewStatus(input.status)) return false;
  if (input.actor.trim().length === 0) {
    return false;
  }
  return input.selectedCount > 0;
}

export function canDiscardOrImport(input: {
  status: string;
  actor: string;
  pending: boolean;
  hasPreview: boolean;
}): boolean {
  if (input.pending) return false;
  if (!input.hasPreview) return false;
  if (isTerminalTaskPreviewStatus(input.status)) return false;
  return input.actor.trim().length > 0;
}

export function taskApplyLabel(status: string, selectedCount: number): string {
  if (status === "applied") return "Applied";
  if (status === "discarded") return "Discarded";
  return `Apply ${selectedCount}`;
}
