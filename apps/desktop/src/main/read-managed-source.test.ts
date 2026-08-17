import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readManagedSourceFile } from "./read-managed-source.js";

async function dataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tl-managed-source-"));
  await mkdir(join(root, "sources"));
  return root;
}

describe("readManagedSourceFile", () => {
  it("reads the managed copy and never requires a renderer path", async () => {
    const root = await dataDir();
    await writeFile(join(root, "sources", "doc-1.docx"), "PK-docx");
    const result = await readManagedSourceFile(root, {
      documentId: "doc-1",
      format: "docx",
      name: "brief.docx",
    });
    expect(result?.extension).toBe("docx");
    expect(Buffer.from(result?.bytes ?? []).toString("utf8")).toBe("PK-docx");
  });

  it("tries format aliases when the file uses a markdown suffix", async () => {
    const root = await dataDir();
    await writeFile(join(root, "sources", "doc-2.md"), "# Hi");
    const result = await readManagedSourceFile(root, {
      documentId: "doc-2",
      format: "markdown",
    });
    expect(result?.extension).toBe("md");
    expect(Buffer.from(result?.bytes ?? []).toString("utf8")).toBe("# Hi");
  });

  it("returns null for missing files, bad ids, and escaped symlinks", async () => {
    const root = await dataDir();
    const outside = join(root, "outside.txt");
    await writeFile(outside, "secret");
    await symlink(outside, join(root, "sources", "doc-3.txt"));

    expect(
      await readManagedSourceFile(root, {
        documentId: "../doc-3",
        format: "txt",
      }),
    ).toBeNull();
    expect(
      await readManagedSourceFile(root, {
        documentId: "missing",
        format: "docx",
      }),
    ).toBeNull();
    expect(
      await readManagedSourceFile(root, {
        documentId: "doc-3",
        format: "txt",
      }),
    ).toBeNull();
  });
});
