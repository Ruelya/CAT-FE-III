import { describe, expect, it } from "vitest";

import type { Segment, SegmentState } from "@translunar/contracts";

import {
  EMPTY_FILTER,
  filterSegments,
  findSegmentMatch,
  isFilterActive,
} from "./segment-filter.js";

function segment(
  id: string,
  ordinal: number,
  source: string,
  target = "",
  state: SegmentState = target ? "draft" : "untranslated",
): Segment {
  return {
    id,
    documentId: "d1",
    ordinal,
    structuralPath: `p:${ordinal}`,
    sourceText: source,
    targetText: target,
    state,
    revision: 1,
    sourceHash: "hash",
    contextHash: "context",
    updatedAtMs: 1,
  };
}

const SEGMENTS = [
  segment("s1", 0, "Hello world.", "你好，世界。", "confirmed"),
  segment("s2", 1, "Retention period is 30 days.", "保留期 60 天。", "draft"),
  segment("s3", 2, "Untranslated tail."),
];

describe("filterSegments", () => {
  it("passes everything through with the empty filter", () => {
    expect(filterSegments(SEGMENTS, EMPTY_FILTER, new Set())).toHaveLength(3);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it("filters by segment state", () => {
    const result = filterSegments(
      SEGMENTS,
      { state: "untranslated", query: "" },
      new Set(),
    );
    expect(result.map((s) => s.id)).toEqual(["s3"]);
  });

  it("keeps only open-QA segments for the qa pseudo-state", () => {
    const result = filterSegments(
      SEGMENTS,
      { state: "qa", query: "" },
      new Set(["s2"]),
    );
    expect(result.map((s) => s.id)).toEqual(["s2"]);
  });

  it("matches query case-insensitively across source and target", () => {
    expect(
      filterSegments(SEGMENTS, { state: "all", query: "RETENTION" }, new Set()),
    ).toHaveLength(1);
    expect(
      filterSegments(SEGMENTS, { state: "all", query: "世界" }, new Set()),
    ).toHaveLength(1);
    expect(
      filterSegments(SEGMENTS, { state: "all", query: "missing" }, new Set()),
    ).toHaveLength(0);
  });

  it("combines state and query", () => {
    const result = filterSegments(
      SEGMENTS,
      { state: "draft", query: "30" },
      new Set(),
    );
    expect(result.map((s) => s.id)).toEqual(["s2"]);
    expect(
      filterSegments(SEGMENTS, { state: "confirmed", query: "30" }, new Set()),
    ).toHaveLength(0);
  });
});

describe("findSegmentMatch", () => {
  // s1 and s3 both carry "day"; s2 does not.
  const FIND_SEGMENTS = [
    segment("s1", 0, "First day of work.", "第一天。", "confirmed"),
    segment("s2", 1, "Nothing to see here.", "无关内容。", "draft"),
    segment("s3", 2, "Every DAY counts."),
  ];

  it("finds the next match after the active segment, case-insensitively", () => {
    const result = findSegmentMatch(FIND_SEGMENTS, "day", "s1", "next");
    expect(result).not.toBeNull();
    expect(result?.segment.id).toBe("s3");
    expect(result?.wrapped).toBe(false);
  });

  it("matches against target text as well as source", () => {
    const result = findSegmentMatch(FIND_SEGMENTS, "第一天", "s2", "next");
    expect(result?.segment.id).toBe("s1");
    expect(result?.wrapped).toBe(true);
  });

  it("wraps past the end and flags the wrap", () => {
    const result = findSegmentMatch(FIND_SEGMENTS, "day", "s3", "next");
    expect(result?.segment.id).toBe("s1");
    expect(result?.wrapped).toBe(true);
  });

  it("finds backwards and wraps past the start", () => {
    expect(findSegmentMatch(FIND_SEGMENTS, "day", "s3", "prev")).toMatchObject(
      { segment: { id: "s1" }, wrapped: false },
    );
    expect(findSegmentMatch(FIND_SEGMENTS, "day", "s1", "prev")).toMatchObject(
      { segment: { id: "s3" }, wrapped: true },
    );
  });

  it("starts from the edges when no segment is active", () => {
    expect(findSegmentMatch(FIND_SEGMENTS, "day", null, "next")).toMatchObject(
      { segment: { id: "s1" }, wrapped: false },
    );
    expect(findSegmentMatch(FIND_SEGMENTS, "day", null, "prev")).toMatchObject(
      { segment: { id: "s3" }, wrapped: false },
    );
  });

  it("returns the active segment itself (as a wrap) when it is the only match", () => {
    const result = findSegmentMatch(FIND_SEGMENTS, "nothing", "s2", "next");
    expect(result?.segment.id).toBe("s2");
    expect(result?.wrapped).toBe(true);
  });

  it("returns null on no match, blank query, or empty list", () => {
    expect(findSegmentMatch(FIND_SEGMENTS, "missing", "s1", "next")).toBeNull();
    expect(findSegmentMatch(FIND_SEGMENTS, "   ", "s1", "next")).toBeNull();
    expect(findSegmentMatch([], "day", null, "next")).toBeNull();
  });
});
