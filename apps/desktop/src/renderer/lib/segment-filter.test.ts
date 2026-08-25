import { describe, expect, it } from "vitest";

import type { Segment, SegmentState } from "@translunar/contracts";

import { EMPTY_FILTER, filterSegments, isFilterActive } from "./segment-filter.js";

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
