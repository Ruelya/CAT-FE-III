import { describe, expect, it } from "vitest";

import { classifyDraftJournal } from "./draft-recovery";

const baseRecord = {
  projectId: "p1",
  documentId: "d1",
  segmentId: "s1",
  expectedRevision: 1,
  targetText: "hello",
  updatedAtMs: 1,
  checksum: "x",
};

describe("classifyDraftJournal", () => {
  it("returns empty for no records", () => {
    expect(
      classifyDraftJournal({ path: "", records: [], totalBytes: 0 }, null),
    ).toEqual({ kind: "empty" });
  });

  it("marks multi-document journals stale", () => {
    const result = classifyDraftJournal(
      {
        path: "",
        totalBytes: 1,
        records: [
          baseRecord,
          { ...baseRecord, documentId: "d2", segmentId: "s2" },
        ],
      },
      null,
    );
    expect(result.kind).toBe("stale");
  });

  it("returns recoverable for consistent journal without probes", () => {
    const result = classifyDraftJournal(
      { path: "", totalBytes: 1, records: [baseRecord] },
      { version: 1, projectId: "p1", documentId: "d1" },
    );
    expect(result).toEqual({
      kind: "recoverable",
      records: [baseRecord],
      staleRecords: [],
      session: { version: 1, projectId: "p1", documentId: "d1" },
    });
  });

  it("marks session mismatch as stale", () => {
    const result = classifyDraftJournal(
      { path: "", totalBytes: 1, records: [baseRecord] },
      { version: 1, projectId: "other", documentId: "d1" },
    );
    expect(result.kind).toBe("stale");
  });

  it("marks missing segment as stale when probes provided", () => {
    const result = classifyDraftJournal(
      { path: "", totalBytes: 1, records: [baseRecord] },
      { version: 1, projectId: "p1", documentId: "d1" },
      [],
    );
    expect(result.kind).toBe("stale");
  });

  it("marks revision mismatch as stale", () => {
    const result = classifyDraftJournal(
      { path: "", totalBytes: 1, records: [baseRecord] },
      { version: 1, projectId: "p1", documentId: "d1" },
      [{ id: "s1", revision: 9, documentId: "d1" }],
    );
    expect(result.kind).toBe("stale");
  });

  it("keeps matching revision recoverable and isolates extra stale records", () => {
    const staleExtra = {
      ...baseRecord,
      segmentId: "s2",
      expectedRevision: 1,
      targetText: "other",
    };
    const result = classifyDraftJournal(
      {
        path: "",
        totalBytes: 1,
        records: [baseRecord, staleExtra],
      },
      { version: 1, projectId: "p1", documentId: "d1" },
      [{ id: "s1", revision: 1, documentId: "d1" }],
    );
    expect(result.kind).toBe("recoverable");
    if (result.kind === "recoverable") {
      expect(result.records).toEqual([baseRecord]);
      expect(result.staleRecords).toEqual([staleExtra]);
    }
  });
});
