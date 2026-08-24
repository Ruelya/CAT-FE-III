import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { usePdfReview } from "./use-pdf-review";

function gateway(
  engine: FakeEngineState,
  overrides: Partial<{
    documentId: string | null;
    activeSegmentId: string | null;
    generation: number;
  }> = {},
) {
  return {
    generation: overrides.generation ?? 1,
    mutationsEnabled: true,
    documentId: overrides.documentId ?? "doc-1",
    projectId: "proj-1",
    activeSegmentId: overrides.activeSegmentId ?? "seg-1",
    flushOrStay: async () => true,
    onSegmentCorrected: async () => {
      /* refresh stub */
    },
  };
}

describe("usePdfReview", () => {
  let engine: FakeEngineState;

  beforeEach(() => {
    engine = createFakeEngineState({
      segments: [
        {
          id: "seg-1",
          documentId: "doc-1",
          ordinal: 1,
          revision: 1,
          sourceText: "OCR text",
          targetText: "",
          state: "untranslated",
          contextHash: "c",
          sourceHash: "s",
          structuralPath: "1",
          updatedAtMs: 1,
        },
      ],
      pdfPagesByDocument: {
        "doc-1": [
          {
            page: 1,
            width: 100,
            height: 100,
            imagePngBase64: "aaa",
            ocrBlockCount: 1,
            segmentIds: ["seg-1"],
            blocks: [
              {
                segmentId: "seg-1",
                sourceKind: "ocr",
                state: "untranslated",
                sourceText: "OCR text",
                targetText: "",
                revision: 1,
                kind: "text",
                confidence: 0.9,
                bbox: { x: 0, y: 0, width: 50, height: 20 },
              },
            ],
          },
        ],
      },
    });
    window.translunar = createFakeDesktopApi(engine);
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("lists pages and loads one page image", async () => {
    const { result } = renderHook(() => usePdfReview(gateway(engine)));

    await waitFor(() => {
      expect(result.current.state.listStatus).toBe("ready");
      expect(result.current.hasPages).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.state.pageStatus).toBe("ready");
    });
    expect(result.current.state.pageImageUrl).toContain("base64,aaa");
    expect(
      engine.calls.filter((c) => c.method === "pdf.page.get"),
    ).toHaveLength(1);
  });

  it("stops page gets when collapsed", async () => {
    const { result } = renderHook(() => usePdfReview(gateway(engine)));
    await waitFor(() => expect(result.current.state.pageStatus).toBe("ready"));

    const before = engine.calls.filter(
      (c) => c.method === "pdf.page.get",
    ).length;

    await act(async () => {
      result.current.setDockMode("collapsed");
    });
    await act(async () => {
      result.current.selectPage(1);
    });

    const after = engine.calls.filter(
      (c) => c.method === "pdf.page.get",
    ).length;
    expect(after).toBe(before);
  });

  it("corrects OCR and rejects blank corrected text", async () => {
    const { result } = renderHook(() => usePdfReview(gateway(engine)));
    await waitFor(() => expect(result.current.state.pageStatus).toBe("ready"));

    const block = result.current.state.pageDetail!.blocks[0]!;
    await act(async () => {
      result.current.openCorrect(block);
      result.current.setCorrectSourceText("  ");
    });
    expect(result.current.canSubmitCorrect).toBe(false);

    await act(async () => {
      await result.current.submitCorrect();
    });
    expect(engine.calls.some((c) => c.method === "pdf.correctOcr")).toBe(false);

    await act(async () => {
      result.current.setCorrectSourceText("Fixed");
      await result.current.submitCorrect();
    });
    await waitFor(() => {
      expect(engine.calls.some((c) => c.method === "pdf.correctOcr")).toBe(
        true,
      );
    });
    expect(engine.segments[0]?.sourceText).toBe("Fixed");
  });

  it("surfaces stale revision conflict without optimistic bump", async () => {
    engine.failMethods.add("pdf.correctOcr");
    engine.failMethods.delete("pdf.correctOcr");
    // Force conflict by bumping expected revision in segment
    engine.segments[0]!.revision = 9;

    const { result } = renderHook(() => usePdfReview(gateway(engine)));
    await waitFor(() => expect(result.current.state.pageStatus).toBe("ready"));
    // Block still has revision 1 from page get
    const block = result.current.state.pageDetail!.blocks[0]!;
    await act(async () => {
      result.current.openCorrect(block);
      result.current.setCorrectSourceText("X");
      await result.current.submitCorrect();
    });
    await waitFor(() => {
      expect(result.current.state.correctError?.code).toBe("REVISION_CONFLICT");
    });
    expect(result.current.state.correctOpen).toBe(true);
  });

  it("maps non-PDF list InvalidRequest to empty-ready (no error dock)", async () => {
    const api = createFakeDesktopApi(engine);
    const originalInvoke = api.invoke.bind(api);
    api.invoke = async (method, params) => {
      if (method === "pdf.page.list") {
        // Engine failures reach the renderer as `{ code, message }`; an Error
        // carrying `code` satisfies the same duck type that toUiError reads.
        return Promise.reject(
          Object.assign(new Error("pdf.page.list requires a PDF document"), {
            code: "invalid_request",
          }),
        );
      }
      return originalInvoke(method, params);
    };
    window.translunar = api;

    const { result } = renderHook(() => usePdfReview(gateway(engine)));
    await waitFor(() => {
      expect(result.current.state.listStatus).toBe("ready");
    });
    expect(result.current.hasPages).toBe(false);
    expect(result.current.state.listError).toBeNull();
    expect(result.current.state.pages).toEqual([]);
  });

  it("keeps listStatus error for real pdf.page.list failures", async () => {
    engine.failMethods.add("pdf.page.list");

    const { result } = renderHook(() => usePdfReview(gateway(engine)));
    await waitFor(() => {
      expect(result.current.state.listStatus).toBe("error");
    });
    expect(result.current.hasPages).toBe(false);
    expect(result.current.state.listError).not.toBeNull();
    expect(result.current.state.listError?.message).toContain("pdf.page.list");
  });
});
