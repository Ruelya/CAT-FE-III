import { describe, expect, it } from "vitest";
import type { TmLibrary } from "@translunar/contracts";

import {
  applyButtonLabel,
  basenameFromPath,
  canApplySelection,
  eligibleReviewRowIds,
  eligibleTableRowIds,
  filterWritableMatchingLibraries,
  initialSelectionFromEligible,
  isTerminalPreviewStatus,
  toggleIdInSet,
} from "./interop-view";

function lib(
  id: string,
  sourceLocale: string,
  targetLocale: string,
  writable: boolean,
): TmLibrary {
  return {
    id,
    name: id,
    sourceLocale,
    targetLocale,
    writable,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

describe("interop-view pure helpers", () => {
  it("filters eligible review/table rows by Engine dispositions", () => {
    expect(
      eligibleReviewRowIds([
        { rowId: "1", disposition: "changed" },
        { rowId: "2", disposition: "unchanged" },
        { rowId: "3", disposition: "invalid" },
      ]),
    ).toEqual(["1"]);
    expect(
      eligibleTableRowIds([
        { rowId: "a", disposition: "valid" },
        { rowId: "b", disposition: "duplicate" },
        { rowId: "c", disposition: "invalid" },
      ]),
    ).toEqual(["a"]);
  });

  it("gates apply on selection and terminal status", () => {
    expect(isTerminalPreviewStatus("open")).toBe(false);
    expect(isTerminalPreviewStatus("applied")).toBe(true);
    expect(canApplySelection(new Set(["1"]), "open")).toBe(true);
    expect(canApplySelection(new Set(), "open")).toBe(false);
    expect(canApplySelection(new Set(["1"]), "applied")).toBe(false);
    expect(applyButtonLabel("applied", 0)).toBe("Applied");
    expect(applyButtonLabel("open", 2)).toBe("Apply 2");
  });

  it("filters writable locale-matching libraries", () => {
    const libraries = [
      lib("ok", "en", "zh", true),
      lib("ro", "en", "zh", false),
      lib("locale", "en-US", "zh", true),
      lib("match-case", "EN", "ZH", true),
    ];
    expect(
      filterWritableMatchingLibraries(libraries, "en", "zh").map((l) => l.id),
    ).toEqual(["ok", "match-case"]);
  });

  it("manages selection sets and path basenames", () => {
    const initial = initialSelectionFromEligible(["a", "b"]);
    expect([...initial].sort()).toEqual(["a", "b"]);
    const toggled = toggleIdInSet(initial, "a", false);
    expect(toggled.has("a")).toBe(false);
    expect(toggled.has("b")).toBe(true);
    expect(basenameFromPath("C:\\\\tmp\\\\review.docx")).toBe("review.docx");
    expect(basenameFromPath("/tmp/table.xlsx")).toBe("table.xlsx");
    expect(basenameFromPath(null)).toBe("");
  });
});
