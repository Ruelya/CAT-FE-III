import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { expect, type Page } from "@playwright/test";

const require = createRequire(import.meta.url);
const axeCorePath = require.resolve("axe-core", {
  paths: [dirname(require.resolve("@axe-core/playwright"))],
});
const axeSource = readFileSync(axeCorePath, "utf8");

export interface AxeViolationNode {
  id: string;
  impact: string | null;
  help: string;
  target: string;
}

/**
 * Wait until nothing is animating.
 *
 * A contrast or geometry assertion taken mid-animation measures an
 * intermediate frame, not the state the user reads. Settling first makes the
 * audit deterministic instead of racing the transition.
 */
export async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const running = document.getAnimations().filter((animation) => {
      if (animation.playState !== "running") return false;
      // An infinite animation never settles, so awaiting it hangs forever.
      // The skeleton shimmer and the button spinner are both infinite, and
      // neither moves layout nor affects the contrast of any text.
      const timing = animation.effect?.getComputedTiming();
      return Number.isFinite(timing?.iterations ?? Number.POSITIVE_INFINITY);
    });
    // A hard ceiling as well: a settle helper must never hang a whole run.
    await Promise.race([
      Promise.all(
        running.map((animation) => animation.finished.catch(() => undefined)),
      ),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  });
}

/**
 * Run axe over the settled page and return every violation node, flattened.
 *
 * Electron's CSP blocks script tags and the @axe-core/playwright injection
 * path, so axe is evaluated through CDP instead.
 */
export async function runAxe(page: Page): Promise<AxeViolationNode[]> {
  await waitForAnimations(page);
  await page.evaluate((source: string) => {
    const indirectEval: (code: string) => unknown = eval;
    indirectEval(source);
  }, axeSource);

  const results = await page.evaluate(async () => {
    const axe = (
      globalThis as unknown as {
        axe: {
          run: () => Promise<{
            violations: Array<{
              id: string;
              impact?: string | null;
              help: string;
              nodes: Array<{ target: unknown[] }>;
            }>;
          }>;
        };
      }
    ).axe;
    const run = await axe.run();
    return run.violations.flatMap((violation) =>
      violation.nodes.map((node) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        target: node.target.map(String).join(" "),
      })),
    );
  });

  return results;
}

/**
 * Accessibility findings that are known, owned, and deliberately not fixed in
 * the current change. Every entry needs a rule id, a reason, and an owner so a
 * baseline can never quietly become a permanent excuse.
 */
export const AXE_BASELINE: ReadonlyArray<{
  id: string;
  reason: string;
  owner: string;
}> = [];

/**
 * Fail on any violation of any impact level.
 *
 * The previous helpers filtered to serious and critical only, so moderate and
 * minor findings could ship unseen. Anything that must be tolerated goes in
 * AXE_BASELINE with a named owner instead.
 */
export async function expectNoAxeViolations(
  page: Page,
  label: string,
): Promise<void> {
  const violations = await runAxe(page);
  const baselineIds = new Set(AXE_BASELINE.map((entry) => entry.id));
  const actionable = violations.filter((v) => !baselineIds.has(v.id));
  expect(
    actionable,
    `${label}: ${JSON.stringify(actionable, null, 2)}`,
  ).toEqual([]);
}
