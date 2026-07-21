import { describe, expect, it } from "vitest";

import { parseStoredSession } from "./session-utils";

describe("stored workspace sessions", () => {
  it("accepts a complete session with non-empty identifiers", () => {
    expect(
      parseStoredSession(
        JSON.stringify({ projectId: "project-1", documentId: "document-1" }),
      ),
    ).toEqual({ projectId: "project-1", documentId: "document-1" });
  });

  it("rejects malformed JSON and incomplete shapes", () => {
    expect(parseStoredSession("{broken")).toBeNull();
    expect(
      parseStoredSession(JSON.stringify({ projectId: "project-1" })),
    ).toBeNull();
    expect(
      parseStoredSession(
        JSON.stringify({ projectId: " ", documentId: "document-1" }),
      ),
    ).toBeNull();
    expect(parseStoredSession(null)).toBeNull();
  });
});
