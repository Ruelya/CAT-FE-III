import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatPercent,
  formatRelativeTime,
  segmentNumber,
} from "./format";

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 7, 12, 12, 0, 0);

  it("reports recent activity coarsely", () => {
    expect(formatRelativeTime(now, now)).toBe("just now");
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
  });

  it("falls back to an absolute date beyond a month", () => {
    expect(formatRelativeTime(now - 90 * 86_400_000, now)).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("does not render a future timestamp as negative", () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe("just now");
  });

  it("handles a non-finite input without throwing", () => {
    expect(formatRelativeTime(Number.NaN, now)).toBe("-");
  });
});

describe("formatBytes", () => {
  it("uses the unit a desktop user expects", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(7_782_072)).toBe("7.4 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("drops the decimal above 100 in a unit", () => {
    expect(formatBytes(150 * 1024)).toBe("150 KB");
  });

  it("rejects a negative or non-finite size", () => {
    expect(formatBytes(-1)).toBe("-");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent and is safe at zero", () => {
    expect(formatPercent(1, 3)).toBe("33%");
    expect(formatPercent(0, 0)).toBe("0%");
    expect(formatPercent(5, 5)).toBe("100%");
  });
});

describe("segmentNumber", () => {
  it("presents zero-based Engine ordinals as one-based", () => {
    // The Engine's own QA report renders segment_ordinal + 1, so the renderer
    // must match rather than expose the internal base.
    expect(segmentNumber(0)).toBe(1);
    expect(segmentNumber(41)).toBe(42);
  });

  it("is defensive about a non-finite ordinal", () => {
    expect(segmentNumber(Number.NaN)).toBe(0);
  });
});
