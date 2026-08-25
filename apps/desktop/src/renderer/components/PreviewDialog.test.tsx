import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Segment, SegmentState } from "@translunar/contracts";

import { PreviewDialog } from "./PreviewDialog.js";

function segment(
  id: string,
  ordinal: number,
  structuralPath: string,
  source: string,
  target = "",
  state: SegmentState = target ? "confirmed" : "untranslated",
): Segment {
  return {
    id,
    documentId: "d1",
    ordinal,
    structuralPath,
    sourceText: source,
    targetText: target,
    state,
    revision: 1,
    sourceHash: "hash",
    contextHash: "context",
    updatedAtMs: 1,
  };
}

const SEGMENTS = [
  segment("s1", 0, "p:0", "First sentence.", "第一句。"),
  segment("s2", 1, "p:0", "Second sentence.", "第二句。"),
  segment("s3", 2, "p:1", "Untranslated one."),
];

describe("PreviewDialog", () => {
  it("backfills targets and is honest about untranslated fallbacks", () => {
    render(
      <PreviewDialog
        open
        documentName="demo.docx"
        segments={SEGMENTS}
        onClose={vi.fn()}
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByText("第一句。")).toBeInTheDocument();
    expect(screen.getByText("第二句。")).toBeInTheDocument();
    // Untranslated segment shows source text, flagged as fallback.
    const fallback = screen.getByText("Untranslated one.");
    expect(fallback).toHaveAttribute("data-fallback", "true");
    expect(screen.getByText(/1 个未译（以源文回填显示）/)).toBeInTheDocument();
  });

  it("jumps back to the grid from a preview segment", async () => {
    const onJump = vi.fn();
    render(
      <PreviewDialog
        open
        documentName="demo.docx"
        segments={SEGMENTS}
        onClose={vi.fn()}
        onJump={onJump}
      />,
    );
    await userEvent.click(screen.getByText("第二句。"));
    expect(onJump).toHaveBeenCalledWith("s2");
  });

  it("renders nothing when closed", () => {
    render(
      <PreviewDialog
        open={false}
        documentName="demo.docx"
        segments={SEGMENTS}
        onClose={vi.fn()}
        onJump={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
