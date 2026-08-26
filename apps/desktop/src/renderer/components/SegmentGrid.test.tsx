import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

  it("edits the active segment and confirms the typed draft with Ctrl+Enter", async () => {
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
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [confirmedSegment, draft] = onConfirm.mock.calls[0] as [
      Segment,
      string,
    ];
    expect(confirmedSegment.id).toBe("s1");
    expect(draft).toBe("你好。");
  });

  it("renders no per-row save/confirm buttons in the active row", () => {
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Trados-style editor: typing auto-saves the draft and Ctrl+Enter (or
    // the ribbon/menu) confirms — the row itself carries no buttons.
    expect(
      screen.queryByRole("button", { name: "保存草稿" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "确认" }),
    ).not.toBeInTheDocument();
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

  it("confirms the live draft through the imperative handle (menu path)", async () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.", "你好")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    // Extend the draft first: the handle must confirm the unsaved editor
    // text, exactly like the Ctrl+Enter chord.
    await userEvent.type(screen.getByLabelText("句段 1 译文"), "。");
    let confirmed = false;
    act(() => {
      confirmed = gridRef.current!.confirmActive();
    });
    expect(confirmed).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [confirmedSegment, draft] = onConfirm.mock.calls[0] as [
      Segment,
      string,
    ];
    expect(confirmedSegment.id).toBe("s1");
    expect(draft).toBe("你好。");
  });

  it("refuses to confirm through the handle when no editor is mounted", () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(gridRef.current!.confirmActive()).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("refuses to confirm through the handle during IME composition", () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.compositionStart(editor);
    expect(gridRef.current!.confirmActive()).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);
    let confirmed = false;
    act(() => {
      confirmed = gridRef.current!.confirmActive();
    });
    expect(confirmed).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
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
    fireEvent.keyDown(editor, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("auto-saves the typed draft after a pause, without any button", async () => {
    const onSaveDraft = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    await userEvent.type(editor, "你好。");
    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    const [savedSegment, text] = onSaveDraft.mock.calls[0] as [Segment, string];
    expect(savedSegment.id).toBe("s1");
    expect(text).toBe("你好。");
  });

  it("flushes unsaved typing when the selection leaves the segment, and never confirms", () => {
    const onSaveDraft = vi.fn();
    const onConfirm = vi.fn();
    const segments = [segment("s1", 0, "Hello."), segment("s2", 1, "World.")];
    const view = render(
      <SegmentGrid
        segments={segments}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={onConfirm}
        autoSaveDelayMs={60_000}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.change(editor, { target: { value: "你好。" } });
    // Selection moves before the debounce ever fires: the text still lands
    // as a draft of the segment it was typed into (Studio semantics), and
    // leaving a segment never confirms it.
    view.rerender(
      <SegmentGrid
        segments={segments}
        activeSegmentId="s2"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={onConfirm}
        autoSaveDelayMs={60_000}
      />,
    );
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    const [savedSegment, text] = onSaveDraft.mock.calls[0] as [Segment, string];
    expect(savedSegment.id).toBe("s1");
    expect(text).toBe("你好。");
    expect(onConfirm).not.toHaveBeenCalled();
    // The editor re-seeded for s2 (empty target).
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("句段 2 译文").value,
    ).toBe("");
  });

  it("saves nothing when the editor text matches the committed target", () => {
    const onSaveDraft = vi.fn();
    const { unmount } = render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    unmount();
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("holds the auto-save during IME composition and saves after compositionend", async () => {
    const onSaveDraft = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: "你好" } });
    // Composition text stays out of segment.update while the IME is open.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onSaveDraft).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);
    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    expect(onSaveDraft.mock.calls[0]?.[1]).toBe("你好");
  });

  it("confirm hands the text off and cancels the pending auto-save", async () => {
    const onSaveDraft = vi.fn();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={onConfirm}
        autoSaveDelayMs={20}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.change(editor, { target: { value: "你好。" } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[1]).toBe("你好。");
    // The confirm persists the text itself; the debounced draft save must
    // not fire a duplicate write afterwards.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("never confirms on Esc or blur", async () => {
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
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.blur(editor);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("retries the same text on the next flush when the save was never acked", async () => {
    // onSaveDraft resolving false = the engine never acked the write.
    const onSaveDraft = vi.fn().mockResolvedValue(false);
    const segments = [segment("s1", 0, "Hello.")];
    const view = render(
      <SegmentGrid
        segments={segments}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.change(editor, { target: { value: "你好。" } });
    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    // Leaving the segment flushes the unacked text again instead of
    // silently treating the failed write as saved.
    view.rerender(
      <SegmentGrid
        segments={segments}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    expect(onSaveDraft).toHaveBeenCalledTimes(2);
    expect(onSaveDraft.mock.calls[1]?.[1]).toBe("你好。");
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
