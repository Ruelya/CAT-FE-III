import { describe, expect, it } from "vitest";
import type { InlineTag } from "@translunar/contracts";

import {
  extractPlaceables,
  pairSourceTags,
  pendingCloseGhosts,
  unmatchedSourceTags,
} from "./quickplace";

function tag(
  id: string,
  kind: "start" | "end" | "standalone",
  position: number,
  displayText: string,
  pairId?: string,
): InlineTag {
  return {
    id,
    kind,
    position,
    displayText,
    side: "source",
    payload: displayText,
    protected: true,
    ...(pairId ? { pairId } : {}),
  };
}

describe("pairSourceTags", () => {
  it("pairs a start and end that share display text", () => {
    const { pairs, rest } = pairSourceTags([
      tag("1s", "start", 0, "b"),
      tag("1e", "end", 4, "b"),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.start.id).toBe("1s");
    expect(rest).toHaveLength(0);
  });

  it("honours an explicit pairId over display-text stacking", () => {
    const { pairs } = pairSourceTags([
      tag("a", "start", 0, "b", "p1"),
      tag("b", "start", 1, "b", "p2"),
      tag("c", "end", 2, "b", "p2"),
      tag("d", "end", 3, "b", "p1"),
    ]);
    expect(pairs.map((pair) => `${pair.start.id}-${pair.end.id}`)).toEqual([
      "a-d",
      "b-c",
    ]);
  });
});

describe("extractPlaceables", () => {
  it("lists all tags, the pair, and the tokens in the source", () => {
    const items = extractPlaceables(
      "See 12.4 at https://ex.test or 2024-01-02.",
      [tag("1s", "start", 4, "b"), tag("1e", "end", 8, "b")],
    );
    expect(items.map((item) => item.kind)).toEqual([
      "all-tags",
      "tag",
      "tag",
      "date",
      "url",
      "number",
    ]);
    expect(items.filter((item) => item.kind === "tag").map((item) => item.label)).toEqual(
      ["b", "/b"],
    );
    expect(items.find((item) => item.kind === "number")?.label).toBe("12.4");
  });
});

describe("unmatchedSourceTags", () => {
  it("returns source tags the target has not carried yet", () => {
    const source = [tag("1s", "start", 0, "b"), tag("1e", "end", 2, "b")];
    const target = [{ ...source[0]!, side: "target" as const, id: "t1" }];
    expect(unmatchedSourceTags(source, target).map((tag) => tag.id)).toEqual([
      "1e",
    ]);
  });
});

describe("pendingCloseGhosts", () => {
  it("shows only the closer after the opening tag is placed", () => {
    const source = [
      tag("1s", "start", 0, "b", "p1"),
      tag("1e", "end", 6, "b", "p1"),
    ];
    const target = [{ ...source[0]!, side: "target" as const, position: 3 }];
    const ghosts = pendingCloseGhosts(source, target, 8, new Map(), 12);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.id).toBe("1e");
    expect(ghosts[0]?.position).toBe(8);
  });

  it("does not overlay tags that have not been opened yet", () => {
    const source = [
      tag("1s", "start", 0, "b", "p1"),
      tag("1e", "end", 6, "b", "p1"),
    ];
    expect(pendingCloseGhosts(source, [], 4)).toEqual([]);
  });
});
