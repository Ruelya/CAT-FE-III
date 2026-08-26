import type { Segment, SegmentState } from "@translunar/contracts";

export type SegmentStateFilter = "all" | SegmentState | "qa";

export interface SegmentFilterSpec {
  state: SegmentStateFilter;
  /** Case-insensitive substring matched against source and target text. */
  query: string;
}

export const EMPTY_FILTER: SegmentFilterSpec = { state: "all", query: "" };

export function isFilterActive(filter: SegmentFilterSpec): boolean {
  return filter.state !== "all" || filter.query.trim().length > 0;
}

/** Case-insensitive substring match against source and target text. */
function matchesQuery(segment: Segment, lowerQuery: string): boolean {
  return `${segment.sourceText}\n${segment.targetText}`
    .toLowerCase()
    .includes(lowerQuery);
}

/**
 * Applies the grid filter. `qa` keeps only segments carried in
 * `qaSegmentIds` (open issues); other states match `segment.state`.
 */
export function filterSegments(
  segments: readonly Segment[],
  filter: SegmentFilterSpec,
  qaSegmentIds: ReadonlySet<string>,
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
