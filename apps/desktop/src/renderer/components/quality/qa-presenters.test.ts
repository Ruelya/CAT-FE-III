import { describe, expect, it } from "vitest";
import type { QaIssueView } from "@translunar/contracts";

import {
  buildSeverityMatrix,
  countSeverities,
  groupIssuesBySeverity,
  nextOpenIssueId,
  ruleDisplayName,
  sliceWithSpans,
} from "./qa-presenters";

function issue(
  partial: Partial<QaIssueView> &
    Pick<QaIssueView, "id" | "severity" | "segmentOrdinal">,
): QaIssueView {
  return {
    category: "numbers",
    createdAtMs: 0,
    disposition: "open",
    documentId: "d1",
    documentName: "doc.docx",
    evidence: {},
    fingerprint: "fp",
    message: "Number mismatch",
    projectId: "p1",
    ruleId: "qa.number-mismatch",
    segmentId: `seg-${partial.segmentOrdinal}`,
    updatedAtMs: 0,
    ...partial,
  };
}

describe("buildSeverityMatrix", () => {
  it("maps max open severity and waived-only cells", () => {
    const issues = [
      issue({ id: "1", severity: "warning", segmentOrdinal: 0 }),
      issue({ id: "2", severity: "error", segmentOrdinal: 1 }),
      issue({
        id: "3",
        severity: "error",
        segmentOrdinal: 2,
        disposition: "waived",
      }),
    ];
    expect(buildSeverityMatrix(4, issues)).toEqual([
      "warn",
      "error",
      "waived",
      "none",
    ]);
  });

  it("caps cell count", () => {
    const matrix = buildSeverityMatrix(10_000, [], { maxCells: 8 });
    expect(matrix).toHaveLength(8);
  });
});

describe("countSeverities", () => {
  it("counts open and waived separately", () => {
    const issues = [
      issue({ id: "1", severity: "error", segmentOrdinal: 0 }),
      issue({ id: "2", severity: "warning", segmentOrdinal: 1 }),
      issue({ id: "3", severity: "info", segmentOrdinal: 2 }),
      issue({
        id: "4",
        severity: "error",
        segmentOrdinal: 3,
        disposition: "waived",
      }),
    ];
    expect(countSeverities(issues)).toEqual({
      error: 1,
      warning: 1,
      info: 1,
      waived: 1,
    });
  });
});

describe("groupIssuesBySeverity", () => {
  it("orders error before warning before info", () => {
    const issues = [
      issue({ id: "i", severity: "info", segmentOrdinal: 0 }),
      issue({ id: "e", severity: "error", segmentOrdinal: 1 }),
      issue({ id: "w", severity: "warning", segmentOrdinal: 2 }),
    ];
    const groups = groupIssuesBySeverity(issues);
    expect(groups.map((g) => g.severity)).toEqual([
      "error",
      "warning",
      "info",
    ]);
    expect(groups[0]!.issues[0]!.id).toBe("e");
  });
});

describe("sliceWithSpans", () => {
  it("highlights span ranges", () => {
    const slices = sliceWithSpans("hello world", [
      { start: 6, end: 11 },
      { start: 0, end: 5 },
    ]);
    expect(slices).toEqual([
      { text: "hello", hit: true },
      { text: " ", hit: false },
      { text: "world", hit: true },
    ]);
  });

  it("returns whole text when no spans", () => {
    expect(sliceWithSpans("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });
});

describe("ruleDisplayName", () => {
  it("prefers category label over raw rule id", () => {
    expect(
      ruleDisplayName(
        {
          ruleId: "qa.tag-tag_missing",
          category: "tags",
          message: "Missing tag",
        },
        "Tag integrity",
      ),
    ).toBe("Tag integrity");
  });
});

describe("nextOpenIssueId", () => {
  it("advances to next open issue", () => {
    const issues = [
      issue({ id: "a", severity: "error", segmentOrdinal: 0 }),
      issue({
        id: "b",
        severity: "error",
        segmentOrdinal: 1,
        disposition: "waived",
      }),
      issue({ id: "c", severity: "warning", segmentOrdinal: 2 }),
    ];
    expect(nextOpenIssueId(issues, "a")).toBe("c");
    expect(nextOpenIssueId(issues, "c")).toBe("a");
  });
});
