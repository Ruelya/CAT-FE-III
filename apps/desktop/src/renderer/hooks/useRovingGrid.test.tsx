import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SegmentRowView } from "../components/workbench/segmentTypes";
import { useRovingGrid } from "./useRovingGrid";

function row(id: string, ordinal: number): SegmentRowView {
  return {
    segmentId: id,
    ordinal,
    sourceText: "s",
    targetDraft: "t",
    segmentState: "draft",
    workflowState: "translation",
    lampState: "draft",
    isActive: false,
    isSelected: false,
    isAnchor: false,
    isFlash: false,
    isSigned: false,
    isEditable: true,
    mergeEligible: false,
    openCommentCount: 0,
    sourceTags: [],
    targetTags: [],
    selectedTargetTagId: null,
    findings: [],
    autocomplete: null,
    spellFindings: [],
    ariaInvalid: false,
  };
}

function keyEvent(
  key: string,
  extras: Partial<{
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    keyCode: number;
    defaultPrevented: boolean;
    preventDefault: () => void;
    target: EventTarget | null;
  }> = {},
) {
  const preventDefault = extras.preventDefault ?? vi.fn();
  return {
    key,
    preventDefault,
    nativeEvent: {
      isComposing: false,
      keyCode: extras.keyCode ?? 0,
    },
    shiftKey: extras.shiftKey ?? false,
    ctrlKey: extras.ctrlKey ?? false,
    metaKey: extras.metaKey ?? false,
    altKey: extras.altKey ?? false,
    defaultPrevented: extras.defaultPrevented ?? false,
    target: extras.target ?? null,
  } as never;
}

describe("useRovingGrid", () => {
  it("exposes one tab stop and target as default descendant", () => {
    const onActivate = vi.fn();
    const onSelectionChange = vi.fn();
    const gridRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useRovingGrid({
        rows: [row("a", 0), row("b", 1)],
        total: 2,
        offset: 0,
        activeId: "a",
        gridRef,
        selectedIds: new Set(["a"]),
        anchorId: "a",
        onSelectionChange,
        onActivate,
        isRowEditable: () => true,
      }),
    );
    expect(result.current.gridTabIndex).toBe(0);
    expect(result.current.activeDescendant).toBe("seg-cell-a-target");
  });

  it("moves down with ArrowDown and activates next row", () => {
    const onActivate = vi.fn();
    const onSelectionChange = vi.fn();
    const gridRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useRovingGrid({
        rows: [row("a", 0), row("b", 1)],
        total: 2,
        offset: 0,
        activeId: "a",
        gridRef,
        selectedIds: new Set(["a"]),
        anchorId: "a",
        onSelectionChange,
        onActivate,
        isRowEditable: () => true,
      }),
    );
    act(() => {
      result.current.onGridKeyDown(keyEvent("ArrowDown"));
    });
    expect(onActivate).toHaveBeenCalledWith("b");
  });

  it("ignores keys while composing (keyCode 229)", () => {
    const onActivate = vi.fn();
    const gridRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useRovingGrid({
        rows: [row("a", 0), row("b", 1)],
        total: 2,
        offset: 0,
        activeId: "a",
        gridRef,
        selectedIds: new Set(["a"]),
        anchorId: "a",
        onSelectionChange: vi.fn(),
        onActivate,
        isRowEditable: () => true,
      }),
    );
    act(() => {
      result.current.onGridKeyDown(keyEvent("ArrowDown", { keyCode: 229 }));
    });
    expect(onActivate).not.toHaveBeenCalledWith("b");
  });

  it("seeks when ArrowDown leaves the mounted window and completes after rows update", async () => {
    const onActivate = vi.fn();
    const onSeekOrdinal = vi.fn().mockResolvedValue(undefined);
    const gridRef = createRef<HTMLDivElement>();
    let rows = [row("a", 0), row("b", 1)];
    let offset = 0;

    const { result, rerender } = renderHook(() =>
      useRovingGrid({
        rows,
        total: 4,
        offset,
        activeId: "b",
        gridRef,
        selectedIds: new Set(["b"]),
        anchorId: "b",
        onSelectionChange: vi.fn(),
        onActivate,
        onSeekOrdinal,
        isRowEditable: () => true,
      }),
    );

    await act(async () => {
      result.current.onGridKeyDown(keyEvent("ArrowDown"));
    });
    expect(onSeekOrdinal).toHaveBeenCalledWith(2);
    expect(onActivate).not.toHaveBeenCalledWith("c");

    rows = [row("c", 2), row("d", 3)];
    offset = 2;

    await act(async () => {
      rerender();
    });
    expect(onActivate).toHaveBeenCalledWith("c");
  });

  it("select-all uses filter-scope IDs, not the mounted window", () => {
    const onSelectionChange = vi.fn();
    const gridRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useRovingGrid({
        rows: [row("a", 0), row("b", 1)],
        total: 4,
        offset: 0,
        activeId: "a",
        gridRef,
        selectedIds: new Set(["a"]),
        anchorId: "a",
        onSelectionChange,
        onActivate: vi.fn(),
        allFilteredIds: ["a", "b", "c", "d"],
        isRowEditable: () => true,
      }),
    );
    act(() => {
      result.current.onGridKeyDown(
        keyEvent("a", { shiftKey: true, ctrlKey: true }),
      );
    });
    expect(onSelectionChange).toHaveBeenCalledWith({
      selectedIds: new Set(["a", "b", "c", "d"]),
      anchorId: "a",
    });
  });

  it("select-all without scope IDs calls Workbench adapter, not window-only set", () => {
    const onSelectionChange = vi.fn();
    const onSelectAllFilterScope = vi.fn();
    const gridRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useRovingGrid({
        rows: [row("a", 0), row("b", 1)],
        total: 50,
        offset: 0,
        activeId: "a",
        gridRef,
        selectedIds: new Set(["a"]),
        anchorId: "a",
        onSelectionChange,
        onActivate: vi.fn(),
        onSelectAllFilterScope,
        isRowEditable: () => true,
      }),
    );
    act(() => {
      result.current.onGridKeyDown(
        keyEvent("a", { shiftKey: true, ctrlKey: true }),
      );
    });
    expect(onSelectAllFilterScope).toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("Tab in edit mode advances to the next editable target", () => {
    const onActivate = vi.fn();
    const gridRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useRovingGrid({
        rows: [row("a", 0), row("b", 1)],
        total: 2,
        offset: 0,
        activeId: "a",
        gridRef,
        selectedIds: new Set(["a"]),
        anchorId: "a",
        onSelectionChange: vi.fn(),
        onActivate,
        isRowEditable: () => true,
      }),
    );
    act(() => {
      result.current.enterEdit("a");
    });
    expect(result.current.mode).toBe("edit");
    act(() => {
      result.current.onGridKeyDown(keyEvent("Tab"));
    });
    expect(onActivate).toHaveBeenCalledWith("b");
    expect(result.current.mode).toBe("edit");
  });

  it("Escape in edit mode returns to navigation without changing selection size=1", () => {
    const onSelectionChange = vi.fn();
    const gridRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useRovingGrid({
        rows: [row("a", 0)],
        total: 1,
        offset: 0,
        activeId: "a",
        gridRef,
        selectedIds: new Set(["a"]),
        anchorId: "a",
        onSelectionChange,
        onActivate: vi.fn(),
        isRowEditable: () => true,
      }),
    );
    act(() => {
      result.current.enterEdit("a");
    });
    act(() => {
      result.current.onGridKeyDown(keyEvent("Escape"));
    });
    expect(result.current.mode).toBe("navigate");
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});
