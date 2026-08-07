import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentRow } from "./SegmentRow";
import type { SegmentGridLabels, SegmentRowView } from "./segmentTypes";

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
  qaRegion: "Inline QA",
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

function baseRow(overrides: Partial<SegmentRowView> = {}): SegmentRowView {
  return {
    segmentId: "seg-1",
    ordinal: 0,
    sourceText: "Hello",
    targetDraft: "你好",
    segmentState: "draft",
    workflowState: "translation",
    lampState: "draft",
    isActive: true,
    isSelected: true,
    isAnchor: true,
    isFlash: false,
    isSigned: false,
    isEditable: true,
    mergeEligible: false,
    openCommentCount: 1,
    sourceTags: [],
    targetTags: [],
    selectedTargetTagId: null,
    findings: [
      {
        id: "issue-1",
        code: "num_mismatch",
        message: "Number mismatch",
        severity: "error",
        source: "qa",
        canLocate: true,
        canIgnore: true,
      },
    ],
    autocomplete: null,
    spellFindings: [],
    ariaInvalid: true,
    ...overrides,
  };
}

describe("SegmentRow", () => {
  it("renders lamp, action rail hooks, QA strip, and draft change callback", () => {
    const onDraftChange = vi.fn();
    const onLocateFinding = vi.fn();
    const onIgnoreFinding = vi.fn();
    const onRowClick = vi.fn();

    render(
      <SegmentRow
        row={baseRow()}
        labels={labels}
        showAxis
        axis={<span data-testid="axis">axis</span>}
        sourceContent={<span>Hello</span>}
        onRowClick={onRowClick}
        onTargetFocus={vi.fn()}
        onDraftChange={onDraftChange}
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
        onLocateFinding={onLocateFinding}
        onIgnoreFinding={onIgnoreFinding}
      />,
    );

    expect(screen.getByLabelText("D")).toBeTruthy();
    expect(screen.getByTestId("axis")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Inline QA" })).toBeTruthy();
    expect(screen.getByText("Number mismatch")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Locate" }));
    expect(onLocateFinding).toHaveBeenCalledWith("seg-1", "issue-1");

    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(onIgnoreFinding).toHaveBeenCalledWith("seg-1", "issue-1");

    const editor = screen.getByLabelText("Target 1");
    fireEvent.change(editor, { target: { value: "你好世界" } });
    expect(onDraftChange).toHaveBeenCalledWith("seg-1", "你好世界");
  });
});
