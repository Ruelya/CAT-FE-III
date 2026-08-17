import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Document, SegmentCounts } from "@translunar/contracts";

import { FileNav } from "./FileNav";

function doc(id: string, name: string, segmentCount: number): Document {
  return {
    id,
    projectId: "p",
    name,
    relativePath: name,
    format: "txt",
    filterId: "txt",
    status: "active",
    revision: 1,
    currentVersion: 1,
    segmentCount,
    sourceSha256: "x",
    importedAtMs: 0,
    updatedAtMs: 0,
    degradation: [],
  };
}

const counts = (partial: Partial<SegmentCounts>): SegmentCounts => ({
  confirmed: 0,
  draft: 0,
  untranslated: 0,
  total: 0,
  openIssues: 0,
  ...partial,
});

describe("FileNav", () => {
  it("shows remaining unconfirmed counts and switches files", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FileNav
        documents={[doc("a", "one.docx", 10), doc("b", "two.docx", 4)]}
        activeDocumentId="a"
        progress={{
          a: counts({ total: 10, confirmed: 7, draft: 1, untranslated: 2 }),
          b: counts({ total: 4, confirmed: 0, draft: 0, untranslated: 4 }),
        }}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByTestId("file-nav-job")).toHaveTextContent("2 · 7 open / 14");
    expect(screen.getByTestId("file-nav-item-a")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await user.click(screen.getByTestId("file-nav-item-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("hosts Add files and collapse on the file rail", async () => {
    const user = userEvent.setup();
    const onAddFiles = vi.fn();
    const onCollapse = vi.fn();
    render(
      <FileNav
        documents={[doc("a", "one.docx", 10)]}
        activeDocumentId="a"
        progress={{
          a: counts({ total: 10, confirmed: 7, draft: 1, untranslated: 2 }),
        }}
        onSelect={vi.fn()}
        onAddFiles={onAddFiles}
        onCollapse={onCollapse}
      />,
    );
    await user.click(screen.getByTestId("add-files"));
    expect(onAddFiles).toHaveBeenCalledOnce();
    await user.click(screen.getByTestId("file-nav-collapse"));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
