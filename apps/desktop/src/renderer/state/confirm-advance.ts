import type { SegmentEditorRow } from "@translunar/contracts";

/**
 * Where the caret goes after a segment is confirmed.
 *
 * A translator's hand should never leave the keyboard between segments, and
 * which segment comes next is a decision they make once and then rely on. The
 * three modes match the ones every professional CAT tool binds, because that
 * muscle memory is the thing users bring with them.
 */
export type ConfirmAdvanceMode =
  /** Skip everything already confirmed. The default working rhythm. */
  | "next-unconfirmed"
  /** Strict document order, including segments already dealt with. */
  | "next"
  /** Stay put: used when confirming a segment you are still reasoning about. */
  | "stay";

/** Keyboard contract, kept next to the behaviour it names. */
export const CONFIRM_SHORTCUTS: Record<ConfirmAdvanceMode, string> = {
  "next-unconfirmed": "Ctrl+Enter",
  next: "Ctrl+Alt+Enter",
  stay: "Ctrl+Shift+Enter",
};

/** A segment still needs work unless the Engine says it is confirmed. */
export function isUnconfirmed(row: SegmentEditorRow): boolean {
  return row.segment.state !== "confirmed";
}

/**
 * Pick the segment to activate after confirming `segmentId`.
 *
 * Returns `null` when the caret should stay where it is, which also covers the
 * end of the document: arriving at the last segment with nothing unconfirmed
 * left should feel like finishing, not like being bounced back to the top.
 * Searching forward first and only then wrapping keeps the reading order that
 * translators work in; a segment that propagation just filled with a draft
 * still counts as unconfirmed, because a human has not looked at it yet.
 */
export function nextSegmentAfterConfirm(
  rows: readonly SegmentEditorRow[],
  segmentId: string,
  mode: ConfirmAdvanceMode,
): string | null {
  if (mode === "stay") return null;
  const index = rows.findIndex((row) => row.segment.id === segmentId);
  if (index === -1) return null;

  if (mode === "next") {
    return rows[index + 1]?.segment.id ?? null;
  }

  for (let offset = index + 1; offset < rows.length; offset += 1) {
    const row = rows[offset];
    if (row && isUnconfirmed(row)) return row.segment.id;
  }
  for (let offset = 0; offset < index; offset += 1) {
    const row = rows[offset];
    if (row && isUnconfirmed(row)) return row.segment.id;
  }
  return null;
}

/**
 * Read the advance mode out of a confirm keystroke.
 *
 * Alt means "do not skip", Shift means "do not move". Both are additive to the
 * Ctrl+Enter every translator already knows, so nothing has to be relearned to
 * get the default behaviour.
 */
export function confirmModeFromEvent(event?: {
  altKey?: boolean;
  shiftKey?: boolean;
}): ConfirmAdvanceMode {
  if (event?.shiftKey) return "stay";
  if (event?.altKey) return "next";
  return "next-unconfirmed";
}
