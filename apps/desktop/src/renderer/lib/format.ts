/**
 * Presentation-only formatting helpers.
 *
 * These never round or reinterpret Engine data; they only choose how an
 * already-authoritative value is rendered. Absolute values stay available in a
 * `title` wherever a relative form is shown.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Coarse relative time for list metadata. Deliberately low resolution: a
 * project list does not need seconds, and a stable string avoids a value that
 * changes on every render.
 */
export function formatRelativeTime(
  timestampMs: number,
  nowMs: number = Date.now(),
): string {
  if (!Number.isFinite(timestampMs)) return "-";
  const elapsed = nowMs - timestampMs;
  if (elapsed < 0) return "just now";
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes}m ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours}h ago`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return `${days}d ago`;
  return new Date(timestampMs).toISOString().slice(0, 10);
}

/** Byte count in the unit a desktop user expects, with one decimal above KB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Integer percentage from a part and a whole, safe at zero. */
export function formatPercent(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return "0%";
  }
  return `${Math.round((part / total) * 100)}%`;
}
