import type { Document } from "@translunar/contracts";

import type { UiError } from "../lib/errors";

export const DOCUMENT_PAGE_LIMIT = 200;
/** Hard cap on paging iterations to avoid infinite loops on bad Engine data. */
export const DOCUMENT_PAGE_MAX_ROUNDS = 50;

export interface DocumentPage {
  items: Document[];
  total: number;
  offset: number;
  limit: number;
}

export type ListDocumentsPage = (
  projectId: string,
  offset: number,
  limit: number,
) => Promise<DocumentPage>;

export type AggregateDocumentsResult =
  { ok: true; documents: Document[] } | { ok: false; error: UiError };

/**
 * Bounded, Engine-order-preserving document aggregation.
 * Deduplicates exact repeated IDs defensively; never re-sorts.
 */
export async function aggregateProjectDocuments(
  projectId: string,
  listPage: ListDocumentsPage,
  options?: { limit?: number; maxRounds?: number },
): Promise<AggregateDocumentsResult> {
  const limit = options?.limit ?? DOCUMENT_PAGE_LIMIT;
  const maxRounds = options?.maxRounds ?? DOCUMENT_PAGE_MAX_ROUNDS;
  const collected: Document[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let completed = false;
  let lastTotal = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    let page: DocumentPage;
    try {
      page = await listPage(projectId, offset, limit);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "document.list failed";
      let code = "DOCUMENT_LIST_FAILED";
      if (error && typeof error === "object" && "code" in error) {
        const maybeCode = Reflect.get(error, "code");
        if (typeof maybeCode === "string") {
          code = maybeCode;
        }
      }
      return {
        ok: false,
        error: {
          code,
          message,
          kind: "domain",
          details: error,
        },
      };
    }

    lastTotal = page.total;

    if (page.items.length === 0) {
      completed = true;
      break;
    }

    let advanced = 0;
    for (const doc of page.items) {
      if (doc.projectId !== projectId) {
        return {
          ok: false,
          error: {
            code: "DOCUMENT_CROSS_PROJECT",
            message: "Document does not belong to project.",
            kind: "domain",
          },
        };
      }
      if (seen.has(doc.id)) {
        continue;
      }
      seen.add(doc.id);
      collected.push(doc);
      advanced += 1;
    }

    if (collected.length >= page.total) {
      completed = true;
      break;
    }
    if (advanced === 0) {
      return {
        ok: false,
        error: {
          code: "DOCUMENT_LIST_STALLED",
          message: "document.list did not advance.",
          kind: "domain",
        },
      };
    }
    offset += page.items.length;
  }

  if (!completed && collected.length < lastTotal) {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_LIST_LIMIT",
        message: "document.list exceeded bounded page rounds.",
        kind: "domain",
      },
    };
  }

  return { ok: true, documents: collected };
}

export type PostDeleteDocumentRoute =
  { kind: "document"; documentId: string } | { kind: "import" };

/**
 * After recycling the active document, pick the next Engine-ordered document
 * or route to Import when none remain.
 */
export function resolvePostDeleteDocumentRoute(
  documents: readonly { id: string }[],
  deletedDocumentId: string,
): PostDeleteDocumentRoute {
  const remaining = documents.filter((d) => d.id !== deletedDocumentId);
  if (remaining.length === 0) return { kind: "import" };
  return { kind: "document", documentId: remaining[0]!.id };
}

export function firstSuccessfulImportDocumentId(
  diagnostics: readonly {
    status: string;
    document?: { id: string; projectId: string } | null;
  }[],
  projectId: string,
): string | null {
  for (const item of diagnostics) {
    if (item.status !== "succeeded" && item.status !== "success") continue;
    const doc = item.document;
    if (doc && doc.projectId === projectId && doc.id) {
      return doc.id;
    }
  }
  return null;
}

export function chooseImportOpenDocumentId(input: {
  projectId: string;
  diagnostics: readonly {
    status: string;
    document?: { id: string; projectId: string } | null;
  }[];
  documents: readonly { id: string; projectId: string }[];
}): string | null {
  const fromDiagnostic = firstSuccessfulImportDocumentId(
    input.diagnostics,
    input.projectId,
  );
  if (fromDiagnostic) return fromDiagnostic;
  const first = input.documents.find((d) => d.projectId === input.projectId);
  return first?.id ?? null;
}
