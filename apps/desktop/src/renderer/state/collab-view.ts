import type { CollabOpLogEntry } from "@translunar/contracts";

export function canAcquireLock(input: {
  projectId: string | null | undefined;
  documentId: string | null | undefined;
  segmentId: string | null | undefined;
}): boolean {
  return Boolean(
    input.projectId &&
      input.documentId &&
      input.segmentId &&
      input.projectId.length > 0 &&
      input.documentId.length > 0 &&
      input.segmentId.length > 0,
  );
}

export function canCreateAssignment(input: {
  projectId: string;
  documentId: string | null | undefined;
  assigneeActorId: string;
  ordinalStart: number;
  ordinalEnd: number;
}): boolean {
  if (!input.projectId || !input.documentId) return false;
  if (input.assigneeActorId.trim().length === 0) return false;
  if (!Number.isFinite(input.ordinalStart) || !Number.isFinite(input.ordinalEnd)) {
    return false;
  }
  return input.ordinalEnd >= input.ordinalStart;
}

/**
 * Load more advances from the maximum sequence in the Engine-returned page.
 * Empty/non-advancing pages stop paging.
 */
export function nextOpLogAfterSequence(
  currentAfter: number,
  items: CollabOpLogEntry[],
): { nextAfter: number; canLoadMore: boolean } {
  if (items.length === 0) {
    return { nextAfter: currentAfter, canLoadMore: false };
  }
  let max = currentAfter;
  for (const item of items) {
    if (item.sequence > max) max = item.sequence;
  }
  if (max <= currentAfter) {
    return { nextAfter: currentAfter, canLoadMore: false };
  }
  return { nextAfter: max, canLoadMore: true };
}

/** Schedule next heartbeat before half the TTL, floored at 1s, capped at 30s. */
export function nextHeartbeatDelayMs(
  ttlMs: number,
  nowMs = Date.now(),
  expiresAtMs?: number | null,
): number {
  const remaining =
    typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)
      ? Math.max(0, expiresAtMs - nowMs)
      : ttlMs;
  const half = Math.floor(remaining / 2);
  return Math.min(30_000, Math.max(1000, half || Math.floor(ttlMs / 2) || 1000));
}

export function formatLocalCollabLabel(): string {
  return "Local collaboration";
}

export function inspectOpPayload(payload: unknown, maxLen = 800): string | null {
  if (payload === null || payload === undefined) return null;
  try {
    const text = JSON.stringify(payload);
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}…`;
  } catch {
    return null;
  }
}
