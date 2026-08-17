import { describe, expect, it } from "vitest";

import {
  canStoreTerm,
  concordanceQueryFor,
  EMPTY_SELECTION,
} from "./editor-selection";

describe("concordanceQueryFor", () => {
  it("prefers what the translator highlighted in the source", () => {
    expect(
      concordanceQueryFor(
        { ...EMPTY_SELECTION, source: "power station", target: "电源站" },
        "The power station is heavy.",
      ),
    ).toBe("power station");
  });

  it("falls back to a target selection, which asks the same question", () => {
    expect(
      concordanceQueryFor(
        { ...EMPTY_SELECTION, target: "电源站" },
        "The power station is heavy.",
      ),
    ).toBe("电源站");
  });

  it("defaults to a short whole sentence when nothing is selected", () => {
    expect(concordanceQueryFor(EMPTY_SELECTION, "Turn the unit on.")).toBe(
      "Turn the unit on.",
    );
  });

  it("refuses to default to a long sentence", () => {
    // Concordance on a whole paragraph returns nothing useful and costs a
    // round trip, so it is not worth guessing.
    const long = "x".repeat(120);
    expect(concordanceQueryFor(EMPTY_SELECTION, long)).toBe("");
  });

  it("treats whitespace-only source as nothing to search", () => {
    expect(concordanceQueryFor(EMPTY_SELECTION, "   ")).toBe("");
  });
});

describe("canStoreTerm", () => {
  it("needs both sides of the term", () => {
    expect(canStoreTerm(EMPTY_SELECTION)).toBe(false);
    expect(canStoreTerm({ ...EMPTY_SELECTION, source: "a" })).toBe(false);
    expect(canStoreTerm({ ...EMPTY_SELECTION, target: "b" })).toBe(false);
    expect(canStoreTerm({ ...EMPTY_SELECTION, source: "a", target: "b" })).toBe(
      true,
    );
  });
});
