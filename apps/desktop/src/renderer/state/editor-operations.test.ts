import { describe, expect, it } from "vitest";
import type {
  EditorMutationResult,
  SegmentEditorRow,
} from "@translunar/contracts";

import {
  applyEditorMutationResult,
  areAdjacentByOrdinal,
  EDITOR_COMMAND_REGISTRY,
  isCommandAvailable,
  isEditorCommandId,
  matchEditorShortcut,
  orderedMergePair,
  resolveAcceptedEditorShortcut,
  shouldRefreshEditorRows,
} from "./editor-operations";

function row(
  id: string,
  ordinal: number,
  revision = 1,
  target = "",
): SegmentEditorRow {
  return {
    segment: {
      id,
      documentId: "doc-1",
      ordinal,
      revision,
      sourceText: `s-${id}`,
      targetText: target,
      state: target ? "draft" : "untranslated",
      contextHash: "c",
      sourceHash: "s",
      structuralPath: String(ordinal),
      updatedAtMs: 1,
    },
    comments: [],
    sourceTags: [],
    targetTags: [],
    spellFindings: [],
    tagIssues: [],
    workflowState: "translation",
  };
}

function mutation(
  rows: SegmentEditorRow[],
  focus?: string | null,
): EditorMutationResult {
  return {
    rows,
    counts: {
      confirmed: 0,
      draft: rows.filter((r) => r.segment.state === "draft").length,
      untranslated: rows.filter((r) => r.segment.state === "untranslated")
        .length,
      total: rows.length,
      openIssues: 0,
    },
    focusSegmentId: focus ?? null,
  };
}

describe("editor-operations", () => {
  it("replaces rows by stable segment id", () => {
    const current = [row("a", 1), row("b", 2, 1, "old")];
    const next = row("b", 2, 2, "new");
    const result = applyEditorMutationResult(
      current,
      mutation([next], "b"),
      "replace",
      "a",
    );
    expect(result.needsFullRefresh).toBe(false);
    expect(result.rows[1]?.segment.targetText).toBe("new");
    expect(result.rows[1]?.segment.revision).toBe(2);
    expect(result.focusSegmentId).toBe("b");
  });

  it("marks structural mutations for full refresh", () => {
    const current = [row("a", 1), row("b", 2)];
    expect(
      shouldRefreshEditorRows(current, mutation([row("a", 1)]), "structural"),
    ).toBe(true);
  });

  it("refreshes when result introduces unknown segment ids", () => {
    const current = [row("a", 1)];
    expect(
      shouldRefreshEditorRows(current, mutation([row("new", 2)]), "replace"),
    ).toBe(true);
  });

  it("detects adjacent ordinals for merge", () => {
    const rows = [row("a", 1), row("b", 2), row("c", 4)];
    expect(areAdjacentByOrdinal(rows, "a", "b")).toBe(true);
    expect(areAdjacentByOrdinal(rows, "a", "c")).toBe(false);
    const pair = orderedMergePair(rows, "b", "a");
    expect(pair?.first.segment.id).toBe("a");
    expect(pair?.second.segment.id).toBe("b");
  });

  it("gates commands on workbench session, composition and active row", () => {
    const base = {
      hasWorkbenchSession: true,
      isDirty: false,
      mutationsEnabled: true,
      busy: false,
      canUndo: false,
      canRedo: false,
      mergeEligible: false,
    };

    expect(
      isCommandAvailable("editor.tags", {
        ...base,
        hasActiveRow: false,
        isComposing: false,
      }),
    ).toBe(false);

    expect(
      isCommandAvailable("editor.tags", {
        ...base,
        hasActiveRow: true,
        isComposing: true,
      }),
    ).toBe(false);

    expect(
      isCommandAvailable("editor.findReplace", {
        ...base,
        hasWorkbenchSession: false,
        hasActiveRow: false,
        isComposing: false,
      }),
    ).toBe(false);

    expect(
      isCommandAvailable("editor.findReplace", {
        ...base,
        hasActiveRow: false,
        isComposing: false,
      }),
    ).toBe(true);

    expect(
      isCommandAvailable("editor.undo", {
        ...base,
        hasActiveRow: true,
        isComposing: false,
        canUndo: true,
      }),
    ).toBe(true);
  });

  it("exposes a single registry with primary and overflow placements", () => {
    expect(EDITOR_COMMAND_REGISTRY.length).toBeGreaterThan(8);
    expect(
      EDITOR_COMMAND_REGISTRY.filter((c) => c.placement === "primary").map(
        (c) => c.id,
      ),
    ).toEqual(
      expect.arrayContaining([
        "editor.findReplace",
        "editor.undo",
        "editor.redo",
      ]),
    );
    expect(
      EDITOR_COMMAND_REGISTRY.some(
        (c) => c.id === "editor.merge" && c.placement === "overflow",
      ),
    ).toBe(true);
    expect(isEditorCommandId("editor.findReplace")).toBe(true);
    expect(isEditorCommandId("not.a.command")).toBe(false);
  });

  it("uses engine counts when provided", () => {
    const current = [row("a", 1)];
    const applied = applyEditorMutationResult(
      current,
      {
        rows: [row("a", 1, 2, "x")],
        counts: {
          confirmed: 9,
          draft: 1,
          untranslated: 0,
          total: 10,
          openIssues: 2,
        },
      },
      "replace",
      "a",
    );
    expect(applied.counts.confirmed).toBe(9);
    expect(applied.counts.openIssues).toBe(2);
  });

  it("matches only registered Ctrl/Cmd chords and rejects palette K", () => {
    expect(
      matchEditorShortcut({
        key: "f",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBe("editor.findReplace");
    expect(
      matchEditorShortcut({
        key: "k",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBeNull();
    expect(
      matchEditorShortcut({
        key: "f",
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBeNull();
  });

  it("accepts Workbench find shortcut and blocks IME / non-workbench", () => {
    const avail = {
      hasWorkbenchSession: true,
      hasActiveRow: false,
      isComposing: false,
      isDirty: false,
      mutationsEnabled: true,
      busy: false,
      canUndo: false,
      canRedo: false,
      mergeEligible: false,
    };
    expect(
      resolveAcceptedEditorShortcut(
        { key: "f", ctrlKey: true, metaKey: false },
        avail,
        { workbenchFocused: true },
      ),
    ).toBe("editor.findReplace");
    expect(
      resolveAcceptedEditorShortcut(
        { key: "f", ctrlKey: true, metaKey: false, isComposing: true },
        avail,
        { workbenchFocused: true },
      ),
    ).toBeNull();
    expect(
      resolveAcceptedEditorShortcut(
        { key: "f", ctrlKey: true, metaKey: false, keyCode: 229 },
        avail,
        { workbenchFocused: true },
      ),
    ).toBeNull();
    expect(
      resolveAcceptedEditorShortcut(
        { key: "f", ctrlKey: true, metaKey: false },
        { ...avail, hasWorkbenchSession: false },
        { workbenchFocused: true },
      ),
    ).toBeNull();
    expect(
      resolveAcceptedEditorShortcut(
        { key: "f", ctrlKey: true, metaKey: false },
        avail,
        { workbenchFocused: false },
      ),
    ).toBeNull();
    expect(
      resolveAcceptedEditorShortcut(
        { key: "k", ctrlKey: true, metaKey: false },
        avail,
        { workbenchFocused: true },
      ),
    ).toBeNull();
  });
});
