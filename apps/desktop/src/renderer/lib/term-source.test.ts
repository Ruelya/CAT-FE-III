import { describe, expect, it, vi } from "vitest";
import type { TermMatch, TermTranslation } from "@translunar/contracts";

import {
  filterTermMatches,
  highlightSlices,
  matchCoveringRange,
  mergeTermMatches,
  nextInsertableTerm,
  normalizeTermQuery,
  pickWritableTermbase,
  preferredTranslation,
  segmentSpanForTerm,
  termSourceHighlights,
} from "./term-source";

function translation(
  term: string,
  flags: Partial<Pick<TermTranslation, "preferred" | "forbidden">> = {},
): TermTranslation {
  return {
    id: `tr-${term}`,
    entryId: "e",
    locale: "zh",
    term,
    preferred: flags.preferred === true,
    forbidden: flags.forbidden === true,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function match(
  sourceTerm: string,
  translations: TermTranslation[],
  start = 0,
  end = sourceTerm.length,
  entryId = sourceTerm,
): TermMatch {
  return {
    start,
    end,
    entryId,
    sourceTerm,
    termbaseId: "tb",
    translations,
  };
}

describe("preferredTranslation", () => {
  it("skips forbidden forms and prefers the marked one", () => {
    expect(
      preferredTranslation(
        match("power station", [
          translation("发电厂", { forbidden: true }),
          translation("电站"),
          translation("电源站", { preferred: true }),
        ]),
      ),
    ).toBe("电源站");
  });

  it("falls back to the first allowed form when none is preferred", () => {
    expect(
      preferredTranslation(
        match("power station", [translation("电站"), translation("电源站")]),
      ),
    ).toBe("电站");
  });

  it("returns null when every form is forbidden", () => {
    expect(
      preferredTranslation(
        match("power station", [translation("发电厂", { forbidden: true })]),
      ),
    ).toBeNull();
  });
});

describe("filterTermMatches", () => {
  const hits = [
    match("power station", [translation("电源站")]),
    match("warranty", [translation("质保")]),
  ];

  it("treats a blank query as no filter", () => {
    expect(filterTermMatches(hits, "   ")).toHaveLength(2);
  });

  it("matches source or translation, and treats * as contains", () => {
    expect(filterTermMatches(hits, "pow*").map((item) => item.sourceTerm)).toEqual(
      ["power station"],
    );
    expect(filterTermMatches(hits, "质保").map((item) => item.sourceTerm)).toEqual(
      ["warranty"],
    );
  });
});

describe("mergeTermMatches", () => {
  it("keeps the recognised hit and appends lookup-only entries", () => {
    const recognised = [match("power station", [translation("电源站")])];
    const lookup = [
      match("power station", [translation("电源站")]),
      match("battery", [translation("电池")]),
    ];
    expect(mergeTermMatches(recognised, lookup).map((item) => item.entryId)).toEqual(
      ["power station", "battery"],
    );
  });
});

describe("matchCoveringRange", () => {
  it("picks the longer phrase when two hits share a painted range", () => {
    const hits = [
      match("station", [translation("站")], 6, 13),
      match("power station", [translation("电源站")], 0, 13),
    ];
    expect(matchCoveringRange(hits, { start: 0, end: 13 })?.sourceTerm).toBe(
      "power station",
    );
  });
});

describe("nextInsertableTerm", () => {
  it("skips a forbidden-only entry and wraps around the list", () => {
    const hits = [
      match("a", [translation("甲", { forbidden: true })]),
      match("b", [translation("乙", { preferred: true })]),
      match("c", [translation("丙")]),
    ];
    expect(nextInsertableTerm(hits, 0)).toEqual({ index: 1, translation: "乙" });
    expect(nextInsertableTerm(hits, 2)).toEqual({ index: 2, translation: "丙" });
    expect(nextInsertableTerm(hits, 3)).toEqual({ index: 1, translation: "乙" });
  });

  it("returns null when the list is empty or nothing is insertable", () => {
    expect(nextInsertableTerm([], 0)).toBeNull();
    expect(
      nextInsertableTerm(
        [match("a", [translation("甲", { forbidden: true })])],
        0,
      ),
    ).toBeNull();
  });
});

describe("segmentSpanForTerm", () => {
  it("only returns a span that belongs to the current segment", () => {
    const recognised = [match("power station", [translation("电源站")], 4, 17)];
    expect(
      segmentSpanForTerm(recognised[0]!, recognised),
    ).toEqual({ start: 4, end: 17 });
    expect(
      segmentSpanForTerm(match("battery", [translation("电池")], 0, 7), recognised),
    ).toBeNull();
  });
});

describe("termSourceHighlights", () => {
  it("paints a clickable underline that inserts the preferred form", () => {
    const onInsert = vi.fn();
    const marks = termSourceHighlights(
      [match("power station", [translation("电源站", { preferred: true })], 4, 17)],
      onInsert,
    );
    expect(marks).toEqual([
      expect.objectContaining({
        start: 4,
        end: 17,
        className: "term-source-hit",
        testId: "term-source-hit",
        title: "power station → 电源站",
      }),
    ]);
    marks[0]?.onClick?.();
    expect(onInsert).toHaveBeenCalledWith("电源站");
  });
});

describe("highlightSlices", () => {
  it("nests overlapping marks instead of dropping one", () => {
    const slices = highlightSlices("the power station", 0, [
      { start: 4, end: 17, className: "term-source-hit" },
      { start: 4, end: 9, className: "qp-source-hit" },
    ]);
    expect(slices.map((slice) => [slice.text, slice.highlights.map((h) => h.className)])).toEqual([
      ["the ", []],
      ["power", ["term-source-hit", "qp-source-hit"]],
      [" station", ["term-source-hit"]],
    ]);
  });

  it("clips marks to the current run so a tag split does not shift later text", () => {
    const slices = highlightSlices("station", 10, [
      { start: 4, end: 17, className: "term-source-hit" },
    ]);
    expect(slices).toEqual([
      { text: "station", highlights: [expect.objectContaining({ start: 10, end: 17 })] },
    ]);
  });
});

describe("normalizeTermQuery", () => {
  it("strips wildcard stars so a typed prefix still filters", () => {
    expect(normalizeTermQuery("  Pow*  ")).toBe("pow");
  });
});

describe("pickWritableTermbase", () => {
  it("prefers an enabled writable mount over a read-only item", () => {
    expect(
      pickWritableTermbase({
        items: [{ id: "tb-ro", writable: false }],
        mounts: [
          { termbaseId: "tb-ro", enabled: true, writable: false },
          { termbaseId: "tb-rw", enabled: true, writable: true },
        ],
      }),
    ).toEqual({ termbaseId: "tb-rw", needsMount: false });
  });

  it("asks the caller to mount a writable item that is not on the project yet", () => {
    expect(
      pickWritableTermbase({
        items: [{ id: "tb-rw", writable: true }],
        mounts: [],
      }),
    ).toEqual({ termbaseId: "tb-rw", needsMount: true });
  });

  it("returns null when the project has nothing writable, so Quick Add can create one", () => {
    expect(
      pickWritableTermbase({
        items: [{ id: "tb-ro", writable: false }],
        mounts: [{ termbaseId: "tb-ro", enabled: true, writable: false }],
      }),
    ).toBeNull();
  });
});
