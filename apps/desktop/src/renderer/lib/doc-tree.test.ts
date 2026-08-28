import { describe, expect, it } from "vitest";

import type { Document, SegmentCounts } from "@translunar/contracts";

import {
  buildDocTree,
  docTreeDirKeys,
  docTreeDisplayPaths,
} from "./doc-tree.js";

function doc(id: string, relativePath: string, name?: string): Document {
  /* Document carries an index signature, so the literal is the whole type. */
  return {
    currentVersion: 1,
    degradation: [],
    filterId: "docx",
    format: "docx",
    id,
    importedAtMs: 0,
    name: name ?? relativePath.split(/[/\\]/).pop() ?? relativePath,
    projectId: "p1",
    relativePath,
    revision: 1,
    segmentCount: 3,
    sourceSha256: "",
    status: "active",
    updatedAtMs: 0,
  };
}

function counts(
  total: number,
  confirmed: number,
  openIssues = 0,
): SegmentCounts {
  return {
    total,
    confirmed,
    draft: 0,
    untranslated: total - confirmed,
    openIssues,
  };
}

describe("buildDocTree", () => {
  it("keeps a flat import flat", () => {
    const rows = buildDocTree(
      [doc("a", "/w/one.docx"), doc("b", "/w/two.docx")],
      {},
      new Set(),
    );
    expect(rows.map((row) => row.kind)).toEqual(["file", "file"]);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
  });

  it("derives folders from the imported paths", () => {
    const rows = buildDocTree(
      [
        doc("a", "/w/docs/guides/one.docx"),
        doc("b", "/w/docs/two.docx"),
        doc("c", "/w/top.docx"),
      ],
      {},
      new Set(),
    );
    expect(
      rows.map((row) => [
        row.kind,
        row.kind === "dir" ? row.name : row.document.name,
        row.depth,
      ]),
    ).toEqual([
      ["dir", "docs", 0],
      ["dir", "guides", 1],
      ["file", "one.docx", 2],
      ["file", "two.docx", 1],
      ["file", "top.docx", 0],
    ]);
  });

  it("hides everything under a collapsed folder", () => {
    const rows = buildDocTree(
      [doc("a", "/w/docs/guides/one.docx"), doc("b", "/w/top.docx")],
      {},
      new Set(["docs"]),
    );
    expect(rows.map((row) => row.key)).toEqual(["docs", "file:b"]);
  });

  it("rolls a folder's counts up from every document beneath it", () => {
    const rows = buildDocTree(
      [
        doc("a", "/w/docs/guides/one.docx"),
        doc("b", "/w/docs/two.docx"),
        doc("c", "/w/top.docx"),
      ],
      { a: counts(10, 4, 1), b: counts(6, 6), c: counts(4, 0) },
      new Set(["docs"]),
    );
    const [docsDir] = rows;
    expect(docsDir?.kind).toBe("dir");
    if (docsDir?.kind !== "dir") {
      throw new Error("expected a directory row");
    }
    expect(docsDir.fileCount).toBe(2);
    expect(docsDir.rollup).toMatchObject({
      total: 16,
      confirmed: 10,
      openIssues: 1,
    });
  });

  it("reports no rollup when no document beneath has counts yet", () => {
    const rows = buildDocTree(
      [doc("a", "/w/docs/one.docx"), doc("b", "/w/two.docx")],
      {},
      new Set(),
    );
    const [docsDir] = rows;
    if (docsDir?.kind !== "dir") {
      throw new Error("expected a directory row");
    }
    expect(docsDir.rollup).toBeNull();
    expect(docsDir.fileCount).toBe(1);
  });

  it("tolerates windows separators", () => {
    const rows = buildDocTree(
      [
        doc("a", "C:\\work\\docs\\ui\\one.docx"),
        doc("b", "C:\\work\\top.docx"),
      ],
      {},
      new Set(),
    );
    expect(rows.map((row) => row.key)).toEqual([
      "docs",
      "docs/ui",
      "file:a",
      "file:b",
    ]);
  });

  // The engine stores the absolute source path, so the folders every document
  // shares are the reader's filesystem, not their project.
  it("drops the prefix every document shares", () => {
    const rows = buildDocTree(
      [
        doc("a", "/home/lin/work/site/docs/one.docx"),
        doc("b", "/home/lin/work/site/legal/two.docx"),
      ],
      {},
      new Set(),
    );
    expect(
      rows.map((row) => (row.kind === "dir" ? row.name : row.key)),
    ).toEqual(["docs", "file:a", "legal", "file:b"]);
  });

  it("renders a lone document at the root whatever its path", () => {
    const rows = buildDocTree(
      [doc("a", "/home/lin/deep/nested/path/one.docx")],
      {},
      new Set(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.depth).toBe(0);
  });

  it("lists every directory key for expand-all", () => {
    expect(
      docTreeDirKeys([
        doc("a", "/w/docs/guides/one.docx"),
        doc("b", "/w/docs/two.docx"),
        doc("c", "/w/top.docx"),
      ]).sort(),
    ).toEqual(["docs", "docs/guides"]);
  });
});

describe("docTreeDisplayPaths", () => {
  // The search box matches these, so they must be exactly what the tree
  // draws: visible folders plus the name, never the stripped prefix.
  it("joins the visible folders with the file name", () => {
    const paths = docTreeDisplayPaths([
      doc("a", "/w/docs/guides/one.docx"),
      doc("b", "/w/docs/two.docx"),
      doc("c", "/w/top.docx"),
    ]);
    expect(paths.get("a")).toBe("docs/guides/one.docx");
    expect(paths.get("b")).toBe("docs/two.docx");
    expect(paths.get("c")).toBe("top.docx");
  });

  it("omits the shared prefix a search could otherwise hit", () => {
    const paths = docTreeDisplayPaths([
      doc("a", "/home/lin/work/site/docs/one.docx"),
      doc("b", "/home/lin/work/site/legal/two.docx"),
    ]);
    expect(paths.get("a")).toBe("docs/one.docx");
    expect(paths.get("b")).toBe("legal/two.docx");
  });

  it("reduces a lone document to its bare name", () => {
    const paths = docTreeDisplayPaths([
      doc("a", "/home/lin/deep/nested/one.docx"),
    ]);
    expect(paths.get("a")).toBe("one.docx");
  });

  it("tolerates windows separators", () => {
    const paths = docTreeDisplayPaths([
      doc("a", "C:\\work\\docs\\ui\\one.docx"),
      doc("b", "C:\\work\\top.docx"),
    ]);
    expect(paths.get("a")).toBe("docs/ui/one.docx");
    expect(paths.get("b")).toBe("top.docx");
  });
});
