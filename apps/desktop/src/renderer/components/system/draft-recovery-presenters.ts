/**
 * Pure helpers for draft recovery multi-select + clipboard escape.
 */

export interface DraftSelectRow {
  segmentId: string;
  stale: boolean;
  /** Engine disconnected / no current revision to compare. */
  unverified?: boolean | undefined;
  targetText: string;
  currentTargetText?: string | undefined;
}

export interface DraftSelectionState {
  /** segmentId → selected */
  selected: Record<string, boolean>;
}

/** Default selection: non-stale on, stale/unverified off. */
export function defaultDraftSelection(
  drafts: readonly DraftSelectRow[],
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const draft of drafts) {
    selected[draft.segmentId] = !draft.stale && !draft.unverified;
  }
  return selected;
}

export function selectedDrafts<T extends DraftSelectRow>(
  drafts: readonly T[],
  selected: Record<string, boolean>,
): T[] {
  return drafts.filter((d) => selected[d.segmentId]);
}

export function joinDraftClipboardTexts(
  drafts: readonly DraftSelectRow[],
): string {
  return drafts
    .map((d) => d.targetText)
    .filter((t) => t.length > 0)
    .join("\n\n---\n\n");
}

export function countSelected(
  selected: Record<string, boolean>,
): number {
  return Object.values(selected).filter(Boolean).length;
}

export function toggleDraftSelection(
  selected: Record<string, boolean>,
  segmentId: string,
  next?: boolean,
): Record<string, boolean> {
  const current = Boolean(selected[segmentId]);
  return {
    ...selected,
    [segmentId]: next === undefined ? !current : next,
  };
}

export function selectAllDrafts(
  drafts: readonly DraftSelectRow[],
  onlyRestorable = false,
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const draft of drafts) {
    if (onlyRestorable) {
      selected[draft.segmentId] = !draft.stale && !draft.unverified;
    } else {
      selected[draft.segmentId] = true;
    }
  }
  return selected;
}

export function clearDraftSelection(
  drafts: readonly DraftSelectRow[],
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const draft of drafts) {
    selected[draft.segmentId] = false;
  }
  return selected;
}

/** Mark whether restore is allowed for a row. */
export function canRestoreDraft(draft: DraftSelectRow): boolean {
  return !draft.stale && !draft.unverified;
}
