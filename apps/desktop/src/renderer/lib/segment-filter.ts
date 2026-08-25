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
    activeIndex >= 0 ? activeIndex + step : direction === "next" ? 0 : count - 1;
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
