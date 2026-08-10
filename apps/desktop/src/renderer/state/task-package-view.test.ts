import { describe, expect, it } from "vitest";

import {
  canDiscardOrImport,
  canExportAssignment,
  canExportReturn,
  canMutateTaskPreview,
  isSafeSelectableRow,
  isTerminalTaskPreviewStatus,
  mergePageSelection,
  taskApplyLabel,
} from "./task-package-view";

describe("task-package-view pure helpers", () => {
  it("selects only safe rows", () => {
    expect(isSafeSelectableRow({ safeToApply: true })).toBe(true);
    expect(isSafeSelectableRow({ safeToApply: false })).toBe(false);
    expect(isSafeSelectableRow({})).toBe(false);
  });

  it("merges page selection without dropping other pages", () => {
    const current = new Set(["p1-a", "p1-b", "p2-x"]);
    const pageIds = ["p1-a", "p1-b", "p1-c"];
    const selectedOnPage = new Set(["p1-a", "p1-c"]);
    const next = mergePageSelection(current, pageIds, selectedOnPage);
    expect([...next].sort()).toEqual(["p1-a", "p1-c", "p2-x"]);
  });

  it("gates export and mutation controls", () => {
    expect(
      canExportAssignment({
        hasDocuments: true,
        actor: "a",
        reason: "r",
        pending: false,
      }),
    ).toBe(true);
    expect(
      canExportAssignment({
        hasDocuments: false,
        actor: "a",
        reason: "r",
        pending: false,
      }),
    ).toBe(false);
    expect(
      canExportReturn({
        hasTaskPackageRef: true,
        actor: "a",
        reason: "r",
        pending: false,
      }),
    ).toBe(true);
    expect(
      canExportReturn({
        hasTaskPackageRef: false,
        actor: "a",
        reason: "r",
        pending: false,
      }),
    ).toBe(false);
    expect(isTerminalTaskPreviewStatus("open")).toBe(false);
    expect(isTerminalTaskPreviewStatus("applied")).toBe(true);
    expect(
      canMutateTaskPreview({
        status: "open",
        actor: "a",
        reason: "r",
        pending: false,
        selectedCount: 2,
      }),
    ).toBe(true);
    expect(
      canMutateTaskPreview({
        status: "open",
        actor: "a",
        reason: "r",
        pending: false,
        selectedCount: 0,
      }),
    ).toBe(false);
    expect(
      canMutateTaskPreview({
        status: "applied",
        actor: "a",
        reason: "r",
        pending: false,
        selectedCount: 2,
      }),
    ).toBe(false);
    expect(
      canDiscardOrImport({
        status: "open",
        actor: "a",
        reason: "r",
        pending: false,
        hasPreview: true,
      }),
    ).toBe(true);
    expect(taskApplyLabel("applied", 0)).toBe("Applied");
    expect(taskApplyLabel("open", 3)).toBe("Apply 3");
  });
});
