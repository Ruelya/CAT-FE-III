import type {
  AiBatchItem,
  AiUsageAggregate,
  EngineConnectorSource,
} from "@translunar/contracts";

import type { MatrixCellState } from "../quality/qa-presenters";

/** Stable tab ids (i18n carries design labels). */
export const AI_CONTROL_TABS = ["providers", "batch", "usage"] as const;
export type AiControlTabId = (typeof AI_CONTROL_TABS)[number];

export function isAiControlTabId(value: string): value is AiControlTabId {
  return (AI_CONTROL_TABS as readonly string[]).includes(value);
}

/** Sum all token fields on an aggregate row. */
export function aggregateTokenTotal(row: AiUsageAggregate): number {
  return (
    row.inputTokens +
    row.outputTokens +
    row.cacheReadTokens +
    row.cacheWriteTokens +
    row.reasoningTokens
  );
}

export function sumUsageTokens(usage: readonly AiUsageAggregate[]): number {
  return usage.reduce((sum, row) => sum + aggregateTokenTotal(row), 0);
}

/**
 * Budget consumption ratio when both budget and usage are known.
 * Returns null when budget is unset / non-positive (do not gate).
 */
export function budgetRatio(
  monthlyTokenBudget: number | null | undefined,
  usedTokens: number,
): number | null {
  if (
    monthlyTokenBudget === null ||
    monthlyTokenBudget === undefined ||
    !Number.isFinite(monthlyTokenBudget) ||
    monthlyTokenBudget <= 0
  ) {
    return null;
  }
  if (!Number.isFinite(usedTokens) || usedTokens < 0) return 0;
  return usedTokens / monthlyTokenBudget;
}

export type BudgetGate = "ok" | "warn" | "block";

/** ≥80% warn; ≥100% block new batch start. */
export function budgetGateFromRatio(ratio: number | null): BudgetGate {
  if (ratio === null) return "ok";
  if (ratio >= 1) return "block";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

export interface UsageStackSlice {
  key: string;
  tokens: number;
  fraction: number;
}

/**
 * Horizontal stack fractions by provider from real aggregates only.
 * Empty when no positive token totals.
 */
export function usageStackFractions(
  usage: readonly AiUsageAggregate[],
): UsageStackSlice[] {
  const rows = usage
    .map((row) => ({ key: row.key, tokens: aggregateTokenTotal(row) }))
    .filter((row) => row.tokens > 0);
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  if (total <= 0) return [];
  return rows.map((row) => ({
    key: row.key,
    tokens: row.tokens,
    fraction: row.tokens / total,
  }));
}

export function connectorKindLabelKey(
  source: EngineConnectorSource,
): "ai.connectorBuiltin" | "ai.connectorPlugin" {
  return source.kind === "plugin" ? "ai.connectorPlugin" : "ai.connectorBuiltin";
}

export function connectorSourceLabel(source: EngineConnectorSource): string {
  return source.kind === "builtin"
    ? source.provider
    : `${source.owner.pluginId}@${source.owner.versionId}:${source.contributionId}/v${source.contractVersion}`;
}

/** Map batch item statuses to Live Matrix cells (real statuses only). */
export function batchItemMatrixStates(
  items: readonly AiBatchItem[],
  options?: { maxCells?: number },
): MatrixCellState[] {
  const maxCells = options?.maxCells ?? 2_000;
  const capped = items.slice(0, maxCells);
  return capped.map((item) => {
    switch (item.status) {
      case "failed":
        return "error";
      case "succeeded":
      case "tmApplied":
        return "none";
      case "skipped":
      case "canceled":
        return "waived";
      case "running":
      case "pending":
      case "retrying":
        return "warn";
      default:
        return "warn";
    }
  });
}

export function isBatchTerminal(status: string): boolean {
  return (
    status === "succeeded" ||
    status === "completedWithErrors" ||
    status === "failed" ||
    status === "canceled"
  );
}

export function isRunTerminal(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export function startOfMonth(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export function formatDurationMs(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}
