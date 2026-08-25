import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Segment, SegmentState } from "@translunar/contracts";
import type { DesktopApi } from "../../shared/desktop-api.js";

import { PreviewDialog } from "./PreviewDialog.js";

const renderAsyncMock = vi.hoisted(() => vi.fn());
vi.mock("docx-preview", () => ({ renderAsync: renderAsyncMock }));

function segment(
  id: string,
  ordinal: number,
  structuralPath: string,
  source: string,
  target = "",
  state: SegmentState = target ? "confirmed" : "untranslated",
): Segment {
  return {
    id,
    documentId: "d1",
    ordinal,
    structuralPath,
    sourceText: source,
    targetText: target,
    state,
    revision: 1,
    sourceHash: "hash",
    contextHash: "context",
    updatedAtMs: 1,
  };
}

const SEGMENTS = [
  segment("s1", 0, "p:0", "First sentence.", "第一句。"),
  segment("s2", 1, "p:0", "Second sentence.", "第二句。"),
  segment("s3", 2, "p:1", "Untranslated one."),
];

function renderDialog(
  overrides: Partial<Parameters<typeof PreviewDialog>[0]> = {},
) {
  return render(
    <PreviewDialog
      open
      documentId="d1"
      documentName="demo.docx"
      documentFormat="docx"
      segments={SEGMENTS}
      activeSegmentId={null}
      onClose={vi.fn()}
      onJump={vi.fn()}
      {...overrides}
    />,
  );
}

function installPreviewBridge(
  renderDocxPreview: DesktopApi["renderDocxPreview"],
) {
  const api: Partial<DesktopApi> = { renderDocxPreview };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
}

describe("PreviewDialog", () => {
  beforeEach(() => {
    renderAsyncMock.mockReset();
    renderAsyncMock.mockResolvedValue(undefined);
  });

  it("backfills targets and is honest about untranslated fallbacks", () => {
    renderDialog();
    expect(screen.getByText("第一句。")).toBeInTheDocument();
    expect(screen.getByText("第二句。")).toBeInTheDocument();
    // Untranslated segment shows source text, flagged as fallback.
    const fallback = screen.getByText("Untranslated one.");
    expect(fallback).toHaveAttribute("data-fallback", "true");
    expect(screen.getByText(/1 个未译（以源文回填显示）/)).toBeInTheDocument();
  });

  it("jumps back to the grid from a preview segment", async () => {
    const onJump = vi.fn();
    renderDialog({ onJump });
    await userEvent.click(screen.getByText("第二句。"));
    expect(onJump).toHaveBeenCalledWith("s2");
  });

  it("follows the active segment with a highlight and scroll", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    renderDialog({ activeSegmentId: "s2" });
    expect(screen.getByText("第二句。")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("第一句。")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("offers no layout tab for non-DOCX documents", () => {
    renderDialog({ documentFormat: "text", documentName: "notes.txt" });
    expect(
      screen.queryByRole("tab", { name: /版式视图/ }),
    ).not.toBeInTheDocument();
  });

  it("renders the layout view through the real export pipeline", async () => {
    const data = new ArrayBuffer(8);
    const renderDocxPreview = vi
      .fn()
      .mockResolvedValue({ ok: true, data, translatedSegments: 2 });
    installPreviewBridge(renderDocxPreview);
    renderDialog();
    await userEvent.click(screen.getByRole("tab", { name: /版式视图/ }));
    await waitFor(() => {
      expect(screen.getByText(/已回填 2 个已译单元/)).toBeInTheDocument();
    });
    expect(renderDocxPreview).toHaveBeenCalledWith("d1");
    expect(renderAsyncMock).toHaveBeenCalledTimes(1);
    expect(renderAsyncMock.mock.calls[0]?.[0]).toBe(data);
  });

  it("shows an honest error when the export pipeline refuses", async () => {
    installPreviewBridge(
      vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "exportBlocked", message: "导出被拒绝" },
      }),
    );
    renderDialog();
    await userEvent.click(screen.getByRole("tab", { name: /版式视图/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "版式预览生成失败：导出被拒绝",
      );
    });
    expect(renderAsyncMock).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
