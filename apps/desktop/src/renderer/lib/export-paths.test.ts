import { describe, expect, it } from "vitest";

import {
  joinExportPath,
  sanitizeExportFileName,
  splitExportPath,
  uniqueExportFileName,
} from "./export-paths";

describe("export paths", () => {
  it("keeps a Windows picker path on the same drive", () => {
    expect(splitExportPath("C:\\tmp\\out.txt")).toEqual({
      dir: "C:\\tmp",
      base: "out.txt",
      sep: "\\",
    });
    expect(joinExportPath("C:\\tmp", "a.docx", "\\")).toBe("C:\\tmp\\a.docx");
  });

  it("keeps a POSIX picker path in the same folder", () => {
    expect(splitExportPath("/tmp/out.txt")).toEqual({
      dir: "/tmp",
      base: "out.txt",
      sep: "/",
    });
  });

  it("disambiguates two files that share a name", () => {
    const used = new Set<string>();
    expect(uniqueExportFileName("notes.docx", used, "aaa")).toBe("notes.docx");
    expect(uniqueExportFileName("notes.docx", used, "doc-2")).toBe(
      "notes-doc-2.docx",
    );
  });

  it("strips characters a filesystem will reject", () => {
    expect(sanitizeExportFileName("a:b?.txt")).toBe("a_b_.txt");
  });
});
