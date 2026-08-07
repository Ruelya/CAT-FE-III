import { describe, expect, it } from "vitest";

import {
  normalizeTermText,
  scanDivergentTargets,
  sourceIncludesTerm,
  type SegmentLike,
} from "./consistency-presenters";

function seg(
  id: string,
  ordinal: number,
  sourceText: string,
  targetText: string,
  revision = 1,
): SegmentLike {
  return { id, ordinal, revision, sourceText, targetText };
}

describe("consistency-presenters", () => {
  it("normalizes whitespace for equality", () => {
    expect(normalizeTermText("  foo   bar ")).toBe("foo bar");
  });

  it("scans divergent targets and excludes active segment", () => {
    const segments = [
      seg("a", 0, "Hello world", "你好世界"),
      seg("b", 1, "Hello world", "哈罗"),
      seg("c", 2, "Other", "其他"),
      seg("d", 3, "Hello world", "你好世界"),
    ];
    const { hits, capped } = scanDivergentTargets(
      segments,
      "Hello world",
      "你好世界",
      { excludeSegmentId: "a" },
    );
    expect(capped).toBe(false);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      segmentId: "b",
      before: "哈罗",
      after: "你好世界",
    });
  });

  it("caps list and reports truncated", () => {
    const segments = Array.from({ length: 5 }, (_, i) =>
      seg(`s${i}`, i, "term", `t${i}`),
    );
    const { hits, capped } = scanDivergentTargets(segments, "term", "unified", {
      cap: 2,
    });
    expect(hits).toHaveLength(2);
    expect(capped).toBe(true);
  });

  it("returns empty when term or target blank", () => {
    expect(
      scanDivergentTargets([seg("a", 0, "x", "y")], "", "z").hits,
    ).toHaveLength(0);
    expect(
      scanDivergentTargets([seg("a", 0, "x", "y")], "x", "  ").hits,
    ).toHaveLength(0);
  });

  it("sourceIncludesTerm is substring based", () => {
    expect(sourceIncludesTerm("ab term cd", "term")).toBe(true);
    expect(sourceIncludesTerm("ab", "term")).toBe(false);
  });
});
