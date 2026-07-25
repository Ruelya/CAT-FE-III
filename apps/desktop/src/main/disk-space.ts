import { statfs } from "node:fs/promises";
import { dirname } from "node:path";

/** Best-effort free-space probe; returns null when unavailable. */
export async function freeDiskSpace(path: string): Promise<number | null> {
  const candidates = [path, dirname(path)];
  for (const candidate of candidates) {
    try {
      const info = await statfs(candidate);
      const free = Number(info.bavail) * Number(info.bsize);
      if (Number.isFinite(free) && free >= 0) return free;
    } catch {
      // try parent
    }
  }
  return null;
}
