import { describe, expect, it } from "vitest";

import { segmentContextActions } from "./segment-context-menu";

describe("segmentContextActions", () => {
  it("keeps Confirm visible and disables Cut off the target", () => {
    const items = segmentContextActions({
      field: "source",
      hasSourceSelection: true,
      hasTargetSelection: false,
      canStoreTerm: false,
      canInsertTerm: true,
      canConfirm: true,
      targetHasText: true,
      canCopySource: true,
    });
    const cut = items.find((item) => "label" in item && item.id === "cut");
    const confirm = items.find((item) => "label" in item && item.id === "confirm");
    expect(cut && "disabled" in cut && cut.disabled).toBe(true);
    expect(confirm && "disabled" in confirm && confirm.disabled).toBe(false);
  });

  it("enables Add term only when both sides are selected", () => {
    const items = segmentContextActions({
      field: "target",
      hasSourceSelection: true,
      hasTargetSelection: true,
      canStoreTerm: true,
      canInsertTerm: false,
      canConfirm: false,
      targetHasText: true,
      canCopySource: true,
    });
    const add = items.find((item) => "id" in item && item.id === "addTerm");
    expect(add && "disabled" in add && add.disabled).toBe(false);
  });

  it("keeps Split and Merge visible but disabled until the editor allows them", () => {
    const items = segmentContextActions({
      field: "row",
      hasSourceSelection: false,
      hasTargetSelection: false,
      canStoreTerm: false,
      canInsertTerm: false,
      canConfirm: true,
      targetHasText: false,
      canCopySource: true,
      canSplit: true,
      canMerge: false,
      canComment: true,
    });
    const split = items.find((item) => "id" in item && item.id === "split");
    const merge = items.find((item) => "id" in item && item.id === "merge");
    expect(split && "disabled" in split && split.disabled).toBe(false);
    expect(merge && "disabled" in merge && merge.disabled).toBe(true);
  });

  it("exposes QuickPlace and lock next to Confirm", () => {
    const items = segmentContextActions({
      field: "target",
      hasSourceSelection: false,
      hasTargetSelection: false,
      canStoreTerm: false,
      canInsertTerm: false,
      canConfirm: true,
      targetHasText: true,
      canCopySource: true,
      canLock: true,
    });
    const ids = items.filter((item) => "label" in item).map((item) => item.id);
    expect(ids).toContain("quickPlace");
    expect(ids).toContain("lock");
    expect(ids).toContain("confirm");
  });

  it("exposes workflow status changes and Go to", () => {
    const items = segmentContextActions({
      field: "target",
      hasSourceSelection: false,
      hasTargetSelection: false,
      canStoreTerm: false,
      canInsertTerm: false,
      canConfirm: true,
      targetHasText: true,
      canCopySource: true,
      canLock: true,
      canSetWorkflow: true,
      workflowState: "translation",
    });
    const ids = items.filter((item) => "label" in item).map((item) => item.id);
    expect(ids).toContain("statusTranslation");
    expect(ids).toContain("statusReview");
    expect(ids).toContain("goTo");
    const translation = items.find(
      (item) => "label" in item && item.id === "statusTranslation",
    );
    expect(
      translation && "disabled" in translation && translation.disabled,
    ).toBe(true);
  });
});
