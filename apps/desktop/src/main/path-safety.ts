import { constants, lstatSync, realpathSync } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export function resolveAbsolutePath(input: string): string {
  return resolve(input);
}

/**
 * Resolve to a canonical filesystem path (sync).
 * Existing paths use realpathSync; missing tails are reattached under the
 * longest existing real ancestor (observed via lstatSync before following links).
 */
export function resolveCanonicalPath(input: string): string {
  const absolute = resolveAbsolutePath(input);
  try {
    return realpathSync(absolute);
  } catch {
    // Missing or unresolvable; walk up to a real ancestor below.
  }

  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    missing.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) {
      return absolute;
    }
    try {
      lstatSync(parent);
      const realParent = realpathSync(parent);
      return join(realParent, ...missing);
    } catch {
      current = parent;
    }
  }
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

export function isSameOrRelatedPath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return (
    left === right || isPathInside(left, right) || isPathInside(right, left)
  );
}

/** Same/ancestor/descendant check after synchronous realpath/lstat resolution. */
export function isSameOrRelatedCanonicalPath(a: string, b: string): boolean {
  return isSameOrRelatedPath(resolveCanonicalPath(a), resolveCanonicalPath(b));
}

export async function assertWritableDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await access(path, constants.W_OK);
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function pathLooksLikeWorkspace(path: string): Promise<boolean> {
  try {
    const root = resolveCanonicalPath(path);
    await access(resolve(root, "translunar.sqlite3"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Windows drive-relative forms such as `C:foo` (colon not followed by a separator). */
export function isDriveRelativePath(input: string): boolean {
  return /^[A-Za-z]:(?![\\/])/u.test(input);
}

export function validateAbsoluteCandidate(
  target: string,
  liveDirectory: string,
): { ok: true; path: string } | { ok: false; code: string; message: string } {
  const trimmed = target.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "empty_path",
      message: "A data directory path is required.",
    };
  }
  if (isDriveRelativePath(trimmed) || !isAbsolute(trimmed)) {
    return {
      ok: false,
      code: "not_absolute",
      message: "Data directory must be an absolute path.",
    };
  }
  const absolute = resolveAbsolutePath(trimmed);
  const liveAbsolute = resolveAbsolutePath(liveDirectory);

  // Lexical relationship first (works for missing paths without following links).
  if (isSameOrRelatedPath(liveAbsolute, absolute)) {
    return {
      ok: false,
      code: "related_to_live",
      message:
        "Target cannot be the live data directory or one of its ancestors/descendants.",
    };
  }

  // Canonical comparison catches symlink/junction aliases across live/target.
  if (isSameOrRelatedCanonicalPath(liveAbsolute, absolute)) {
    return {
      ok: false,
      code: "related_to_live",
      message:
        "Target cannot be the live data directory or one of its ancestors/descendants.",
    };
  }

  return { ok: true, path: absolute };
}

export function formatBytesLabel(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let size = Math.max(0, bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}
