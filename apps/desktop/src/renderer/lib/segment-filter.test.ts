import { describe, expect, it } from "vitest";

import type { Segment, SegmentState } from "@translunar/contracts";

import {
  EMPTY_FILTER,
  filterSegments,
  findNextSegmentWhere,
  findSegmentMatch,
  isFilterActive,
  replaceSegmentText,
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
      { ...EMPTY_FILTER, state: "untranslated" },
      new Set(),
    );
    expect(result.map((s) => s.id)).toEqual(["s3"]);
  });

  it("keeps only open-QA segments for the qa pseudo-state", () => {
    const result = filterSegments(
      SEGMENTS,
      { ...EMPTY_FILTER, state: "qa" },
      new Set(["s2"]),
    );
    expect(result.map((s) => s.id)).toEqual(["s2"]);
  });

  it("matches query case-insensitively across source and target", () => {
    expect(
      filterSegments(
        SEGMENTS,
        { ...EMPTY_FILTER, query: "RETENTION" },
        new Set(),
      ),
    ).toHaveLength(1);
    expect(
      filterSegments(SEGMENTS, { ...EMPTY_FILTER, query: "世界" }, new Set()),
    ).toHaveLength(1);
    expect(
      filterSegments(
        SEGMENTS,
        { ...EMPTY_FILTER, query: "missing" },
        new Set(),
      ),
    ).toHaveLength(0);
  });

  it("combines state and query", () => {
    const result = filterSegments(
      SEGMENTS,
      { ...EMPTY_FILTER, state: "draft", query: "30" },
      new Set(),
    );
    expect(result.map((s) => s.id)).toEqual(["s2"]);
    expect(
      filterSegments(
        SEGMENTS,
        { ...EMPTY_FILTER, state: "confirmed", query: "30" },
        new Set(),
      ),
    ).toHaveLength(0);
  });

  it("keeps only locked segments on the 锁定 channel", () => {
    const locked = { ...segment("s4", 3, "Locked row.", "锁定行。"), locked: true };
    const rows = [...SEGMENTS, locked];
    const result = filterSegments(
      rows,
      { ...EMPTY_FILTER, locked: true },
      new Set(),
    );
    expect(result.map((s) => s.id)).toEqual(["s4"]);
    expect(isFilterActive({ ...EMPTY_FILTER, locked: true })).toBe(true);
  });

  it("keeps only token-carrying segments on the 有标签 channel", () => {
    const tagged = [
      segment("t1", 0, "Choose {mode} to continue.", "选择 {mode}。", "draft"),
      segment("t2", 1, "Plain text.", "纯文本。", "draft"),
      segment("t3", 2, "Plain source.", "译文有 %s 标签。", "draft"),
    ];
    const result = filterSegments(
      tagged,
      { ...EMPTY_FILTER, hasTags: true },
      new Set(),
    );
    // Both sides count: a token only in the target is still a tag row.
    expect(result.map((s) => s.id)).toEqual(["t1", "t3"]);
    expect(isFilterActive({ ...EMPTY_FILTER, hasTags: true })).toBe(true);
  });

  it("keeps only engine-confirmed term hits on the 有术语 channel", () => {
    const result = filterSegments(
      SEGMENTS,
      { ...EMPTY_FILTER, hasTerms: true },
      new Set(),
      new Set(["s2"]),
    );
    expect(result.map((s) => s.id)).toEqual(["s2"]);
    expect(isFilterActive({ ...EMPTY_FILTER, hasTerms: true })).toBe(true);
  });

  it("hides every row on 有术语 while the lookup set is still null", () => {
    // Lookups in flight with nothing converged yet: the channel shows no
    // rows rather than flashing the unfiltered document; rows appear once
    // the engine has answered.
    const result = filterSegments(
      SEGMENTS,
      { ...EMPTY_FILTER, hasTerms: true },
      new Set(),
      null,
    );
    expect(result).toHaveLength(0);
  });

  it("ANDs the new channels with state and query", () => {
    const locked = {
      ...segment("s5", 4, "Locked {tag} row.", "锁定 {tag} 行。"),
      locked: true,
    };
    const rows = [...SEGMENTS, locked];
    expect(
      filterSegments(
        rows,
        { ...EMPTY_FILTER, locked: true, hasTags: true },
        new Set(),
      ).map((s) => s.id),
    ).toEqual(["s5"]);
    expect(
      filterSegments(
        rows,
        { ...EMPTY_FILTER, locked: true, hasTags: true, query: "missing" },
        new Set(),
      ),
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
    expect(findSegmentMatch(FIND_SEGMENTS, "day", "s3", "prev")).toMatchObject({
      segment: { id: "s1" },
      wrapped: false,
    });
    expect(findSegmentMatch(FIND_SEGMENTS, "day", "s1", "prev")).toMatchObject({
      segment: { id: "s3" },
      wrapped: true,
    });
  });

  it("starts from the edges when no segment is active", () => {
    expect(findSegmentMatch(FIND_SEGMENTS, "day", null, "next")).toMatchObject({
      segment: { id: "s1" },
      wrapped: false,
    });
    expect(findSegmentMatch(FIND_SEGMENTS, "day", null, "prev")).toMatchObject({
      segment: { id: "s3" },
      wrapped: false,
    });
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

describe("findNextSegmentWhere", () => {
  const NAV_SEGMENTS = [
    segment("s1", 0, "First.", "第一。", "confirmed"),
    segment("s2", 1, "Second."),
    segment("s3", 2, "Third.", "第三。", "draft"),
    segment("s4", 3, "Fourth."),
  ];

  it("finds the first match after the active segment", () => {
    const hit = findNextSegmentWhere(
      NAV_SEGMENTS,
      "s2",
      (item) => item.state === "untranslated",
    );
    expect(hit?.id).toBe("s4");
  });

  it("wraps past the end to cover the whole document", () => {
    const hit = findNextSegmentWhere(
      NAV_SEGMENTS,
      "s4",
      (item) => item.state === "confirmed",
    );
    expect(hit?.id).toBe("s1");
  });

  it("starts from the first row when nothing is active", () => {
    const hit = findNextSegmentWhere(
      NAV_SEGMENTS,
      null,
      (item) => item.state === "untranslated",
    );
    expect(hit?.id).toBe("s2");
  });

  it("offers the active row itself as the last candidate", () => {
    const hit = findNextSegmentWhere(
      NAV_SEGMENTS,
      "s3",
      (item) => item.state === "draft",
    );
    expect(hit?.id).toBe("s3");
  });

  it("returns null when no segment matches or the list is empty", () => {
    expect(
      findNextSegmentWhere(NAV_SEGMENTS, "s1", (item) => item.locked === true),
    ).toBeNull();
    expect(findNextSegmentWhere([], null, () => true)).toBeNull();
  });
});

describe("replaceSegmentText", () => {
  it("replaces every occurrence case-insensitively and counts them", () => {
    expect(
      replaceSegmentText("Server error: SERVER down", "server", "服务器"),
    ).toEqual({ text: "服务器 error: 服务器 down", count: 2 });
    expect(replaceSegmentText("保留期为 30 天。", "30 天", "60 天")).toEqual({
      text: "保留期为 60 天。",
      count: 1,
    });
  });

  it("returns null when nothing matches or the query is empty", () => {
    expect(replaceSegmentText("nothing here", "miss", "x")).toBeNull();
    expect(replaceSegmentText("text", "", "x")).toBeNull();
  });

  it("never rematches inside a replacement and allows deletion", () => {
    // The replacement contains the query; occurrences must not cascade.
    expect(replaceSegmentText("aba", "a", "aa")).toEqual({
      text: "aabaa",
      count: 2,
    });
    expect(replaceSegmentText("well, well", "well", "")).toEqual({
      text: ", ",
      count: 2,
    });
  });

  it("matches the engine's per-character folding for non-ASCII case pairs", () => {
    expect(replaceSegmentText("СЕРВЕР готов", "сервер", "server")).toEqual({
      text: "server готов",
      count: 1,
    });
  });

  it("keeps surrogate pairs intact around replacements", () => {
    expect(replaceSegmentText("🎉 Party 🎉", "party", "聚会")).toEqual({
      text: "🎉 聚会 🎉",
      count: 1,
    });
  });
});
