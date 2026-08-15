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
});
