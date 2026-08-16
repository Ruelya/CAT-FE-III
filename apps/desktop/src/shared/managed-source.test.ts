import { describe, expect, it } from "vitest";

import {
  extensionCandidates,
  extensionFromFileName,
  parseManagedSourceRequest,
  sanitizeDocumentId,
  sanitizeExtension,
} from "./managed-source.js";

describe("sanitizeDocumentId", () => {
  it("accepts engine-style ids and rejects path traversal", () => {
    expect(sanitizeDocumentId("doc-1")).toBe("doc-1");
    expect(sanitizeDocumentId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    expect(sanitizeDocumentId("../etc/passwd")).toBeNull();
    expect(sanitizeDocumentId("a/b")).toBeNull();
    expect(sanitizeDocumentId("")).toBeNull();
  });
});

describe("sanitizeExtension", () => {
  it("keeps alphanumeric extensions", () => {
    expect(sanitizeExtension(".DOCX")).toBe("docx");
    expect(sanitizeExtension("md")).toBe("md");
    expect(sanitizeExtension("..")).toBeNull();
    expect(sanitizeExtension("exe with space")).toBe("exewithspace");
  });
});

describe("extensionCandidates", () => {
  it("prefers the imported file name, then format aliases", () => {
    expect(
      extensionCandidates({
        documentId: "doc",
        format: "markdown",
        name: "guide.md",
        relativePath: "docs/guide.md",
      }),
    ).toEqual(["md", "markdown", "mdown", "mkdn"]);
    expect(
      extensionCandidates({
        documentId: "doc",
        format: "docx",
        name: "brief.docx",
      }),
    ).toEqual(["docx"]);
  });
});

describe("extensionFromFileName", () => {
  it("reads the last suffix", () => {
    expect(extensionFromFileName("a/b/c.xhtml")).toBe("xhtml");
    expect(extensionFromFileName("noext")).toBeNull();
  });
});

describe("parseManagedSourceRequest", () => {
  it("requires documentId and format", () => {
    expect(parseManagedSourceRequest(null)).toBeNull();
    expect(parseManagedSourceRequest({ documentId: "d" })).toBeNull();
    expect(
      parseManagedSourceRequest({
        documentId: " d1 ",
        format: " docx ",
        name: "a.docx",
      }),
    ).toEqual({
      documentId: "d1",
      format: "docx",
      name: "a.docx",
    });
  });
});
