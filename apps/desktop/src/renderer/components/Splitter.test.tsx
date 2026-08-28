import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LAYOUT,
  layoutStorageKey,
  Splitter,
  useWorkbenchLayout,
} from "./Splitter.js";

describe("Splitter", () => {
  it("resizes through a pointer drag, clamped to min/max", () => {
    const onResize = vi.fn();
    render(
      <Splitter
        orientation="vertical"
        label="左栏"
        value={260}
        min={180}
        max={400}
        sign={1}
        onResize={onResize}
        onReset={vi.fn()}
      />,
    );
    const splitter = screen.getByRole("separator", { name: "左栏" });
    fireEvent.pointerDown(splitter, { button: 0, clientX: 300 });
    fireEvent.pointerMove(splitter, { clientX: 340 });
    expect(onResize).toHaveBeenLastCalledWith(300);
    // Far beyond the max: the value clamps instead of running away.
    fireEvent.pointerMove(splitter, { clientX: 900 });
    expect(onResize).toHaveBeenLastCalledWith(400);
    fireEvent.pointerUp(splitter);
    // After release, moves resize nothing.
    onResize.mockClear();
    fireEvent.pointerMove(splitter, { clientX: 200 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("inverts the drag direction for far-side panes (sign -1)", () => {
    const onResize = vi.fn();
    render(
      <Splitter
        orientation="vertical"
        label="右栏"
        value={336}
        min={240}
        max={480}
        sign={-1}
        onResize={onResize}
        onReset={vi.fn()}
      />,
    );
    const splitter = screen.getByRole("separator", { name: "右栏" });
    fireEvent.pointerDown(splitter, { button: 0, clientX: 800 });
    // Dragging right shrinks the right rail.
    fireEvent.pointerMove(splitter, { clientX: 840 });
    expect(onResize).toHaveBeenLastCalledWith(296);
  });

  it("resets on double-click and reports size via aria", () => {
    const onReset = vi.fn();
    render(
      <Splitter
        orientation="vertical"
        label="左栏"
        value={310}
        min={180}
        max={400}
        sign={1}
        onResize={vi.fn()}
        onReset={onReset}
      />,
    );
    const splitter = screen.getByRole("separator", { name: "左栏" });
    expect(splitter).toHaveAttribute("aria-valuenow", "310");
    fireEvent.doubleClick(splitter);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("resizes with arrow keys and collapses with Enter / the chevron", () => {
    const onResize = vi.fn();
    const onToggleCollapse = vi.fn();
    render(
      <Splitter
        orientation="vertical"
        label="左栏"
        value={260}
        min={180}
        max={400}
        sign={1}
        onResize={onResize}
        onReset={vi.fn()}
        onToggleCollapse={onToggleCollapse}
      />,
    );
    const splitter = screen.getByRole("separator", { name: "左栏" });
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(276);
    fireEvent.keyDown(splitter, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(244);
    fireEvent.keyDown(splitter, { key: "Enter" });
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "折叠左栏" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(2);
  });
});

describe("useWorkbenchLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts from defaults and persists updates per project", () => {
    const { result } = renderHook(() => useWorkbenchLayout("p1"));
    expect(result.current[0]).toEqual(DEFAULT_LAYOUT);
    act(() => {
      result.current[1]({ left: 320, previewOpen: true });
    });
    expect(result.current[0].left).toBe(320);
    const stored: unknown = JSON.parse(
      localStorage.getItem(layoutStorageKey("p1"))!,
    );
    expect(stored).toMatchObject({ left: 320, previewOpen: true });
  });

  it("restores the persisted layout on the next mount (per project)", () => {
    localStorage.setItem(
      layoutStorageKey("p1"),
      JSON.stringify({ ...DEFAULT_LAYOUT, right: 400, leftCollapsed: true }),
    );
    const { result } = renderHook(() => useWorkbenchLayout("p1"));
    expect(result.current[0].right).toBe(400);
    expect(result.current[0].leftCollapsed).toBe(true);
    // A different project starts clean.
    const other = renderHook(() => useWorkbenchLayout("p2"));
    expect(other.result.current[0]).toEqual(DEFAULT_LAYOUT);
  });

  it("clamps out-of-range stored sizes and survives corrupt storage", () => {
    localStorage.setItem(
      layoutStorageKey("p1"),
      JSON.stringify({ left: 9999, right: 10, previewHeight: -5 }),
    );
    const { result } = renderHook(() => useWorkbenchLayout("p1"));
    expect(result.current[0].left).toBe(400);
    expect(result.current[0].right).toBe(240);
    expect(result.current[0].previewHeight).toBe(120);

    localStorage.setItem(layoutStorageKey("p2"), "not json");
    const corrupt = renderHook(() => useWorkbenchLayout("p2"));
    expect(corrupt.result.current[0]).toEqual(DEFAULT_LAYOUT);
  });
});
