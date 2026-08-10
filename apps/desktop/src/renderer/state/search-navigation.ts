export type SearchHitDestination =
  | { kind: "project"; projectId: string }
  | { kind: "document"; projectId: string; documentId: string }
  | {
      kind: "segment";
      projectId: string;
      documentId: string;
      segmentId: string;
    }
  | { kind: "invalid"; reason: string };

export interface SearchHitLike {
  projectId: string;
  documentId?: string | null;
  segmentId?: string | null;
}

/**
 * Classify a global search hit into a navigation destination.
 * Segment requires both segmentId and documentId.
 */
export function classifySearchHit(hit: SearchHitLike): SearchHitDestination {
  const projectId = hit.projectId?.trim() ?? "";
  if (!projectId) {
    return { kind: "invalid", reason: "Missing project identity." };
  }
  const documentId =
    typeof hit.documentId === "string" && hit.documentId.trim() !== ""
      ? hit.documentId
      : null;
  const segmentId =
    typeof hit.segmentId === "string" && hit.segmentId.trim() !== ""
      ? hit.segmentId
      : null;

  if (segmentId) {
    if (!documentId) {
      return {
        kind: "invalid",
        reason: "Segment hit is missing document identity.",
      };
    }
    return { kind: "segment", projectId, documentId, segmentId };
  }
  if (documentId) {
    return { kind: "document", projectId, documentId };
  }
  return { kind: "project", projectId };
}

export function searchHitKey(
  hit: SearchHitLike & {
    field?: string;
    snippet?: string;
    updatedAtMs?: number;
    segmentOrdinal?: number | null;
  },
  index: number,
): string {
  const parts = [
    hit.projectId,
    hit.documentId ?? "",
    hit.segmentId ?? "",
    hit.field ?? "",
    String(hit.segmentOrdinal ?? ""),
    String(hit.updatedAtMs ?? ""),
    String(index),
  ];
  return parts.join(":");
}

export function trimSearchQuery(text: string): string {
  return text.trim();
}
