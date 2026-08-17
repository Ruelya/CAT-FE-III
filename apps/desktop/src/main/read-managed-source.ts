import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import {
  extensionCandidates,
  MANAGED_SOURCE_MAX_BYTES,
  MANAGED_SOURCES_DIR,
  sanitizeDocumentId,
  type ManagedSourceBytes,
  type ManagedSourceRequest,
} from "../shared/managed-source.js";

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Read a managed import copy from `{dataDir}/sources/{id}.{ext}`.
 *
 * Returns bytes only. Never exposes the filesystem path to the renderer.
 */
export async function readManagedSourceFile(
  dataDirectory: string,
  request: ManagedSourceRequest,
): Promise<ManagedSourceBytes | null> {
  const documentId = sanitizeDocumentId(request.documentId);
  if (!documentId) return null;

  let sourcesRoot: string;
  try {
    sourcesRoot = await realpath(join(dataDirectory, MANAGED_SOURCES_DIR));
  } catch {
    return null;
  }

  for (const extension of extensionCandidates(request)) {
    const candidate = join(sourcesRoot, `${documentId}.${extension}`);
    let resolved: string;
    try {
      resolved = await realpath(candidate);
    } catch {
      continue;
    }
    if (!isInside(sourcesRoot, resolved) && resolved !== sourcesRoot) {
      continue;
    }
    if (resolved === sourcesRoot || resolved.endsWith(sep)) {
      continue;
    }
    try {
      const info = await stat(resolved);
      if (!info.isFile() || info.size > MANAGED_SOURCE_MAX_BYTES) {
        continue;
      }
      const buffer = await readFile(resolved);
      return { extension, bytes: new Uint8Array(buffer) };
    } catch {
      continue;
    }
  }
  return null;
}
