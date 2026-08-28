import type { Segment, SegmentState } from "@translunar/contracts";

import { lexPlaceholderTokens } from "./tokens.js";

export type SegmentStateFilter = "all" | SegmentState | "qa";

export interface SegmentFilterSpec {
  state: SegmentStateFilter;
  /** Case-insensitive substring matched against source and target text. */
  query: string;
  /** Keeps only segments with `Segment.locked === true`. */
  locked: boolean;
  /**
   * Keeps only segments whose source text has terminology hits. The hits
   * come from the engine's `term.lookup` (callers pass the matching ids in
   * `termSegmentIds`); this channel never re-matches terms client-side.
   */
  hasTerms: boolean;
  /**
   * Keeps only segments whose source or target contains a placeholder
   * token run — the same lexer (`lexPlaceholderTokens`) that TokenText
   * renders and the engine's QA placeholder rules count.
   */
  hasTags: boolean;
}

export const EMPTY_FILTER: SegmentFilterSpec = {
  state: "all",
  query: "",
  locked: false,
  hasTerms: false,
  hasTags: false,
};

export function isFilterActive(filter: SegmentFilterSpec): boolean {
  return (
    filter.state !== "all" ||
    filter.query.trim().length > 0 ||
    filter.locked ||
    filter.hasTerms ||
    filter.hasTags
  );
}

/** Case-insensitive substring match against source and target text. */
function matchesQuery(segment: Segment, lowerQuery: string): boolean {
  return `${segment.sourceText}\n${segment.targetText}`
    .toLowerCase()
    .includes(lowerQuery);
}

/** True when source or target carries at least one placeholder token. */
function hasPlaceholderTokens(segment: Segment): boolean {
  return (
    lexPlaceholderTokens(segment.sourceText).some((run) => run.token) ||
    lexPlaceholderTokens(segment.targetText).some((run) => run.token)
  );
}

/**
 * Applies the grid filter. All channels AND together. `qa` keeps only
 * segments carried in `qaSegmentIds` (open issues); other states match
 * `segment.state`. `hasTerms` keeps only segments in `termSegmentIds`
 * (engine `term.lookup` hits, resolved by the caller); while that set is
 * still null (lookups in flight, nothing converged yet) the channel hides
 * every row — the grid never flashes the unfiltered document while the
 * engine is still answering, and never narrows on a client-side guess.
 */
export function filterSegments(
  segments: readonly Segment[],
  filter: SegmentFilterSpec,
  qaSegmentIds: ReadonlySet<string>,
  termSegmentIds: ReadonlySet<string> | null = null,
): Segment[] {
  const query = filter.query.trim().toLowerCase();
  return segments.filter((segment) => {
    if (filter.state === "qa") {
      if (!qaSegmentIds.has(segment.id)) {
        return false;
      }
    } else if (filter.state !== "all" && segment.state !== filter.state) {
      return false;
    }
    if (filter.locked && segment.locked !== true) {
      return false;
    }
    if (
      filter.hasTerms &&
      (termSegmentIds === null || !termSegmentIds.has(segment.id))
    ) {
      return false;
    }
    if (filter.hasTags && !hasPlaceholderTokens(segment)) {
      return false;
    }
    if (query.length > 0 && !matchesQuery(segment, query)) {
      return false;
    }
    return true;
  });
}

export interface SegmentReplaceOutcome {
  /** The text with every occurrence replaced. */
  text: string;
  /** How many non-overlapping occurrences were replaced. */
  count: number;
}

/**
 * Case-insensitive, non-overlapping search-and-replace inside one target
 * text — the client-side mirror of the engine's `segment.replace` folding
 * (used by 替换 on the active segment, where the client already holds the
 * revision). Walks code points so surrogate pairs stay intact; a character
 * whose lowercase form straddles the query boundary is a non-match rather
 * than a half replacement. Returns null when the query is blank or nothing
 * matches.
 */
export function replaceSegmentText(
  text: string,
  query: string,
  replacement: string,
): SegmentReplaceOutcome | null {
  const needle = query.toLowerCase();
  if (needle.length === 0) {
    return null;
  }
  let result = "";
  let count = 0;
  let index = 0;
  while (index < text.length) {
    // Fold candidate code points until the folded window covers the needle.
    let folded = "";
    let end = index;
    while (folded.length < needle.length && end < text.length) {
      const character = String.fromCodePoint(text.codePointAt(end) ?? 0);
      folded += character.toLowerCase();
      end += character.length;
    }
    if (folded === needle) {
      result += replacement;
      count += 1;
      index = end;
      continue;
    }
    const character = String.fromCodePoint(text.codePointAt(index) ?? 0);
    result += character;
    index += character.length;
  }
  return count === 0 ? null : { text: result, count };
}

export interface SegmentFindResult {
  segment: Segment;
  /** True when the search passed the end (or start) and continued. */
  wrapped: boolean;
}

/**
 * Find next/previous navigation (F4 / Shift+F4): locates the next segment
 * whose source or target contains `query` (case-insensitive), starting
 * after (or before) the active segment and wrapping around. Unlike
 * `filterSegments` it never hides rows — callers jump the selection and
 * report wrapping honestly. Returns null when the query is blank or
 * nothing in `segments` matches.
 */
export function findSegmentMatch(
  segments: readonly Segment[],
  query: string,
  activeSegmentId: string | null,
  direction: "next" | "prev",
): SegmentFindResult | null {
  const needle = query.trim().toLowerCase();
  const count = segments.length;
  if (needle.length === 0 || count === 0) {
    return null;
  }
  const step = direction === "next" ? 1 : -1;
  const activeIndex = segments.findIndex(
    (segment) => segment.id === activeSegmentId,
  );
  // Start just past the active row; with no active row, scan from the
  // first (next) or last (prev) row.
  const start =
    activeIndex >= 0
      ? activeIndex + step
      : direction === "next"
        ? 0
        : count - 1;
  for (let offset = 0; offset < count; offset += 1) {
    const raw = start + step * offset;
    const index = ((raw % count) + count) % count;
    const segment = segments[index]!;
    if (matchesQuery(segment, needle)) {
      return { segment, wrapped: raw !== index };
    }
  }
  return null;
}

/**
 * 下一* navigation (下一未译/草稿/QA/锁定): the first segment matching
 * `predicate`, starting after the active segment and wrapping around to
 * cover the whole document (the active row itself is the last candidate).
 * With no active segment the scan starts at the first row. Like
 * `findSegmentMatch` it never hides rows — callers jump the selection.
 * Returns null when nothing matches.
 */
export function findNextSegmentWhere(
  segments: readonly Segment[],
  activeSegmentId: string | null,
  predicate: (segment: Segment) => boolean,
): Segment | null {
  const count = segments.length;
  if (count === 0) {
    return null;
  }
  const activeIndex = segments.findIndex(
    (segment) => segment.id === activeSegmentId,
  );
  const start = activeIndex >= 0 ? activeIndex + 1 : 0;
  for (let offset = 0; offset < count; offset += 1) {
    const segment = segments[(start + offset) % count]!;
    if (predicate(segment)) {
      return segment;
    }
  }
  return null;
}
