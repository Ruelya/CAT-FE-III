import { describe, expect, it } from "vitest";

import {
  documentDisplayName,
  formatBasisPoints,
  formatDurationMs,
  presentOptionalMetric,
  progressRows,
  trendRows,
} from "./analytics-view";

describe("analytics-view", () => {
  it("formats basis points", () => {
    expect(formatBasisPoints(5000)).toBe("50%");
    expect(formatBasisPoints(3333)).toBe("33.3%");
  });

  it("formats durations", () => {
    expect(formatDurationMs(500)).toBe("500 ms");
    expect(formatDurationMs(2500)).toBe("2.5 s");
    expect(formatDurationMs(120000)).toBe("2 min");
  });

  it("does not zero unavailable metrics", () => {
    expect(
      presentOptionalMetric({ available: false, reason: "no activity" }),
    ).toEqual({ kind: "unavailable", reason: "no activity" });
    expect(presentOptionalMetric({ available: true, value: 12 })).toEqual({
      kind: "value",
      value: "12",
    });
  });

  it("maps progress and trend rows", () => {
    const rows = progressRows({
      completionBasisPoints: 1000,
      confirmedSegments: 1,
      draftSegments: 2,
      qaBlockers: 0,
      reviewedSegments: 0,
      totalSegments: 5,
      untranslatedSegments: 2,
      workflowReview: 0,
      workflowSigned: 0,
      workflowTranslation: 5,
    });
    expect(rows[0]?.value).toBe("10%");
    expect(rows.some((r) => r.label === "QA blockers")).toBe(true);

    const trends = trendRows([
      {
        startMs: 0,
        endMs: 1000,
        confirmations: 2,
        targetEdits: 1,
        qaRunsCompleted: 0,
        workflowTransitions: 0,
        termsAdded: 0,
        tmUnitsAdded: 0,
      },
    ]);
    expect(trends).toHaveLength(1);
    expect(trends[0]?.maxActivity).toBe(2);
  });

  it("joins document names when present", () => {
    expect(documentDisplayName("d1", [{ id: "d1", name: "Intro" }])).toBe(
      "Intro",
    );
    expect(documentDisplayName("missing", [])).toBe("missing");
  });
});
