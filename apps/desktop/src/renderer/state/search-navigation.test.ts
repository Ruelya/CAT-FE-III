import { describe, expect, it } from "vitest";

import {
  classifySearchHit,
  nextFindSegmentId,
  searchHitKey,
  trimSearchQuery,
} from "./search-navigation";

describe("classifySearchHit", () => {
  it("classifies project-only hits", () => {
    expect(classifySearchHit({ projectId: "p1" })).toEqual({
      kind: "project",
      projectId: "p1",
    });
  });

  it("classifies document hits", () => {
    expect(classifySearchHit({ projectId: "p1", documentId: "d1" })).toEqual({
      kind: "document",
      projectId: "p1",
      documentId: "d1",
    });
  });

  it("classifies segment hits", () => {
    expect(
      classifySearchHit({
        projectId: "p1",
        documentId: "d1",
        segmentId: "s1",
      }),
    ).toEqual({
      kind: "segment",
      projectId: "p1",
      documentId: "d1",
      segmentId: "s1",
    });
  });

  it("rejects segment without document", () => {
    const result = classifySearchHit({
      projectId: "p1",
      segmentId: "s1",
    });
    expect(result.kind).toBe("invalid");
  });

  it("rejects blank project", () => {
    expect(classifySearchHit({ projectId: "  " }).kind).toBe("invalid");
  });
});

describe("search helpers", () => {
  it("trims query text", () => {
    expect(trimSearchQuery("  hello  ")).toBe("hello");
  });

  it("builds stable keys", () => {
    const key = searchHitKey(
      {
        projectId: "p",
        documentId: "d",
        segmentId: "s",
        field: "target",
        updatedAtMs: 1,
      },
      0,
    );
    expect(key).toContain("p:d:s");
  });
});

describe("nextFindSegmentId", () => {
  const hit = (segmentId: string) => ({ segmentId });

  it("starts at the first hit when the active segment has none", () => {
    const matches = [hit("a"), hit("b")];
    expect(nextFindSegmentId(matches, "elsewhere")).toBe("a");
    expect(nextFindSegmentId(matches, null)).toBe("a");
  });

  it("advances past every occurrence inside the active segment", () => {
    // Segment "a" holds the query twice; stepping one entry would land on
    // "a" again and F4 would look dead.
    const matches = [hit("a"), hit("a"), hit("b"), hit("c")];
    expect(nextFindSegmentId(matches, "a")).toBe("b");
    expect(nextFindSegmentId(matches, "b")).toBe("c");
  });

  it("wraps from the last segment back to the first", () => {
    const matches = [hit("a"), hit("b")];
    expect(nextFindSegmentId(matches, "b")).toBe("a");
  });

  it("returns null when all hits already live in the active segment", () => {
    expect(nextFindSegmentId([hit("a"), hit("a")], "a")).toBeNull();
    expect(nextFindSegmentId([], "a")).toBeNull();
  });
});
