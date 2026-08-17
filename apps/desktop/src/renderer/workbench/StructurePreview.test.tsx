import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InlineTag, SegmentEditorRow } from "@translunar/contracts";

import { createFakeDesktopApi, createFakeEngineState } from "../test/fake-desktop-api";
import { StructurePreview } from "./StructurePreview";

vi.mock("docx-preview", () => ({
  renderAsync: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "translunar");
});

function tag(
  id: string,
  kind: "start" | "end" | "standalone",
  position: number,
  displayText: string,
  payload = displayText,
): InlineTag {
  return {
    id,
    kind,
    position,
    displayText,
    side: "source",
    payload,
    protected: true,
  };
}

function row(
  id: string,
  source: string,
  target: string,
  path: string,
  extras?: { sourceTags?: InlineTag[]; ordinal?: number },
): SegmentEditorRow {
  return {
    comments: [],
    sourceTags: extras?.sourceTags ?? [],
    targetTags: [],
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

describe("StructurePreview", () => {
  it("keeps jump testids and activates a block", async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    render(
      <StructurePreview
        rows={[row("seg-1", "Hello", "你好", "word/document.xml#p:1")]}
        activeSegmentId="seg-1"
        onJump={onJump}
      />,
    );
    const block = screen.getByTestId("preview-block-seg-1");
    expect(screen.getByTestId("structure-preview")).toBeInTheDocument();
    expect(block).toHaveTextContent("你好");
    await user.click(block);
    expect(onJump).toHaveBeenCalledWith("seg-1");
  });

  it("renders a markdown heading through marked", () => {
    render(
      <StructurePreview
        rows={[
          row("h1", "Title", "", "markdown:byte:0-5", {
            ordinal: 0,
            sourceTags: [tag("md", "standalone", 0, "<md>", "# ")],
          }),
        ]}
        filterId="builtin.markdown"
        format="markdown"
        activeSegmentId={null}
        onJump={() => undefined}
      />,
    );
    const heading = screen
      .getByTestId("preview-block-h1")
      .querySelector("h1");
    expect(heading).toHaveTextContent("Title");
    expect(screen.getByText(/marked/)).toBeInTheDocument();
  });

  it("mounts docx-preview when managed source bytes are available", async () => {
    window.translunar = createFakeDesktopApi(
      createFakeEngineState({
        managedSource: {
          extension: "docx",
          bytes: new Uint8Array([0x50, 0x4b]),
        },
      }),
    );
    render(
      <StructurePreview
        rows={[row("seg-1", "Hello", "你好", "word/document.xml#p:1")]}
        filterId="builtin.docx"
        format="docx"
        documentId="doc-1"
        documentName="brief.docx"
        relativePath="brief.docx"
        activeSegmentId={null}
        onJump={() => undefined}
      />,
    );
    expect(await screen.findByTestId("docx-preview-host")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/docx-preview/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("preview-block-seg-1")).toBeInTheDocument();
  });
});
