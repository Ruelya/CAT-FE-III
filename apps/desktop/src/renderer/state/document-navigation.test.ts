import { describe, expect, it } from "vitest";
import type { Document } from "@translunar/contracts";

import {
  aggregateProjectDocuments,
  chooseImportOpenDocumentId,
  firstSuccessfulImportDocumentId,
  resolvePostDeleteDocumentRoute,
} from "./document-navigation";

function doc(id: string, projectId = "p1"): Document {
  return {
    id,
    projectId,
    name: id,
    format: "txt",
    filterId: "builtin.txt",
    relativePath: `${id}.txt`,
    status: "active",
    revision: 1,
    currentVersion: 1,
    segmentCount: 1,
    sourceSha256: "x",
    importedAtMs: 0,
    updatedAtMs: 0,
    degradation: [],
  };
}

describe("aggregateProjectDocuments", () => {
  it("preserves Engine order across pages", async () => {
    const result = await aggregateProjectDocuments("p1", (_id, offset) => {
      if (offset === 0) {
        return Promise.resolve({
          items: [doc("a"), doc("b")],
          total: 3,
          offset: 0,
          limit: 2,
        });
      }
      return Promise.resolve({
        items: [doc("c")],
        total: 3,
        offset: 2,
        limit: 2,
      });
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.map((d) => d.id)).toEqual(["a", "b", "c"]);
    }
  });

  it("rejects cross-project documents", async () => {
    const result = await aggregateProjectDocuments("p1", () =>
      Promise.resolve({
        items: [doc("a", "other")],
        total: 1,
        offset: 0,
        limit: 200,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOCUMENT_CROSS_PROJECT");
    }
  });

  it("rejects non-advancing pages", async () => {
    const result = await aggregateProjectDocuments(
      "p1",
      () =>
        Promise.resolve({
          items: [doc("a"), doc("a")],
          total: 5,
          offset: 0,
          limit: 2,
        }),
      { maxRounds: 3 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOCUMENT_LIST_STALLED");
    }
  });

  it("returns empty list when total is zero", async () => {
    const result = await aggregateProjectDocuments("p1", () =>
      Promise.resolve({
        items: [],
        total: 0,
        offset: 0,
        limit: 200,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents).toEqual([]);
    }
  });

  it("rejects when maxRounds exhausts before reaching total", async () => {
    let offsetCursor = 0;
    const result = await aggregateProjectDocuments(
      "p1",
      (_id, offset, limit) => {
        const id = `d-${offset}`;
        offsetCursor = offset + limit;
        return Promise.resolve({
          items: [doc(id)],
          total: 10,
          offset,
          limit,
        });
      },
      { limit: 1, maxRounds: 3 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOCUMENT_LIST_LIMIT");
    }
    // Advanced across rounds; not a stall.
    expect(offsetCursor).toBeGreaterThan(0);
  });
});

describe("resolvePostDeleteDocumentRoute", () => {
  it("routes to import when no documents remain", () => {
    expect(resolvePostDeleteDocumentRoute([{ id: "d1" }], "d1")).toEqual({
      kind: "import",
    });
  });

  it("picks first remaining Engine document", () => {
    expect(
      resolvePostDeleteDocumentRoute(
        [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
        "d1",
      ),
    ).toEqual({ kind: "document", documentId: "d2" });
  });
});

describe("chooseImportOpenDocumentId", () => {
  it("prefers first successful diagnostic document", () => {
    const id = chooseImportOpenDocumentId({
      projectId: "p1",
      diagnostics: [
        { status: "failed" },
        {
          status: "succeeded",
          document: { id: "doc-ok", projectId: "p1" },
        },
      ],
      documents: [doc("doc-list")],
    });
    expect(id).toBe("doc-ok");
  });

  it("falls back to first Engine document", () => {
    const id = chooseImportOpenDocumentId({
      projectId: "p1",
      diagnostics: [{ status: "succeeded", document: null }],
      documents: [doc("doc-list")],
    });
    expect(id).toBe("doc-list");
  });

  it("returns null when nothing usable", () => {
    expect(
      firstSuccessfulImportDocumentId(
        [{ status: "failed", document: null }],
        "p1",
      ),
    ).toBeNull();
  });
});
