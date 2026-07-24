import { describe, expect, it } from "vitest";

import type { CurationFinding } from "@translunar/contracts";

import {
  DEFAULT_CURATION_POLICY,
  dateInputToMs,
  engineErrorCode,
  findingIsSelectable,
  findingKindLabel,
  formatBasisPoints,
  formatEvidence,
  isRevisionConflict,
  msToDateInput,
  nextPageOffset,
  pageRangeLabel,
  previousPageOffset,
  recommendationLabel,
  severityLabel,
} from "./asset-curation-utils";

const finding: CurationFinding = {
  canonicalUnitId: null,
  createdAtMs: 1,
  disposition: "quarantine",
  evidence: {
    sourceValues: ["A source value"],
    targetValues: ["A target value"],
    relatedUnitIds: ["unit-2"],
    metrics: { ratio: 240, score: 1200 },
  },
  explanation: "Review this pair",
  fingerprint: "fingerprint",
  id: "finding-1",
  kind: "lengthRatio",
  libraryId: "library-1",
  penaltyBasisPoints: 1200,
  qualityScoreBasisPoints: 4000,
  revision: 0,
  runId: "run-1",
  severity: "warning",
  unitId: "unit-1",
  updatedAtMs: 1,
};

describe("asset curation helpers", () => {
  it("keeps Engine defaults bounded and formats scores", () => {
    expect(DEFAULT_CURATION_POLICY.minimumChars).toBe(2);
    expect(DEFAULT_CURATION_POLICY.quarantineThresholdBasisPoints).toBe(5000);
    expect(formatBasisPoints(9876)).toBe("98.8%");
    expect(formatBasisPoints(null)).toBe("Not scored");
  });

  it("formats deterministic labels and bounded evidence", () => {
    expect(findingKindLabel("lengthRatio")).toBe("Length ratio");
    expect(severityLabel("warning")).toBe("Warning");
    expect(recommendationLabel("quarantine")).toBe("Quarantine");
    expect(formatEvidence(finding.evidence)).toEqual([
      "Source: A source value",
      "Target: A target value",
      "Related unit: unit-2",
      "ratio: 240",
      "score: 1200",
    ]);
  });

  it("only enables explicit quarantine selections in an open run", () => {
    expect(findingIsSelectable(finding, "open")).toBe(true);
    expect(findingIsSelectable(finding, "applied")).toBe(false);
    expect(
      findingIsSelectable({ ...finding, disposition: "review" }, "open"),
    ).toBe(false);
  });

  it("keeps page offsets deterministic", () => {
    expect(previousPageOffset(25, 25)).toBe(0);
    expect(nextPageOffset(25, 25, 60)).toBe(50);
    expect(nextPageOffset(50, 25, 60)).toBe(50);
    expect(pageRangeLabel(25, 10, 60)).toBe("26-35 of 60");
    expect(pageRangeLabel(0, 0, 0)).toBe("0 of 0");
  });

  it("round-trips date filters and narrows typed conflict errors", () => {
    const start = dateInputToMs("2026-07-23");
    const end = dateInputToMs("2026-07-23", true);
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(msToDateInput(start)).toBe("2026-07-23");
    expect(dateInputToMs("not-a-date")).toBeNull();
    const reason: unknown = { code: "conflict", data: { actualRevision: 2 } };
    expect(engineErrorCode(reason)).toBe("conflict");
    expect(isRevisionConflict(reason)).toBe(true);
    expect(isRevisionConflict(new Error("conflict"))).toBe(false);
  });
});
