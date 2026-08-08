/** Versioned Workbench session identity (no domain snapshot). */

export const SESSION_STORAGE_KEY = "translunar.renderer.session.v1";
export const SESSION_VERSION = 1 as const;

export interface SessionIdentity {
  version: typeof SESSION_VERSION;
  projectId: string;
  documentId: string;
}

export type SessionParseResult =
  | { ok: true; session: SessionIdentity }
  | { ok: false; reason: "missing" | "malformed" | "unsupported" | "blank" };

export function parseSession(raw: string | null): SessionParseResult {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: false, reason: "missing" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "malformed" };
  }
  const record = value as Record<string, unknown>;
  if (record.version !== SESSION_VERSION) {
    return { ok: false, reason: "unsupported" };
  }
  if (
    typeof record.projectId !== "string" ||
    typeof record.documentId !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (record.projectId.trim() === "" || record.documentId.trim() === "") {
    return { ok: false, reason: "blank" };
  }
  return {
    ok: true,
    session: {
      version: SESSION_VERSION,
      projectId: record.projectId,
      documentId: record.documentId,
    },
  };
}

export function serializeSession(session: SessionIdentity): string {
  return JSON.stringify({
    version: SESSION_VERSION,
    projectId: session.projectId,
    documentId: session.documentId,
  });
}

export function readSessionFromStorage(
  storage: Pick<Storage, "getItem"> = localStorage,
): SessionParseResult {
  try {
    return parseSession(storage.getItem(SESSION_STORAGE_KEY));
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function writeSessionToStorage(
  session: SessionIdentity,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(SESSION_STORAGE_KEY, serializeSession(session));
}

export function clearSessionStorage(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(SESSION_STORAGE_KEY);
}

export function makeSession(
  projectId: string,
  documentId: string,
): SessionIdentity {
  return { version: SESSION_VERSION, projectId, documentId };
}
