import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { SegmentGrid } from "./SegmentGrid";
import type { SegmentGridLabels, SegmentRowView } from "./segmentTypes";

function row(
  id: string,
  ordinal: number,
  extras: Partial<SegmentRowView> = {},
): SegmentRowView {
  return {
    segmentId: id,
    ordinal,
    sourceText: `source-${id}`,
    targetDraft: `target-${id}`,
    segmentState: "draft",
    workflowState: "translation",
    lampState: "draft",
    isActive: id === "a",
    isSelected: id === "a" || id === "b",
    isAnchor: id === "a",
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
    ...extras,
  };
}

const labels: SegmentGridLabels = {
  region: "Segments",
  idColumn: "ID",
  status: "Status",
  sourceColumn: "Source",
  targetColumn: "Target",
  untranslated: "Untranslated",
  segmentTools: "Tools",
  bestMatch: "Best match",
  comments: "Comments",
  more: "More",
  targetTags: "Tags",
  selectProtectedTag: (tag, position) => `${tag}@${position}`,
  moveTagHint: "Move",
  targetSegment: (n) => `Target ${n}`,
  acceptAutocomplete: (p) => `Accept ${p}`,
  tab: "Tab",
  spellFindingsFrom: (p) => `Spell ${p}`,
  addDictionary: "Add",
  noMatches: "No matches",
  clearFilters: "Clear",
  lamp: {
    untranslated: "U",
    draft: "D",
    confirmed: "C",
    reviewed: "R",
    signed: "S",
    error: "E",
    warning: "W",
    locked: "L",
  },
  selectedCount: (count) => `${count} selected`,
  selectedHidden: (count) => `${count} hidden`,
  batchConfirm: "Confirm",
  batchClearTarget: "Clear",
  batchLock: "Lock",
  batchPretranslate: "Pretranslate",
  batchComment: "Comment",
  batchCancel: "Cancel",
  batchConfirmDestructive: "Sure?",
  qaRegion: "QA",
  qaLocate: "Locate",
  qaIgnore: "Ignore",
  tagPaired: "Paired",
  tagMissing: "Missing",
  tagOrder: "Order",
  splitSegment: "Split",
  mergeNext: "Merge",
  correctSource: "Correct",
  openChinese: "Chinese",
  openReview: "Review",
  copyTags: "Copy tags",
  insertTag: "Insert tag",
  insertTagPair: "Insert pair",
};

describe("SegmentGrid", () => {
  it("exposes role=grid, one tab stop, and batch bar when multi-selected", () => {
    const gridRef = createRef<HTMLDivElement>();
    const rows = [row("a", 0), row("b", 1), row("c", 2, { isSelected: false })];
    render(
      <SegmentGrid
        rows={rows}
        total={3}
        offset={0}
        rowHeight={112}
        loading={false}
        empty={false}
        hasFilters={false}
        activeId="a"
        labels={labels}
        gridRef={gridRef}
        onScroll={() => undefined}
        onActivate={vi.fn()}
        onTargetFocus={vi.fn()}
        onDraftChange={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onTargetKeyDown={vi.fn()}
        onSelectTargetTag={vi.fn()}
        onMoveTargetTag={vi.fn()}
        onBestMatch={vi.fn()}
        onOpenComments={vi.fn()}
        onMoreAction={vi.fn()}
        onAcceptAutocomplete={vi.fn()}
        onAddDictionary={vi.fn()}
        onLocateFinding={vi.fn()}
        onIgnoreFinding={vi.fn()}
        onClearFilters={vi.fn()}
        onBatchAction={vi.fn()}
        batchActions={[
          {
            id: "confirm",
            label: labels.batchConfirm,
            enabled: true,
          },
          {
            id: "cancel",
            label: labels.batchCancel,
            enabled: true,
          },
        ]}
        renderAxis={() => <span data-testid="axis">axis</span>}
        renderSource={(r) => <span>{r.sourceText}</span>}
        selectedIds={new Set(["a", "b"])}
        anchorId="a"
        onSelectionChange={vi.fn()}
      />,
    );

    const grid = screen.getByRole("grid", { name: "Segments" });
    expect(grid).toBeTruthy();
    expect(grid.getAttribute("tabindex")).toBe("0");
    expect(document.querySelector("[data-batch-bar]")).toBeTruthy();
    expect(screen.getByText("ID")).toBeTruthy();
    // Single axis for multi-select anchor only.
    expect(screen.getAllByTestId("axis")).toHaveLength(1);
  });

  it("does not show batch bar for a single selection", () => {
    const gridRef = createRef<HTMLDivElement>();
    const { container } = render(
      <SegmentGrid
        rows={[row("a", 0, { isSelected: true })]}
        total={1}
        offset={0}
        rowHeight={112}
        loading={false}
        empty={false}
        hasFilters={false}
        activeId="a"
        labels={labels}
        gridRef={gridRef}
        onScroll={() => undefined}
        onActivate={vi.fn()}
        onTargetFocus={vi.fn()}
        onDraftChange={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onTargetKeyDown={vi.fn()}
        onSelectTargetTag={vi.fn()}
        onMoveTargetTag={vi.fn()}
        onBestMatch={vi.fn()}
        onOpenComments={vi.fn()}
        onMoreAction={vi.fn()}
        onAcceptAutocomplete={vi.fn()}
        onAddDictionary={vi.fn()}
        onLocateFinding={vi.fn()}
        onIgnoreFinding={vi.fn()}
        onClearFilters={vi.fn()}
        onBatchAction={vi.fn()}
        batchActions={[]}
        renderAxis={() => null}
        renderSource={(r) => <span>{r.sourceText}</span>}
        selectedIds={new Set(["a"])}
        anchorId="a"
        onSelectionChange={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-batch-bar]")).toBeNull();
  });
});
