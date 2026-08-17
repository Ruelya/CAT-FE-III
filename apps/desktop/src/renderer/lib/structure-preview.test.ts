import { describe, expect, it } from "vitest";
import type { InlineTag, SegmentEditorRow } from "@translunar/contracts";

import { previewBlocks, previewRole } from "./structure-preview";

function tag(
  id: string,
  kind: "start" | "end" | "standalone",
  position: number,
  displayText: string,
): InlineTag {
  return {
    id,
    kind,
    position,
    displayText,
    side: "source",
    payload: displayText,
    protected: true,
  };
}

function row(
  id: string,
  source: string,
  target: string,
  path: string,
  extras?: {
    ordinal?: number;
    sourceTags?: InlineTag[];
    targetTags?: InlineTag[];
  },
): SegmentEditorRow {
  return {
    comments: [],
    sourceTags: extras?.sourceTags ?? [],
    targetTags: extras?.targetTags ?? [],
    spellFindings: [],
    tagIssues: [],
    workflowState: "translation",
    segment: {
      id,
      documentId: "doc",
      ordinal: extras?.ordinal ?? 0,
      revision: 1,
      sourceText: source,
      targetText: target,
      state: target ? "draft" : "untranslated",
      structuralPath: path,
      contextHash: "",
      sourceHash: "",
      updatedAtMs: 0,
    },
  };
}

describe("previewBlocks", () => {
  it("prefers the target and falls back to the source", () => {
    const blocks = previewBlocks([
      row("a", "Hello", "你好", "word/document.xml#p:1"),
      row("b", "World", "", "word/document.xml#heading"),
    ]);
    expect(blocks[0]).toMatchObject({
      segmentId: "a",
      text: "你好",
      empty: false,
      label: "¶",
      role: "paragraph",
    });
    expect(blocks[1]).toMatchObject({
      segmentId: "b",
      text: "World",
      empty: true,
      label: "H",
      role: "heading",
    });
  });

  it("applies source tags when the target is still empty", () => {
    const blocks = previewBlocks([
      row("a", "Read the TL-900 guide.", "", "word/document.xml#p:1", {
        sourceTags: [tag("1s", "start", 9, "b"), tag("1e", "end", 15, "b")],
      }),
    ]);
    expect(blocks[0]?.html).toBe("Read the <strong>TL-900</strong> guide.");
  });

  it("renders markdown through marked when the filter is markdown", () => {
    const heading = tag("md", "standalone", 0, "<md>");
    heading.payload = "# ";
    const blocks = previewBlocks(
      [
        row("h", "Title", "", "markdown:byte:0-5", {
          ordinal: 0,
          sourceTags: [heading],
        }),
      ],
      "builtin.markdown",
      "markdown",
    );
    expect(blocks[0]?.html).toMatch(/<h1[^>]*>Title<\/h1>/);
  });
});

describe("previewRole", () => {
  it("treats the first HTML unit as a heading", () => {
    expect(previewRole("html:text:0-12", "builtin.html", 0)).toBe("heading");
    expect(previewRole("html:text:20-40", "builtin.html", 1)).toBe("paragraph");
  });
});
