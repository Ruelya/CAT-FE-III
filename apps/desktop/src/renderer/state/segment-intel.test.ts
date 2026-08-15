import { describe, expect, it } from "vitest";
import type { TermMatch, TmMatch } from "@translunar/contracts";

import {
  matchLabel,
  rankMatches,
  splitByRanges,
  termHighlightRanges,
} from "./segment-intel";

function tmMatch(
  kind: "context" | "exact" | "fuzzy",
  score: number,
  mountPriority = 0,
): TmMatch {
  return {
    kind,
    score,
    mountPriority,
    library: { id: "lib", name: "Lib" },
    substitutions: [],
    unit: { id: `${kind}-${score}`, targetText: "t", sourceText: "s" },
  } as unknown as TmMatch;
}

function termMatch(start: number, end: number, sourceTerm: string): TermMatch {
  return {
    start,
    end,
    sourceTerm,
    entryId: `${start}-${end}`,
    termbaseId: "tb",
    translations: [],
  };
}

describe("matchLabel", () => {
  it("separates a context match from a plain exact one", () => {
    // A context match also agreed with the neighbours, which is why a
    // translator can take it without rereading them.
    expect(matchLabel(tmMatch("context", 100))).toBe("CM");
    expect(matchLabel(tmMatch("exact", 100))).toBe("100%");
  });

  it("floors fuzzy scores so a near miss never reads as perfect", () => {
    expect(matchLabel(tmMatch("fuzzy", 99.6))).toBe("99%");
    expect(matchLabel(tmMatch("fuzzy", 82))).toBe("82%");
  });
});

describe("rankMatches", () => {
  it("puts context above exact above fuzzy regardless of arrival order", () => {
    const ranked = rankMatches([
      tmMatch("fuzzy", 95),
      tmMatch("exact", 100),
      tmMatch("context", 100),
    ]);
    expect(ranked.map(matchLabel)).toEqual(["CM", "100%", "95%"]);
  });

  it("breaks ties on the project's own library priority", () => {
    const ranked = rankMatches([
      tmMatch("fuzzy", 90, 5),
      tmMatch("fuzzy", 90, 1),
    ]);
    expect(ranked[0]?.mountPriority).toBe(1);
  });
});

describe("termHighlightRanges", () => {
  it("keeps the longer hit when a phrase contains a word", () => {
    const ranges = termHighlightRanges([
      termMatch(0, 20, "power station unit"),
      termMatch(6, 13, "station"),
    ]);
    expect(ranges).toEqual([{ start: 0, end: 20 }]);
  });

  it("merges overlaps rather than underlining twice", () => {
    const ranges = termHighlightRanges([
      termMatch(0, 10, "a"),
      termMatch(8, 15, "b"),
    ]);
    expect(ranges).toEqual([{ start: 0, end: 15 }]);
  });

  it("keeps genuinely separate hits apart", () => {
    const ranges = termHighlightRanges([
      termMatch(0, 4, "a"),
      termMatch(10, 14, "b"),
    ]);
    expect(ranges).toHaveLength(2);
  });

  it("ignores empty ranges", () => {
    expect(termHighlightRanges([termMatch(3, 3, "")])).toEqual([]);
  });
});

describe("splitByRanges", () => {
  it("returns the whole string when nothing is highlighted", () => {
    expect(splitByRanges("hello", [])).toEqual([
      { text: "hello", highlighted: false },
    ]);
  });

  it("splits around a highlight", () => {
    expect(splitByRanges("the power station", [{ start: 4, end: 9 }])).toEqual([
      { text: "the ", highlighted: false },
      { text: "power", highlighted: true },
      { text: " station", highlighted: false },
    ]);
  });

  it("counts characters, not UTF-16 units, so CJK offsets line up", () => {
    // Engine term offsets are character based. Slicing by code unit would
    // shift every highlight after an astral character.
    const pieces = splitByRanges("电池容量为 1,024 Wh", [{ start: 0, end: 4 }]);
    expect(pieces[0]).toEqual({ text: "电池容量", highlighted: true });
  });

  it("clamps ranges that run past the end of the text", () => {
    expect(splitByRanges("abc", [{ start: 1, end: 99 }])).toEqual([
      { text: "a", highlighted: false },
      { text: "bc", highlighted: true },
    ]);
  });
});
