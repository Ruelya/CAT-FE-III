import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Segment } from "@translunar/contracts";

import { SegmentGrid } from "./SegmentGrid.js";

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
});
