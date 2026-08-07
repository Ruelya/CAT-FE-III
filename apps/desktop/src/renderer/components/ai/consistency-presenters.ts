/**
 * Client-side G-04 consistency scan over already-loaded segments.
 * No Engine impact-scan RPC — presentation only.
 */

export interface SegmentLike {
  id: string;
  ordinal: number;
  revision: number;
  sourceText: string;
  targetText: string;
}

export interface DivergentTargetHit {
  segmentId: string;
  ordinal: number;
  revision: number;
  before: string;
  after: string;
}

export interface ScanDivergentOptions {
  /** Max rows returned (default 200). */
  cap?: number;
  /** Segment to exclude (usually the one just updated). */
  excludeSegmentId?: string | null;
}

/** Normalize term / target for equality (trim + collapse internal space). */
export function normalizeTermText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/**
 * Find loaded segments whose source contains the term and whose target
 * differs from the proposed new target.
 */
export function scanDivergentTargets(
  segments: readonly SegmentLike[],
  sourceTerm: string,
  newTarget: string,
  options?: ScanDivergentOptions,
): { hits: DivergentTargetHit[]; capped: boolean; totalLoaded: number } {
  const cap = options?.cap ?? 200;
  const term = normalizeTermText(sourceTerm);
  const after = normalizeTermText(newTarget);
  const exclude = options?.excludeSegmentId ?? null;

  if (!term || !after) {
    return { hits: [], capped: false, totalLoaded: segments.length };
  }

  const hits: DivergentTargetHit[] = [];
  let truncated = false;

  for (const segment of segments) {
    if (exclude && segment.id === exclude) continue;
    const source = segment.sourceText ?? "";
    if (!sourceIncludesTerm(source, term)) continue;
    const before = segment.targetText ?? "";
    if (normalizeTermText(before) === after) continue;
    if (hits.length >= cap) {
      truncated = true;
      break;
    }
    hits.push({
      segmentId: segment.id,
      ordinal: segment.ordinal,
      revision: segment.revision,
      before,
      after,
    });
  }

  return {
    hits,
    capped: truncated,
    totalLoaded: segments.length,
  };
}

/**
 * Case-sensitive substring match on normalized whitespace boundaries is too
 * aggressive for CJK; use simple includes after normalize of both sides' spaces.
 */
export function sourceIncludesTerm(sourceText: string, term: string): boolean {
  if (!term) return false;
  return sourceText.includes(term);
}
