import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Segment, TmMatchItem } from "@translunar/contracts";

import { TmPanel } from "./TmPanel.js";

function segment(sourceText: string): Segment {
  return {
    id: "seg-1",
    documentId: "doc-1",
    ordinal: 0,
    structuralPath: "/p[1]",
    sourceText,
    sourceHash: "hash-src",
    contextHash: "hash-ctx",
    targetText: "",
    state: "untranslated",
    revision: 1,
    updatedAtMs: 1,
  };
}

function match(
  grade: TmMatchItem["grade"],
  score: number,
  sourceText: string,
): TmMatchItem {
  return {
    entry: {
      id: `tm-${grade}-${score}`,
      memoryId: "mem-1",
      sourceHash: "hash-tm",
      sourceText,
      targetText: "保存文件。",
      originProjectId: "proj-1",
      originDocumentId: "doc-0",
      originSegmentId: "seg-0",
      confirmedAtMs: 1,
    },
    score,
    grade,
    memoryName: "主记忆库",
  };
}

describe("TmPanel", () => {
  it("renders a source diff on fuzzy hits: deletions from the TM entry, insertions from the active source", () => {
    render(
      <TmPanel
        activeSegment={segment("Save the new file.")}
        matches={[match("fuzzy", 82, "Save the file.")]}
        error={null}
        onApply={() => {}}
      />,
    );
    const diff = screen.getByLabelText("记忆源文与当前源文的差异");
    // "new " exists only in the active source → insertion.
    const inserted = Array.from(diff.querySelectorAll(".ai-diff__ins")).map(
      (node) => node.textContent,
    );
    expect(inserted).toEqual(["new "]);
    // Nothing was struck: the TM source is a strict subsequence here.
    expect(diff.querySelectorAll(".ai-diff__del")).toHaveLength(0);
    // The shared text still reads through as equal runs.
    expect(diff.textContent).toBe("Save the new file.");
  });

  it("strikes TM-only characters when the entry has text the active source dropped", () => {
    render(
      <TmPanel
        activeSegment={segment("Save file.")}
        matches={[match("fuzzy", 78, "Save the file.")]}
        error={null}
        onApply={() => {}}
      />,
    );
    const diff = screen.getByLabelText("记忆源文与当前源文的差异");
    const deleted = Array.from(diff.querySelectorAll(".ai-diff__del")).map(
      (node) => node.textContent,
    );
    expect(deleted).toEqual(["the "]);
  });

  it("keeps exact hits on the plain source line without diff markup", () => {
    render(
      <TmPanel
        activeSegment={segment("Save the file.")}
        matches={[match("exact", 100, "Save the file.")]}
        error={null}
        onApply={() => {}}
      />,
    );
    expect(screen.getByText("源：Save the file.")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("记忆源文与当前源文的差异"),
    ).not.toBeInTheDocument();
  });
});
