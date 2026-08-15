/**
 * What the translator currently has selected in the segment they are editing.
 *
 * Concordance, Quick Add Term and QuickPlace all act on a selection rather
 * than on a whole segment, and all three need the same two questions answered:
 * what is highlighted in the source, and what is highlighted in the target.
 * Asking the DOM once, here, keeps that from being reimplemented three times
 * with three different definitions of "selected".
 */
export interface SegmentSelection {
  source: string;
  target: string;
  targetStart: number;
  targetEnd: number;
}

export const EMPTY_SELECTION: SegmentSelection = {
  source: "",
  target: "",
  targetStart: 0,
  targetEnd: 0,
};

/** The target editor element for a segment, if it is the one being edited. */
export function targetEditorFor(
  segmentId: string,
  root: Document | null = typeof document === "undefined" ? null : document,
): HTMLTextAreaElement | null {
  if (!root) return null;
  return root.querySelector<HTMLTextAreaElement>(
    `[data-testid="target-editor-${segmentId}"]`,
  );
}

/**
 * Read the live selection for a segment.
 *
 * The source is plain rendered text, so its selection comes from the window;
 * the target is a form control, which keeps its own. A window selection that
 * has strayed outside the active row is ignored: highlighting a word in a
 * different segment must not silently become the term you store.
 */
export function readSegmentSelection(
  segmentId: string,
  view: (Window & typeof globalThis) | null = typeof window === "undefined"
    ? null
    : window,
): SegmentSelection {
  if (!view) return EMPTY_SELECTION;
  const editor = targetEditorFor(segmentId, view.document);
  const target = editor
    ? editor.value.slice(editor.selectionStart ?? 0, editor.selectionEnd ?? 0)
    : "";

  let source = "";
  const selection = view.getSelection?.();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const row = view.document.querySelector<HTMLElement>(
      `[data-testid="segment-row-${segmentId}"] .segment-source`,
    );
    const anchor = selection.anchorNode;
    if (row && anchor && row.contains(anchor)) {
      source = selection.toString();
    }
  }

  return {
    source: source.trim(),
    target: target.trim(),
    targetStart: editor?.selectionStart ?? 0,
    targetEnd: editor?.selectionEnd ?? 0,
  };
}

/**
 * The phrase a concordance search should run on.
 *
 * Preference order matches what the translator is looking at: a source
 * selection is an explicit question, a target selection is the same question
 * asked from the other side, and with neither the whole source sentence is a
 * reasonable default for a short segment. Long sentences are not defaulted -
 * concordance on a whole paragraph returns nothing useful and costs a
 * round trip.
 */
export function concordanceQueryFor(
  selection: SegmentSelection,
  sourceText: string,
  maxDefaultChars = 60,
): string {
  if (selection.source) return selection.source;
  if (selection.target) return selection.target;
  const trimmed = sourceText.trim();
  return trimmed.length > 0 && trimmed.length <= maxDefaultChars ? trimmed : "";
}

/** A term can only be stored when both sides of it are known. */
export function canStoreTerm(selection: SegmentSelection): boolean {
  return selection.source.length > 0 && selection.target.length > 0;
}
