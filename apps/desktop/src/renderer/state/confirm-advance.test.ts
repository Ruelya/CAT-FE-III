import { describe, expect, it } from "vitest";
import type { SegmentEditorRow } from "@translunar/contracts";

import {
  confirmModeFromEvent,
  nextSegmentAfterConfirm,
} from "./confirm-advance";

function row(id: string, state: string): SegmentEditorRow {
  return {
    segment: {
      id,
      documentId: "doc",
      ordinal: Number(id.replace("s", "")),
      structuralPath: `p:${id}`,
      sourceText: `source ${id}`,
      targetText: "",
      state,
      revision: 0,
      sourceHash: id,
      contextHash: id,
      updatedAtMs: 0,
    },
    sourceTags: [],
    targetTags: [],
    tagIssues: [],
  } as unknown as SegmentEditorRow;
}

const rows = [
  row("s1", "confirmed"),
  row("s2", "confirmed"),
  row("s3", "draft"),
  row("s4", "confirmed"),
  row("s5", "untranslated"),
];

describe("nextSegmentAfterConfirm", () => {
  it("skips confirmed segments by default", () => {
    expect(nextSegmentAfterConfirm(rows, "s1", "next-unconfirmed")).toBe("s3");
    expect(nextSegmentAfterConfirm(rows, "s3", "next-unconfirmed")).toBe("s5");
  });

  it("treats a propagated draft as still needing a human", () => {
    // s3 arrived pre-filled by propagation. Skipping it would hand back a
    // document that looks finished and was never read.
    expect(nextSegmentAfterConfirm(rows, "s2", "next-unconfirmed")).toBe("s3");
  });

  it("wraps to earlier unfinished work before giving up", () => {
    const trailing = [
      row("s1", "draft"),
      row("s2", "confirmed"),
      row("s3", "confirmed"),
    ];
    expect(nextSegmentAfterConfirm(trailing, "s3", "next-unconfirmed")).toBe(
      "s1",
    );
  });

  it("stops at the end when nothing is left unconfirmed", () => {
    const done = [row("s1", "confirmed"), row("s2", "confirmed")];
    expect(nextSegmentAfterConfirm(done, "s2", "next-unconfirmed")).toBeNull();
    expect(nextSegmentAfterConfirm(done, "s1", "next-unconfirmed")).toBeNull();
  });

  it("walks document order in next mode, confirmed or not", () => {
    expect(nextSegmentAfterConfirm(rows, "s1", "next")).toBe("s2");
    expect(nextSegmentAfterConfirm(rows, "s5", "next")).toBeNull();
  });

  it("holds position in stay mode", () => {
    expect(nextSegmentAfterConfirm(rows, "s1", "stay")).toBeNull();
  });

  it("returns nothing for a segment that is no longer in the list", () => {
    expect(
      nextSegmentAfterConfirm(rows, "gone", "next-unconfirmed"),
    ).toBeNull();
  });
});

describe("confirmModeFromEvent", () => {
  it("defaults to skipping finished work", () => {
    expect(confirmModeFromEvent()).toBe("next-unconfirmed");
    expect(confirmModeFromEvent({})).toBe("next-unconfirmed");
  });

  it("reads Alt as do-not-skip and Shift as do-not-move", () => {
    expect(confirmModeFromEvent({ altKey: true })).toBe("next");
    expect(confirmModeFromEvent({ shiftKey: true })).toBe("stay");
    // Shift wins: not moving is the more conservative of the two.
    expect(confirmModeFromEvent({ altKey: true, shiftKey: true })).toBe("stay");
  });
});
