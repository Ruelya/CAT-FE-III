import { describe, expect, it } from "vitest";
import type { SegmentEditorRow } from "@translunar/contracts";

import { previewBlocks } from "./structure-preview";

function row(
  id: string,
  source: string,
  target: string,
  path: string,
): SegmentEditorRow {
  return {
    comments: [],
    sourceTags: [],
    targetTags: [],
    spellFindings: [],
    tagIssues: [],
    workflowState: "translation",
    segment: {
      id,
      documentId: "doc",
      ordinal: 0,
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
    });
    expect(blocks[1]).toMatchObject({
      segmentId: "b",
      text: "World",
      empty: true,
      label: "H",
    });
  });
});
