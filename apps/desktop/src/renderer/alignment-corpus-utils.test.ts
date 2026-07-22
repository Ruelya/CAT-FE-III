import { describe, expect, it } from "vitest";

import {
  areLinksContiguous,
  formatCorpusProvenance,
  isTerminalAiRunStatus,
  mergedAlignmentReplacement,
  orderedSelectedLinks,
  splitAlignmentReplacement,
  unlinkedAlignmentReplacement,
} from "./alignment-corpus-utils";

const links = [
  {
    id: "link-1",
    ordinal: 2,
    sourceSegmentIds: ["source-1"],
    targetSegmentIds: ["target-1"],
  },
  {
    id: "link-2",
    ordinal: 3,
    sourceSegmentIds: ["source-2", "source-3"],
    targetSegmentIds: ["target-2"],
  },
  {
    id: "link-3",
    ordinal: 5,
    sourceSegmentIds: [],
    targetSegmentIds: ["target-3"],
  },
] as const;

describe("alignment corpus helpers", () => {
  it("orders selected links and detects contiguous ranges", () => {
    const selected = orderedSelectedLinks(
      [...links].reverse(),
      new Set(["link-2", "link-1"]),
    );
    expect(selected.map((link) => link.id)).toEqual(["link-1", "link-2"]);
    expect(areLinksContiguous(selected)).toBe(true);
    expect(areLinksContiguous([links[0], links[2]])).toBe(false);
  });

  it("builds complete merge, unlink, and split partitions", () => {
    expect(mergedAlignmentReplacement(links.slice(0, 2))).toEqual([
      {
        sourceSegmentIds: ["source-1", "source-2", "source-3"],
        targetSegmentIds: ["target-1", "target-2"],
      },
    ]);
    expect(unlinkedAlignmentReplacement(links[0])).toEqual([
      { sourceSegmentIds: ["source-1"], targetSegmentIds: [] },
      { sourceSegmentIds: [], targetSegmentIds: ["target-1"] },
    ]);
    expect(splitAlignmentReplacement(links[1])).toEqual([
      { sourceSegmentIds: ["source-2"], targetSegmentIds: ["target-2"] },
      { sourceSegmentIds: ["source-3"], targetSegmentIds: [] },
    ]);
  });

  it("formats unknown provenance without unsafe field casts", () => {
    expect(formatCorpusProvenance({ row: 7, linkId: "link-1" })).toBe(
      '{"row":7,"linkId":"link-1"}',
    );
    expect(formatCorpusProvenance(null)).toBe("No additional provenance");
  });

  it("treats interrupted AI runs as terminal", () => {
    expect(isTerminalAiRunStatus("interrupted")).toBe(true);
    expect(isTerminalAiRunStatus("failed")).toBe(true);
    expect(isTerminalAiRunStatus("canceling")).toBe(false);
    expect(isTerminalAiRunStatus("running")).toBe(false);
  });
});
