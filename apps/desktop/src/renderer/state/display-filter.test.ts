import { describe, expect, it } from "vitest";
import type { SegmentEditorRow } from "@translunar/contracts";

import {
  applyDisplayFilter,
  describeFilter,
  EMPTY_FILTER,
  isFilterActive,
  repeatedSources,
} from "./display-filter";

function row(
  id: string,
  state: string,
  sourceText: string,
  targetText = "",
): SegmentEditorRow {
  return {
    segment: {
      id,
      documentId: "doc",
      ordinal: Number(id.replace("s", "")),
      structuralPath: `p:${id}`,
      sourceText,
      targetText,
      state,
      revision: 0,
      sourceHash: sourceText,
      contextHash: id,
      updatedAtMs: 0,
    },
    sourceTags: [],
    targetTags: [],
    tagIssues: [],
  } as unknown as SegmentEditorRow;
}

const rows = [
  row("s1", "confirmed", "Turn the unit on.", "打开设备。"),
  row("s2", "draft", "Do not expose the device.", "请勿暴露设备。"),
  row("s3", "untranslated", "Turn the unit on."),
  row("s4", "confirmed", "Battery is 1,024 Wh.", "电池为 1,024 Wh。"),
];

describe("isFilterActive", () => {
  it("is inactive when nothing is chosen", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it("ignores whitespace-only text", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, text: "   " })).toBe(false);
  });
});

describe("applyDisplayFilter", () => {
  it("returns everything when inactive", () => {
    expect(applyDisplayFilter(rows, EMPTY_FILTER)).toHaveLength(4);
  });

  it("filters by confirmation state", () => {
    const shown = applyDisplayFilter(rows, {
      ...EMPTY_FILTER,
      states: ["draft", "untranslated"],
    });
    expect(shown.map((r) => r.segment.id)).toEqual(["s2", "s3"]);
  });

  it("keeps document order", () => {
    const shown = applyDisplayFilter(rows, {
      ...EMPTY_FILTER,
      states: ["confirmed"],
    });
    expect(shown.map((r) => r.segment.id)).toEqual(["s1", "s4"]);
  });

  it("finds text on either side by default", () => {
    expect(
      applyDisplayFilter(rows, { ...EMPTY_FILTER, text: "打开" }),
    ).toHaveLength(1);
    expect(
      applyDisplayFilter(rows, { ...EMPTY_FILTER, text: "battery" }),
    ).toHaveLength(1);
  });

  it("restricts to one side when asked", () => {
    expect(
      applyDisplayFilter(rows, {
        ...EMPTY_FILTER,
        text: "打开",
        field: "source",
      }),
    ).toHaveLength(0);
  });

  it("supports regular expressions", () => {
    const shown = applyDisplayFilter(rows, {
      ...EMPTY_FILTER,
      text: "\\d,\\d{3}",
      regex: true,
    });
    expect(shown.map((r) => r.segment.id)).toEqual(["s4"]);
  });

  it("shows nothing rather than throwing on a half-typed expression", () => {
    // Typing "(" is a normal intermediate state; blanking the grid is better
    // than an exception, and better than pretending the filter is off.
    expect(
      applyDisplayFilter(rows, { ...EMPTY_FILTER, text: "(", regex: true }),
    ).toHaveLength(0);
  });

  it("filters to repeated source text", () => {
    const shown = applyDisplayFilter(rows, {
      ...EMPTY_FILTER,
      repeatsOnly: true,
    });
    expect(shown.map((r) => r.segment.id)).toEqual(["s1", "s3"]);
  });

  it("filters by comments and QA using supplied counts", () => {
    const context = {
      commentCounts: { s2: 1 },
      qaCounts: { s3: 2, s4: 1 },
    };
    expect(
      applyDisplayFilter(rows, { ...EMPTY_FILTER, withComments: true }, context)
        .length,
    ).toBe(1);
    expect(
      applyDisplayFilter(rows, { ...EMPTY_FILTER, withQaIssues: true }, context)
        .length,
    ).toBe(2);
  });

  it("combines criteria rather than choosing between them", () => {
    const context = { commentCounts: {}, qaCounts: { s3: 1 } };
    const shown = applyDisplayFilter(
      rows,
      { ...EMPTY_FILTER, withQaIssues: true, states: ["untranslated"] },
      context,
    );
    expect(shown.map((r) => r.segment.id)).toEqual(["s3"]);
  });
});

describe("repeatedSources", () => {
  it("only counts text that appears more than once", () => {
    const repeats = repeatedSources(rows);
    expect(repeats.has("Turn the unit on.")).toBe(true);
    expect(repeats.has("Battery is 1,024 Wh.")).toBe(false);
  });

  it("ignores empty source text", () => {
    expect(
      repeatedSources([row("s1", "draft", ""), row("s2", "draft", "")]).size,
    ).toBe(0);
  });
});

describe("describeFilter", () => {
  it("says the total when nothing is filtered", () => {
    expect(describeFilter(EMPTY_FILTER, 4, 4)).toBe("4 segments");
  });

  it("says how much is hidden when something is", () => {
    expect(describeFilter({ ...EMPTY_FILTER, repeatsOnly: true }, 2, 4)).toBe(
      "2 of 4 segments",
    );
  });
});
