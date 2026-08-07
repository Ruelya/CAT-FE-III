import { describe, expect, it } from "vitest";
import type { AiBatchItem, AiUsageAggregate } from "@translunar/contracts";

import {
  aggregateTokenTotal,
  batchItemMatrixStates,
  budgetGateFromRatio,
  budgetRatio,
  isAiControlTabId,
  sumUsageTokens,
  usageStackFractions,
} from "./ai-presenters";

function usage(
  key: string,
  partial: Partial<AiUsageAggregate> = {},
): AiUsageAggregate {
  return {
    key,
    requestCount: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    elapsedMs: 0,
    ...partial,
  };
}

describe("ai-presenters budget", () => {
  it("returns null ratio when budget unset", () => {
    expect(budgetRatio(null, 100)).toBeNull();
    expect(budgetRatio(undefined, 100)).toBeNull();
    expect(budgetRatio(0, 100)).toBeNull();
  });

  it("computes ratio and gate thresholds", () => {
    expect(budgetRatio(1000, 400)).toBe(0.4);
    expect(budgetGateFromRatio(0.4)).toBe("ok");
    expect(budgetGateFromRatio(0.8)).toBe("warn");
    expect(budgetGateFromRatio(1)).toBe("block");
    expect(budgetGateFromRatio(null)).toBe("ok");
  });
});

describe("ai-presenters usage stack", () => {
  it("builds fractions from real token totals only", () => {
    const rows = [
      usage("a", { inputTokens: 70 }),
      usage("b", { outputTokens: 30 }),
      usage("empty"),
    ];
    expect(sumUsageTokens(rows)).toBe(100);
    expect(aggregateTokenTotal(rows[0]!)).toBe(70);
    const stack = usageStackFractions(rows);
    expect(stack).toHaveLength(2);
    expect(stack[0]).toMatchObject({ key: "a", fraction: 0.7 });
    expect(stack[1]).toMatchObject({ key: "b", fraction: 0.3 });
  });

  it("returns empty stack when no tokens", () => {
    expect(usageStackFractions([usage("x")])).toEqual([]);
  });
});

describe("ai-presenters tabs and batch matrix", () => {
  it("validates tab ids", () => {
    expect(isAiControlTabId("providers")).toBe(true);
    expect(isAiControlTabId("batch")).toBe(true);
    expect(isAiControlTabId("usage")).toBe(true);
    expect(isAiControlTabId("other")).toBe(false);
  });

  it("maps batch item statuses without inventing cells", () => {
    const items = [
      { status: "failed" },
      { status: "succeeded" },
      { status: "skipped" },
      { status: "pending" },
    ] as AiBatchItem[];
    expect(batchItemMatrixStates(items)).toEqual([
      "error",
      "none",
      "waived",
      "warn",
    ]);
  });
});
