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
    if (query.length > 0) {
      const haystack =
        `${segment.sourceText}\n${segment.targetText}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
}
