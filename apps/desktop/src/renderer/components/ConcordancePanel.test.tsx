import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Segment } from "@translunar/contracts";

import { ConcordancePanel, searchConcordance } from "./ConcordancePanel.js";

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

const SEGMENTS = [
  segment("s1", 0, "The retention period is 30 days.", "保留期为 30 天。"),
  segment("s2", 1, "Retention matters.", ""),
  segment("s3", 2, "Nothing here.", "这里没有。"),
];

describe("searchConcordance", () => {
  it("finds case-insensitive hits in source and target", () => {
    const hits = searchConcordance(SEGMENTS, "retention");
    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.field === "source")).toBe(true);
    const targetHits = searchConcordance(SEGMENTS, "保留期");
    expect(targetHits).toHaveLength(1);
    expect(targetHits[0]?.field).toBe("target");
  });

  it("returns nothing for a blank query", () => {
    expect(searchConcordance(SEGMENTS, "   ")).toHaveLength(0);
  });
});

describe("ConcordancePanel", () => {
  it("seeds the query from the F3 selection and lists hits", () => {
    render(
      <ConcordancePanel
        segments={SEGMENTS}
        initialQuery="retention"
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/检索词/)).toHaveValue("retention");
    expect(screen.getByText("2 命中")).toBeInTheDocument();
    // Substring highlighting wraps the matched chunk in a mark.
    expect(screen.getAllByText(/retention/i).length).toBeGreaterThan(0);
  });

  it("jumps to the hit segment", async () => {
    const onJump = vi.fn();
    render(
      <ConcordancePanel
        segments={SEGMENTS}
        initialQuery="保留期"
        onJump={onJump}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "定位句段" }));
    expect(onJump).toHaveBeenCalledWith("s1");
  });

  it("is honest about the document-only scope", () => {
    render(
      <ConcordancePanel segments={SEGMENTS} initialQuery="" onJump={vi.fn()} />,
    );
    expect(screen.getByText(/尚无 TM 级检索 API/)).toBeInTheDocument();
  });

  it("supports typing a new query", async () => {
    render(
      <ConcordancePanel segments={SEGMENTS} initialQuery="" onJump={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText(/检索词/), "nothing");
    expect(screen.getByText("1 命中")).toBeInTheDocument();
  });
});
