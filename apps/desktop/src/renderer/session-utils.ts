export interface StoredSession {
  projectId: string;
  documentId: string;
}

export function parseStoredSession(value: string | null): StoredSession | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    const projectId = parsed.projectId;
    const documentId = parsed.documentId;
    if (
      typeof projectId !== "string" ||
      !projectId.trim() ||
      typeof documentId !== "string" ||
      !documentId.trim()
    ) {
      return null;
    }
    return { projectId, documentId };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
