import type { Segment } from "@translunar/contracts";
import { describe, expect, it } from "vitest";

import { isCurrentSegmentRevision } from "./PluginAiActions";

describe("plugin AI action proposal ownership", () => {
  it("accepts only the exact segment revision that produced the proposal", () => {
    const original = segment("segment-1", 4);

    expect(isCurrentSegmentRevision(original, "segment-1:4")).toBe(true);
    expect(
      isCurrentSegmentRevision({ ...original, revision: 5 }, "segment-1:4"),
    ).toBe(false);
    expect(
      isCurrentSegmentRevision(segment("segment-2", 4), "segment-1:4"),
    ).toBe(false);
    expect(isCurrentSegmentRevision(undefined, "segment-1:4")).toBe(false);
  });
});

function segment(id: string, revision: number): Segment {
  return {
    contextHash: "context",
    documentId: "document-1",
    id,
    ordinal: 1,
    revision,
    sourceHash: "source",
    sourceText: "source",
    state: "draft",
    structuralPath: "1",
    targetText: "target",
    updatedAtMs: 0,
  };
}
