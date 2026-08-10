import { describe, expect, it } from "vitest";

import {
  classifySearchHit,
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
