import { describe, expect, it } from "vitest";
import type { SegmentEditorRow } from "@translunar/contracts";

import {
  editorListParamsFromPage,
  toBilingualRowView,
} from "./bilingual-row-view";

function row(
  extras: Partial<SegmentEditorRow["segment"]> & {
    comments?: SegmentEditorRow["comments"];
    sourceTags?: SegmentEditorRow["sourceTags"];
    tagIssues?: SegmentEditorRow["tagIssues"];
  } = {},
): SegmentEditorRow {
  return {
    comments: extras.comments ?? [],
    sourceTags: extras.sourceTags ?? [],
    targetTags: [],
    spellFindings: [],
    tagIssues: extras.tagIssues ?? [],
    workflowState: "translation",
    segment: {
      id: extras.id ?? "seg-1",
      documentId: extras.documentId ?? "doc-1",
      ordinal: extras.ordinal ?? 0,
      revision: extras.revision ?? 3,
      sourceText: extras.sourceText ?? "Hello",
      targetText: extras.targetText ?? "",
      state: extras.state ?? "untranslated",
      structuralPath: extras.structuralPath ?? "1",
      contextHash: "",
      sourceHash: "",
      updatedAtMs: 0,
    },
  };
}

describe("toBilingualRowView", () => {
  it("projects an editor row without inventing identity", () => {
    const view = toBilingualRowView(
      row({
        id: "seg-9",
        revision: 4,
        state: "draft",
        targetText: "你好",
        comments: [
          {
            id: "c1",
            author: "a",
            text: "note",
            createdAtMs: 1,
            updatedAtMs: 1,
            immutable: false,
            resolved: false,
            revision: 1,
            segmentId: "seg-9",
          },
        ],
      }),
    );
    expect(view.segmentId).toBe("seg-9");
    expect(view.revision).toBe(4);
    expect(view.filterHints).toMatchObject({
      draft: true,
      commented: true,
      untranslated: false,
    });
    expect(view.hasOpenComments).toBe(true);
  });
});

describe("editorListParamsFromPage", () => {
  it("maps a single Swordfish show-flag onto the existing filter enum", () => {
    expect(
      editorListParamsFromPage({
        documentId: "doc-1",
        start: 500,
        count: 500,
        showUntranslated: true,
        showTranslated: false,
        showConfirmed: false,
        filterText: "  aurora  ",
      }),
    ).toEqual({
      documentId: "doc-1",
      offset: 500,
      limit: 500,
      sort: "ordinal",
      filter: "untranslated",
      query: "aurora",
      field: "both",
    });
  });

  it("collapses combined show-flags to all instead of a new method", () => {
    expect(
      editorListParamsFromPage({
        documentId: "doc-1",
        start: 0,
        count: 100,
        showUntranslated: true,
        showTranslated: true,
        showConfirmed: false,
      }).filter,
    ).toBe("all");
  });

  it("maps a lone translated flag onto draft, not a new filter", () => {
    expect(
      editorListParamsFromPage({
        documentId: "doc-1",
        start: 0,
        count: 50,
        showUntranslated: false,
        showTranslated: true,
        showConfirmed: false,
      }).filter,
    ).toBe("draft");
  });
});
