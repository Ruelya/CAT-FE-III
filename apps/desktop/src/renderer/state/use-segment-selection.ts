import { useEffect, useState } from "react";

import {
  EMPTY_SELECTION,
  readSegmentSelection,
  type SegmentSelection,
} from "./editor-selection";

/**
 * Track what is highlighted inside the active segment.
 *
 * Controls that act on a selection have to know whether there is one before
 * the user clicks them, otherwise the only way to discover that Add Term needs
 * a selection is to press it and have nothing happen. The browser fires
 * `selectionchange` for the source text and for the target textarea's caret
 * alike, so one listener covers both sides.
 */
export function useSegmentSelection(
  segmentId: string | null,
): SegmentSelection {
  const [selection, setSelection] = useState<SegmentSelection>(EMPTY_SELECTION);

  useEffect(() => {
    if (!segmentId) {
      setSelection(EMPTY_SELECTION);
      return;
    }
    // Each side is remembered until the translator leaves the segment.
    //
    // The source is rendered text and the target is a form control, so
    // highlighting a phrase in the target clears the highlight in the source:
    // the two sides can never be lit at the same instant. Requiring that would
    // make "select the term and its translation, then store it" impossible,
    // which is the one gesture this is for. Holding the last non-empty
    // selection per side matches how the gesture is actually performed, and
    // moving to another segment starts over so a stale phrase cannot be
    // filed against a sentence it never came from.
    const read = () => {
      const live = readSegmentSelection(segmentId);
      setSelection((previous) => ({
        source: live.source || previous.source,
        target: live.target || previous.target,
        targetStart: live.targetStart,
        targetEnd: live.targetEnd,
      }));
    };
    setSelection(EMPTY_SELECTION);
    read();
    document.addEventListener("selectionchange", read);
    // Typing moves the caret without changing the selection in some browsers,
    // and a collapsed caret is a valid answer here (it means "nothing to add").
    document.addEventListener("keyup", read);
    document.addEventListener("mouseup", read);
    return () => {
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("keyup", read);
      document.removeEventListener("mouseup", read);
    };
  }, [segmentId]);

  return selection;
}
