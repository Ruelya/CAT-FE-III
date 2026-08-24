export interface SplitExportPath {
  dir: string;
  base: string;
  sep: string;
}

/**
 * Split a user-picked export path so sibling files can land in the same folder.
 * Honours the separator the picker actually returned (Windows or POSIX).
 */
export function splitExportPath(path: string): SplitExportPath {
  const lastSlash = path.lastIndexOf("/");
  const lastBack = path.lastIndexOf("\\");
  const sep = lastBack > lastSlash ? "\\" : "/";
  const idx = Math.max(lastSlash, lastBack);
  if (idx < 0) {
    return { dir: "", base: path, sep };
  }
  return {
    dir: path.slice(0, idx),
    base: path.slice(idx + 1),
    sep,
  };
}

/* Windows forbids these in file names; the control range is intentional. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeExportFileName(name: string): string {
  const trimmed = name.trim() || "export";
  return trimmed.replace(FORBIDDEN_FILENAME_CHARS, "_");
}

export function uniqueExportFileName(
  name: string,
  used: Set<string>,
  fallbackId: string,
): string {
  const safe = sanitizeExportFileName(name);
  if (!used.has(safe.toLowerCase())) {
    used.add(safe.toLowerCase());
    return safe;
  }
  const suffix = fallbackId.replace(FORBIDDEN_FILENAME_CHARS, "").slice(0, 8);
  const dotted = safe.lastIndexOf(".");
  const next =
    dotted > 0
      ? `${safe.slice(0, dotted)}-${suffix}${safe.slice(dotted)}`
      : `${safe}-${suffix}`;
  used.add(next.toLowerCase());
  return next;
}

export function joinExportPath(dir: string, fileName: string, sep: string): string {
  if (!dir) return fileName;
  return `${dir}${sep}${fileName}`;
}
