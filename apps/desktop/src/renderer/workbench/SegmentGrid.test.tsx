import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SegmentEditorRow } from "@translunar/contracts";

import { SegmentGrid } from "./SegmentGrid";

afterEach(cleanup);

function row(
  extras: Partial<SegmentEditorRow["segment"]> & {
    sourceTags?: SegmentEditorRow["sourceTags"];
  } = {},
): SegmentEditorRow {
  return {
    comments: [],
    sourceTags: extras.sourceTags ?? [],
    targetTags: [],
    spellFindings: [],
    tagIssues: [],
    workflowState: "translation",
    segment: {
      id: extras.id ?? "seg-1",
      documentId: extras.documentId ?? "doc-1",
      ordinal: extras.ordinal ?? 0,
      revision: extras.revision ?? 1,
      sourceText: extras.sourceText ?? "Hello world",
      targetText: extras.targetText ?? "",
      state: extras.state ?? "untranslated",
      structuralPath: extras.structuralPath ?? "1",
      contextHash: "",
      sourceHash: "",
      updatedAtMs: 0,
    },
  };
}

describe("SegmentGrid bilingual surface", () => {
  it("renders source tag chips and pages through the engine window", async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    render(
      <SegmentGrid
        rows={[
          row({
            sourceTags: [
              {
                id: "t1",
                kind: "standalone",
                displayText: "<br/>",
                payload: "br",
                position: 5,
                protected: false,
                side: "source",
              },
            ],
          }),
        ]}
        page={{
          offset: 0,
          limit: 1,
          total: 3,
          filter: "all",
          query: "",
        }}
        activeSegmentId="seg-1"
        focusSegmentId={null}
        editState={null}
        onSelect={vi.fn()}
        onDraftChange={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onConfirm={vi.fn()}
        onPage={onPage}
      />,
    );

    expect(screen.getByTestId("bilingual-grid")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Ctx" })).toBeNull();
    expect(screen.queryByTestId("workflow-seg-1")).toBeNull();
    expect(screen.getByText("<br/>")).toHaveClass("inline-tag");
    expect(screen.getByTestId("segment-paging")).toHaveTextContent("1-1 of 3");
    expect(screen.getByTestId("target-editor-seg-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(1);
  });
});
