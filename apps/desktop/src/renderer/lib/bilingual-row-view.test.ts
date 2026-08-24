import { describe, expect, it } from "vitest";
import type { SegmentEditorRow } from "@translunar/contracts";

import {
  countsAfterPageLoad,
  editorListParamsFromPage,
  pageAfterConfirm,
  sourceRuns,
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

describe("sourceRuns", () => {
  it("interleaves tags at engine positions without inventing text", () => {
    const runs = sourceRuns("Hello world", [
      {
        id: "t1",
        kind: "start",
        displayText: "<b>",
        payload: "b",
        position: 6,
        protected: false,
        side: "source",
      },
      {
        id: "t2",
        kind: "end",
        displayText: "</b>",
        payload: "b",
        position: 11,
        protected: false,
        side: "source",
      },
    ]);
    expect(runs).toMatchObject([
      { kind: "text", text: "Hello " },
      { kind: "tag", tag: { id: "t1", displayText: "<b>" } },
      { kind: "text", text: "world" },
      { kind: "tag", tag: { id: "t2", displayText: "</b>" } },
    ]);
  });
});

describe("pageAfterConfirm", () => {
  it("advances to the next row on the same engine page", () => {
    const next = pageAfterConfirm({
      page: {
        offset: 0,
        limit: 2,
        total: 4,
        filter: "all",
        query: "",
      },
      rows: [row({ id: "seg-1", ordinal: 0 }), row({ id: "seg-2", ordinal: 1 })],
      confirmedSegmentId: "seg-1",
    });
    expect(next).toEqual({ offset: 0, focusSegmentId: "seg-2" });
  });

  it("requests the next engine page when the confirmed row is last", () => {
    const next = pageAfterConfirm({
      page: {
        offset: 0,
        limit: 2,
        total: 4,
        filter: "all",
        query: "",
      },
      rows: [row({ id: "seg-1", ordinal: 0 }), row({ id: "seg-2", ordinal: 1 })],
      confirmedSegmentId: "seg-2",
    });
    expect(next).toEqual({ offset: 2, focusSegmentId: null });
  });
});

describe("countsAfterPageLoad", () => {
  it("does not treat a partial page as document totals", () => {
    const counts = countsAfterPageLoad(
      [row({ state: "confirmed" })],
      10,
      {
        confirmed: 4,
        draft: 3,
        untranslated: 3,
        total: 10,
        openIssues: 1,
      },
    );
    expect(counts).toEqual({
      confirmed: 4,
      draft: 3,
      untranslated: 3,
      total: 10,
      openIssues: 1,
    });
  });
});
