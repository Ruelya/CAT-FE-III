import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Segment } from "@translunar/contracts";

import { SegmentGrid } from "./SegmentGrid.js";
import type { SegmentGridHandle } from "./SegmentGrid.js";

function segment(
  id: string,
  ordinal: number,
  source: string,
  target = "",
): Segment {
  return {
    id,
    documentId: "d1",
    ordinal,
    structuralPath: `p:${ordinal}`,
    sourceText: source,
    targetText: target,
    state: target ? "draft" : "untranslated",
    revision: 1,
    sourceHash: "hash",
    contextHash: "context",
    updatedAtMs: 1,
  };
}

describe("SegmentGrid", () => {
  it("renders rows and selects a segment on click", async () => {
    const onSelect = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello."), segment("s2", 1, "World.")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={onSelect}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Hello.")).toBeInTheDocument();
    await userEvent.click(screen.getByText("World."));
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("edits the active segment and confirms with the typed draft", async () => {
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    await userEvent.type(editor, "你好。");
    await userEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [confirmedSegment, draft] = onConfirm.mock.calls[0] as [
      Segment,
      string,
    ];
    expect(confirmedSegment.id).toBe("s1");
    expect(draft).toBe("你好。");
  });

  it("flags segments with open QA issues", () => {
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "30 days.", "60 天。")]}
        activeSegmentId={null}
        qaSegmentIds={new Set(["s1"])}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("QA")).toBeInTheDocument();
  });

  it("renders every row for small documents (no virtualization)", () => {
    const segments = Array.from({ length: 20 }, (_, i) =>
      segment(`s${i}`, i, `Sentence ${i}.`),
    );
    const { container } = render(
      <SegmentGrid
        segments={segments}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(container.querySelector(".segment-grid__spacer")).toBeNull();
  });

  it("inserts text at the editor caret through the imperative handle", () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "The retention period.", "保留是 30 天。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText<HTMLTextAreaElement>("句段 1 译文");
    editor.setSelectionRange(2, 2);
    let inserted = false;
    act(() => {
      inserted = gridRef.current!.insertAtCaret("期");
    });
    expect(inserted).toBe(true);
    expect(editor.value).toBe("保留期是 30 天。");
    // Caret lands right after the inserted text and focus returns to the
    // editor so the confirm shortcut keeps working.
    expect(editor.selectionStart).toBe(3);
    expect(editor.selectionEnd).toBe(3);
    expect(document.activeElement).toBe(editor);
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[1]).toBe("保留期是 30 天。");
  });

  it("replaces the selected range when inserting", () => {
    const gridRef = createRef<SegmentGridHandle>();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "The retention period.", "错误术语在此。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const editor = screen.getByLabelText<HTMLTextAreaElement>("句段 1 译文");
    editor.setSelectionRange(0, 4);
    act(() => {
      gridRef.current!.insertAtCaret("保留期");
    });
    expect(editor.value).toBe("保留期在此。");
    expect(editor.selectionStart).toBe(3);
    expect(editor.selectionEnd).toBe(3);
  });

  it("defers inserts during IME composition until the composition ends", () => {
    const gridRef = createRef<SegmentGridHandle>();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "The retention period.", "初稿")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const editor = screen.getByLabelText<HTMLTextAreaElement>("句段 1 译文");
    editor.setSelectionRange(2, 2);
    fireEvent.compositionStart(editor);
    let inserted = false;
    act(() => {
      inserted = gridRef.current!.insertAtCaret("术语");
    });
    expect(inserted).toBe(true);
    // Mid-composition the value stays untouched so the IME is not broken.
    expect(editor.value).toBe("初稿");
    fireEvent.compositionEnd(editor);
    expect(editor.value).toBe("初稿术语");
    expect(editor.selectionStart).toBe(4);
  });

  it("reports no editor when no row is being edited", () => {
    const gridRef = createRef<SegmentGridHandle>();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(gridRef.current!.insertAtCaret("术语")).toBe(false);
  });

  it("ignores the confirm shortcut while an IME composition is active", () => {
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true, isComposing: true });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("windows large documents instead of rendering every row", () => {
    const segments = Array.from({ length: 500 }, (_, i) =>
      segment(`s${i}`, i, `Sentence ${i}.`),
    );
    const { container } = render(
      <SegmentGrid
        segments={segments}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const rows = container.querySelectorAll(
      "tbody tr:not(.segment-grid__spacer)",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    // The unrendered tail is held open by a spacer row.
    expect(
      container.querySelectorAll(".segment-grid__spacer").length,
    ).toBeGreaterThan(0);
    // First window starts at the top of the document.
    expect(screen.getByText("Sentence 0.")).toBeInTheDocument();
    expect(screen.queryByText("Sentence 499.")).not.toBeInTheDocument();
  });
});
