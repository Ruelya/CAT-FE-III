import type { SegmentEditorRow } from "@translunar/contracts";

import { structureLabel } from "./structure-label";

export interface PreviewBlock {
  segmentId: string;
  label: string;
  path: string;
  text: string;
  empty: boolean;
}

/**
 * Build a document-order preview from the rows already on the grid.
 *
 * This is not Word WYSIWYG. It is the structure a translator can scan: each
 * segment as a block, labelled with the same context the grid uses, showing
 * the target if there is one and the source otherwise. Clicking a block is
 * how preview jumps back to the grid.
 */
export function previewBlocks(
  rows: readonly SegmentEditorRow[],
): PreviewBlock[] {
  return rows.map((row) => {
    const target = row.segment.targetText.trim();
    return {
      segmentId: row.segment.id,
      label: structureLabel(row.segment.structuralPath) || "¶",
      path: row.segment.structuralPath,
      text: target || row.segment.sourceText,
      empty: target.length === 0,
    };
  });
}
