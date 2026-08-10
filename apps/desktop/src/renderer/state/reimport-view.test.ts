import { describe, expect, it } from "vitest";
import type { ReimportMatch } from "@translunar/contracts";

import {
  canConfirmReimportApply,
  countByDisposition,
  reimportSummaryLine,
} from "./reimport-view";

describe("reimport-view pure helpers", () => {
  it("summarizes plan and gates apply", () => {
    expect(
      reimportSummaryLine({
        unchanged: 1,
        changed: 2,
        newSegments: 3,
        removed: 0,
        ambiguous: 1,
      }),
    ).toContain("changed 2");

    const items: ReimportMatch[] = [
      { disposition: "changed", reason: "r" },
      { disposition: "changed", reason: "r2" },
      { disposition: "ambiguous", reason: "a" },
    ];
    expect(countByDisposition(items).changed).toBe(2);
    expect(countByDisposition(items).ambiguous).toBe(1);

    expect(
      canConfirmReimportApply({
        hasPreview: true,
        pending: false,
        status: "planReady",
      }),
    ).toBe(true);
    expect(
      canConfirmReimportApply({
        hasPreview: true,
        pending: true,
        status: "planReady",
      }),
    ).toBe(false);
    expect(
      canConfirmReimportApply({
        hasPreview: false,
        pending: false,
        status: "planReady",
      }),
    ).toBe(false);
  });
});
