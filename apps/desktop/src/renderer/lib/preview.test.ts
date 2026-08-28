import { describe, expect, it } from "vitest";

import type { Segment, SegmentState } from "@translunar/contracts";

import { buildPreviewModel } from "./preview.js";

function segment(
  id: string,
  ordinal: number,
  structuralPath: string,
  source: string,
  target = "",
  state: SegmentState = target ? "draft" : "untranslated",
): Segment {
  return {
    id,
    documentId: "d1",
    ordinal,
    structuralPath,
    sourceText: source,
    targetText: target,
    state,
    revision: 1,
    sourceHash: "hash",
    contextHash: "context",
    updatedAtMs: 1,
  };
}

describe("buildPreviewModel", () => {
  it("groups consecutive segments sharing a structural path", () => {
    const model = buildPreviewModel([
      segment("s1", 0, "p:0", "One.", "一。", "confirmed"),
      segment("s2", 1, "p:0", "Two.", "二。"),
      segment("s3", 2, "p:1", "Three."),
    ]);
    expect(model.blocks).toHaveLength(2);
    expect(model.blocks[0]?.parts.map((p) => p.text)).toEqual(["一。", "二。"]);
    expect(model.blocks[1]?.parts).toHaveLength(1);
  });

  it("falls back to source text for untranslated segments and counts them", () => {
    const model = buildPreviewModel([
      segment("s1", 0, "p:0", "Translated.", "已译。", "confirmed"),
      segment("s2", 1, "p:1", "Still source."),
    ]);
    expect(model.totalSegments).toBe(2);
    expect(model.translatedSegments).toBe(1);
    expect(model.fallbackSegments).toBe(1);
    const fallbackPart = model.blocks[1]?.parts[0];
    expect(fallbackPart?.fallback).toBe(true);
    expect(fallbackPart?.text).toBe("Still source.");
  });

  it("orders blocks by ordinal even if input is shuffled", () => {
    const model = buildPreviewModel([
      segment("s2", 1, "p:1", "Second."),
      segment("s1", 0, "p:0", "First."),
    ]);
    expect(model.blocks.map((b) => b.parts[0]?.text)).toEqual([
      "First.",
      "Second.",
    ]);
  });

  it("splits blocks when the same path is not consecutive", () => {
    const model = buildPreviewModel([
      segment("s1", 0, "p:0", "A."),
      segment("s2", 1, "p:1", "B."),
      segment("s3", 2, "p:0", "C."),
    ]);
    expect(model.blocks).toHaveLength(3);
  });
});
