import { describe, expect, it } from "vitest";

import {
  deriveLampState,
  mapFindings,
  mapSourceTags,
  mapTargetTags,
} from "./segmentTypes";
import type { InlineTag } from "@translunar/contracts";

describe("deriveLampState", () => {
  it("follows precedence error > warning > locked > signed > reviewed > confirmed > draft > untranslated", () => {
    expect(
      deriveLampState({
        segmentState: "draft",
        workflowState: "signed",
        openIssue: { severity: "error", status: "open" },
      }),
    ).toBe("error");
    expect(
      deriveLampState({
        segmentState: "confirmed",
        workflowState: "translation",
        openIssue: { severity: "warning", status: "open" },
      }),
    ).toBe("warning");
    expect(
      deriveLampState({
        segmentState: "confirmed",
        workflowState: "translation",
        locked: true,
      }),
    ).toBe("locked");
    expect(
      deriveLampState({
        segmentState: "confirmed",
        workflowState: "signed",
      }),
    ).toBe("signed");
    expect(
      deriveLampState({
        segmentState: "confirmed",
        workflowState: "review",
      }),
    ).toBe("reviewed");
    expect(
      deriveLampState({
        segmentState: "confirmed",
        workflowState: "translation",
      }),
    ).toBe("confirmed");
    expect(
      deriveLampState({
        segmentState: "draft",
        workflowState: "translation",
      }),
    ).toBe("draft");
    expect(
      deriveLampState({
        segmentState: "untranslated",
        workflowState: "translation",
      }),
    ).toBe("untranslated");
  });
});

describe("tag mapping", () => {
  const source: InlineTag = {
    id: "s1",
    displayText: "1",
    kind: "start",
    pairId: "p1",
    payload: "x",
    position: 0,
    protected: true,
    side: "source",
  };
  const target: InlineTag = {
    ...source,
    id: "t1",
    side: "target",
    position: 2,
  };

  it("marks missing source tags and order issues on target", () => {
    const missing = mapSourceTags([source], [], [
      { code: "tag_missing", message: "Missing" },
    ]);
    expect(missing[0]?.issue).toBe("missing");
    const ordered = mapTargetTags([target], [
      { code: "tag_pair_order", message: "Order", tagId: "t1" },
    ]);
    expect(ordered[0]?.issue).toBe("order");
  });

  it("maps QA and tag findings without mutation", () => {
    const findings = mapFindings(
      {
        id: "q1",
        message: "Number mismatch",
        ruleId: "num",
        severity: "error",
        status: "open",
        segmentId: "seg",
        fingerprint: "f",
        createdAtMs: 0,
        updatedAtMs: 0,
        evidence: { sourceNumbers: ["1"], targetNumbers: ["2"] },
      },
      [{ code: "tag_missing", message: "Missing tag" }],
      true,
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]?.canIgnore).toBe(true);
    expect(findings[1]?.source).toBe("tag");
  });
});
