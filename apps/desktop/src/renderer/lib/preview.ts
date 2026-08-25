import type { Segment, SegmentState } from "@translunar/contracts";

export interface PreviewPart {
  segmentId: string;
  ordinal: number;
  text: string;
  state: SegmentState;
  /** True when the target is empty and the source text is shown instead. */
  fallback: boolean;
}

export interface PreviewBlock {
  key: string;
  structuralPath: string;
  parts: PreviewPart[];
}

export interface PreviewModel {
  blocks: PreviewBlock[];
  totalSegments: number;
  translatedSegments: number;
  fallbackSegments: number;
}

/**
 * Client-side target backfill: groups consecutive segments that share a
 * structural path (one imported unit, typically a paragraph) and fills each
 * slot with the draft/confirmed target, falling back to the source text for
 * untranslated segments. Exact whitespace reassembly happens engine-side on
 * export; this preview is for proofreading flow and coverage.
 */
export function buildPreviewModel(segments: readonly Segment[]): PreviewModel {
  const ordered = [...segments].sort((a, b) => a.ordinal - b.ordinal);
  const blocks: PreviewBlock[] = [];
  let fallbackSegments = 0;
  for (const segment of ordered) {
    const fallback = segment.targetText.trim().length === 0;
    if (fallback) {
      fallbackSegments += 1;
    }
    const part: PreviewPart = {
      segmentId: segment.id,
      ordinal: segment.ordinal,
      text: fallback ? segment.sourceText : segment.targetText,
      state: segment.state,
      fallback,
    };
    const last = blocks[blocks.length - 1];
    if (last && last.structuralPath === segment.structuralPath) {
      last.parts.push(part);
    } else {
      blocks.push({
        key: `${segment.structuralPath}#${segment.ordinal}`,
        structuralPath: segment.structuralPath,
        parts: [part],
      });
    }
  }
  return {
    blocks,
    totalSegments: ordered.length,
    translatedSegments: ordered.length - fallbackSegments,
    fallbackSegments,
  };
}
