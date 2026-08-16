import type { SegmentEditorRow } from "@translunar/contracts";

import { renderPreviewHtml } from "./preview-render";
import { structureLabel } from "./structure-label";

export type PreviewRole =
  | "heading"
  | "paragraph"
  | "cell"
  | "slide"
  | "note"
  | "block";

export interface PreviewBlock {
  segmentId: string;
  label: string;
  path: string;
  text: string;
  html: string;
  empty: boolean;
  role: PreviewRole;
}

export function previewRole(
  path: string,
  filterId = "",
  ordinal = 0,
): PreviewRole {
  const label = structureLabel(path);
  if (label === "H") return "heading";
  if (label === "Cell") return "cell";
  if (label === "Sld") return "slide";
  if (label === "Fn" || label === "En" || label === "Cmt") return "note";
  const lower = path.toLowerCase();
  const filter = filterId.toLowerCase();
  if (filter.includes("html") && ordinal === 0 && !lower.includes(":attr:")) {
    return "heading";
  }
  if (
    (filter.includes("md") ||
      filter.includes("markdown") ||
      lower.startsWith("md:") ||
      lower.startsWith("markdown:")) &&
    ordinal === 0
  ) {
    return "heading";
  }
  return "paragraph";
}

/**
 * Build a document-order preview from the rows already on the grid.
 *
 * Formatting comes from the segment's tags (target if translated, else source)
 * and is rendered through marked / DOMPurify. This is not a Word COM preview.
 */
export function previewBlocks(
  rows: readonly SegmentEditorRow[],
  filterId = "",
  format = "",
): PreviewBlock[] {
  return rows.map((row) => {
    const target = row.segment.targetText.trim();
    const text = target || row.segment.sourceText;
    const tags = target.length > 0 ? row.targetTags : row.sourceTags;
    return {
      segmentId: row.segment.id,
      label: structureLabel(row.segment.structuralPath) || "¶",
      path: row.segment.structuralPath,
      text,
      html: renderPreviewHtml(text, tags, filterId, format),
      empty: target.length === 0,
      role: previewRole(
        row.segment.structuralPath,
        filterId,
        row.segment.ordinal,
      ),
    };
  });
}
