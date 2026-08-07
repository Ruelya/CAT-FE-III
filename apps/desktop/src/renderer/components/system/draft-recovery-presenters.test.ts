import { describe, expect, it } from "vitest";

import {
  canRestoreDraft,
  clearDraftSelection,
  countSelected,
  defaultDraftSelection,
  joinDraftClipboardTexts,
  selectAllDrafts,
  selectedDrafts,
  toggleDraftSelection,
  type DraftSelectRow,
} from "./draft-recovery-presenters";

const rows: DraftSelectRow[] = [
  { segmentId: "a", stale: false, targetText: "Hello" },
  { segmentId: "b", stale: true, targetText: "Stale draft" },
  {
    segmentId: "c",
    stale: false,
    unverified: true,
    targetText: "Unverified",
  },
  { segmentId: "d", stale: false, targetText: "World" },
];

describe("draft-recovery-presenters", () => {
  it("defaults non-stale on, stale and unverified off", () => {
    const sel = defaultDraftSelection(rows);
    expect(sel.a).toBe(true);
    expect(sel.b).toBe(false);
    expect(sel.c).toBe(false);
    expect(sel.d).toBe(true);
  });

  it("filters selected drafts", () => {
    const sel = defaultDraftSelection(rows);
    const picked = selectedDrafts(rows, sel);
    expect(picked.map((r) => r.segmentId)).toEqual(["a", "d"]);
  });

  it("joins clipboard texts with separator", () => {
    const text = joinDraftClipboardTexts([
      { segmentId: "a", stale: false, targetText: "One" },
      { segmentId: "b", stale: false, targetText: "Two" },
    ]);
    expect(text).toBe("One\n\n---\n\nTwo");
  });

  it("counts selected", () => {
    expect(countSelected({ a: true, b: false, c: true })).toBe(2);
  });

  it("toggles selection", () => {
    const next = toggleDraftSelection({ a: true }, "a");
    expect(next.a).toBe(false);
    const forced = toggleDraftSelection({ a: false }, "a", true);
    expect(forced.a).toBe(true);
  });

  it("selectAll / clear", () => {
    expect(selectAllDrafts(rows).b).toBe(true);
    expect(selectAllDrafts(rows, true).b).toBe(false);
    expect(clearDraftSelection(rows).a).toBe(false);
  });

  it("canRestoreDraft gates stale/unverified", () => {
    expect(canRestoreDraft(rows[0]!)).toBe(true);
    expect(canRestoreDraft(rows[1]!)).toBe(false);
    expect(canRestoreDraft(rows[2]!)).toBe(false);
  });
});
