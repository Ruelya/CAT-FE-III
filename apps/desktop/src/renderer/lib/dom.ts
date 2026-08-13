import type { CSSProperties } from "react";

/**
 * Runtime geometry helpers.
 *
 * Layout constants belong in CSS. These helpers exist for the two cases that
 * genuinely cannot: a stagger index and a proportion derived from Engine
 * counts. Centralising them keeps the number of inline-style sites small and
 * reviewable; `pnpm ui:audit` rule R5 requires the data-geometry marker at
 * every remaining site.
 */

/** Motion class M6 caps the entrance stagger at the first eight rows. */
export const MAX_STAGGERED_ROWS = 8;

/**
 * Props for a list row that should animate in on first mount.
 * Rows past the cap render immediately, so a long list never waits.
 */
export function rowEnterProps(index: number): {
  className: string;
  style?: CSSProperties;
} {
  if (index >= MAX_STAGGERED_ROWS) return { className: "" };
  return {
    className: "row-enter",
    // data-geometry: the stagger index is per-row and only known at runtime.
    style: { "--enter-index": index } as CSSProperties,
  };
}

/** Merge a base class with the entrance props a list row needs. */
export function withListClass(
  baseClass: string,
  enter: { className: string; style?: CSSProperties },
): { className: string; style?: CSSProperties } {
  const className = enter.className
    ? `${baseClass} ${enter.className}`
    : baseClass;
  return enter.style ? { className, style: enter.style } : { className };
}

/** Flex basis for one share of a proportional bar, clamped to [0, 100]. */
export function shareStyle(part: number, total: number): CSSProperties {
  const ratio = total > 0 ? Math.min(Math.max(part / total, 0), 1) : 0;
  // data-geometry: the share comes from Engine counts, not from the design.
  return { flexBasis: `${ratio * 100}%` };
}
