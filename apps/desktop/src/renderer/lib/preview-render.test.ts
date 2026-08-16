import { describe, expect, it } from "vitest";
import type { InlineTag } from "@translunar/contracts";

import {
  previewKind,
  previewRendererHint,
  renderPreviewHtml,
  sanitizePreviewHtml,
} from "./preview-render";

function tag(
  kind: InlineTag["kind"],
  position: number,
  payload: string,
  displayText = payload,
): InlineTag {
  return {
    id: `${kind}-${position}`,
    kind,
    position,
    displayText,
    side: "source",
    payload,
    protected: true,
  };
}

describe("previewKind", () => {
  it("classifies engine filter ids", () => {
    expect(previewKind("builtin.markdown", "markdown")).toBe("markdown");
    expect(previewKind("builtin.html", "html")).toBe("html");
    expect(previewKind("builtin.docx", "docx")).toBe("docx");
    expect(previewKind("builtin.txt", "txt")).toBe("text");
  });
});

describe("renderPreviewHtml", () => {
  it("parses markdown headings through marked", () => {
    const html = renderPreviewHtml(
      "Title",
      [tag("standalone", 0, "# ", "<md>")],
      "builtin.markdown",
      "markdown",
    );
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
  });

  it("keeps typography tags for Word-like rows", () => {
    const html = renderPreviewHtml(
      "Read the TL-900 guide.",
      [tag("start", 9, "", "b"), tag("end", 15, "", "b")],
      "builtin.docx",
      "docx",
    );
    expect(html).toBe("Read the <strong>TL-900</strong> guide.");
  });

  it("strips script from HTML reconstruction", () => {
    const html = renderPreviewHtml(
      "Hello",
      [tag("start", 0, "<script>alert(1)</script><em>"), tag("end", 5, "</em>")],
      "builtin.html",
      "html",
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("alert");
    expect(html).toContain("<em>Hello</em>");
  });
});

describe("sanitizePreviewHtml", () => {
  it("drops javascript URLs", () => {
    expect(sanitizePreviewHtml('<a href="javascript:alert(1)">x</a>')).not.toContain(
      "javascript:",
    );
  });
});

describe("previewRendererHint", () => {
  it("names the libraries without claiming original Word layout", () => {
    expect(previewRendererHint("markdown", false)).toContain("marked");
    expect(previewRendererHint("docx", true)).toContain("docx-preview");
    expect(previewRendererHint("docx", false)).not.toContain("docx-preview");
  });
});
