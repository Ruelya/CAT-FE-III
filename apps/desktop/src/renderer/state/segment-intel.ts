import type { ConcordanceHit, TermMatch, TmMatch } from "@translunar/contracts";

import type { UiError } from "../lib/errors";

/**
 * Everything the intelligence docks know about the segment under the caret.
 *
 * One record per dock, all keyed on the same segment, because the defining
 * property of a translation workbench is that every panel is answering a
 * question about the row you are standing on. Panels that answer questions
 * about "the project" belong in an asset manager, not here.
 */
export interface SegmentIntel {
  /** The segment these results describe. Stale results are never rendered. */
  segmentId: string | null;
  tm: {
    matches: TmMatch[];
    loading: boolean;
    error: UiError | null;
  };
  terms: {
    matches: TermMatch[];
    loading: boolean;
    error: UiError | null;
  };
  /**
   * Concordance is the one dock a translator drives rather than receives: it
   * answers "how did we translate this phrase before", for a phrase they
   * chose. The query is kept so the panel can show what it answered.
   */
  concordance: {
    query: string;
    hits: ConcordanceHit[];
    loading: boolean;
    error: UiError | null;
  };
}

export const EMPTY_SEGMENT_INTEL: SegmentIntel = {
  segmentId: null,
  tm: { matches: [], loading: false, error: null },
  terms: { matches: [], loading: false, error: null },
  concordance: { query: "", hits: [], loading: false, error: null },
};

/** Percent shown next to a match, floored so 99.6 never reads as a 100. */
export function matchPercent(match: TmMatch): number {
  return Math.floor(match.score);
}

/**
 * How a match should be labelled in the results list.
 *
 * Context and exact are different things and translators treat them
 * differently: a context match agreed with the surrounding segments too, which
 * is why it can be trusted without rereading the neighbours.
 */
export function matchLabel(match: TmMatch): string {
  if (match.kind === "context") return "CM";
  if (match.kind === "exact") return "100%";
  return `${matchPercent(match)}%`;
}

/** Matches are ranked the way a translator scans them: best and cheapest first. */
export function rankMatches(matches: readonly TmMatch[]): TmMatch[] {
  const rank = (match: TmMatch) =>
    match.kind === "context" ? 2 : match.kind === "exact" ? 1 : 0;
  return [...matches].sort((left, right) => {
    const byKind = rank(right) - rank(left);
    if (byKind !== 0) return byKind;
    const byScore = right.score - left.score;
    if (byScore !== 0) return byScore;
    // Mount priority is the project's own statement about which library wins.
    return left.mountPriority - right.mountPriority;
  });
}

/**
 * Character ranges of recognised terms, merged and ordered.
 *
 * Overlapping hits are common when a termbase holds both a phrase and one of
 * its words. Underlining the same characters twice looks like a rendering bug,
 * so the longer hit wins and the shorter one is dropped from the highlight
 * (it stays in the list, where it is still useful).
 */
export function termHighlightRanges(
  matches: readonly TermMatch[],
): Array<{ start: number; end: number }> {
  const ordered = [...matches]
    .filter((match) => match.end > match.start)
    .sort((left, right) =>
      left.start === right.start
        ? right.end - right.start - (left.end - left.start)
        : left.start - right.start,
    );
  const merged: Array<{ start: number; end: number }> = [];
  for (const match of ordered) {
    const last = merged[merged.length - 1];
    if (last && match.start < last.end) {
      last.end = Math.max(last.end, match.end);
      continue;
    }
    merged.push({ start: match.start, end: match.end });
  }
  return merged;
}

/** Split text into plain and highlighted runs for rendering term hits. */
export function splitByRanges(
  text: string,
  ranges: ReadonlyArray<{ start: number; end: number }>,
): Array<{ text: string; highlighted: boolean }> {
  if (ranges.length === 0) return [{ text, highlighted: false }];
  const characters = [...text];
  const pieces: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const range of ranges) {
    const start = Math.max(0, Math.min(range.start, characters.length));
    const end = Math.max(start, Math.min(range.end, characters.length));
    if (start > cursor) {
      pieces.push({
        text: characters.slice(cursor, start).join(""),
        highlighted: false,
      });
    }
    if (end > start) {
      pieces.push({
        text: characters.slice(start, end).join(""),
        highlighted: true,
      });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < characters.length) {
    pieces.push({
      text: characters.slice(cursor).join(""),
      highlighted: false,
    });
  }
  return pieces.filter((piece) => piece.text.length > 0);
}
