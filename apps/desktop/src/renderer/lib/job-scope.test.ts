import { describe, expect, it } from "vitest";

import {
  defaultJobScope,
  documentsForScope,
  qaDocumentFilter,
} from "./job-scope";

describe("job scope", () => {
  it("defaults a multi-file job to the whole job", () => {
    expect(defaultJobScope(1)).toBe("file");
    expect(defaultJobScope(2)).toBe("job");
  });

  it("omits documentId when QA should cover every file", () => {
    expect(qaDocumentFilter("file", "doc-1")).toBe("doc-1");
    expect(qaDocumentFilter("job", "doc-1")).toBeUndefined();
  });

  it("keeps a one-file job on the active document even if marked job", () => {
    const active = { id: "a" };
    expect(documentsForScope("job", [active], active)).toEqual([active]);
    expect(
      documentsForScope("job", [active, { id: "b" }], active).map((d) => d.id),
    ).toEqual(["a", "b"]);
    expect(
      documentsForScope("file", [active, { id: "b" }], active).map((d) => d.id),
    ).toEqual(["a"]);
  });
});
