import { describe, expect, it } from "vitest";
import type { PdfPageSummary } from "@translunar/contracts";

import {
  buildSegmentPageIndex,
  canSubmitOcrCorrection,
  firstPageNumber,
  isNonPdfDocumentListError,
  isOcrCorrectable,
  nextDockMode,
  pageImageDataUrl,
  resolvePageForSegment,
  shouldMountPdfDock,
} from "./pdf-review";

function page(
  n: number,
  segmentIds: string[],
  ocrBlockCount = 0,
): PdfPageSummary {
  return {
    page: n,
    width: 100,
    height: 100,
    blockCount: segmentIds.length,
    ocrBlockCount,
    segmentIds,
  };
}

describe("pdf-review pure helpers", () => {
  it("indexes segment → page and resolves active page", () => {
    const pages = [page(1, ["a", "b"]), page(2, ["c"])];
    const index = buildSegmentPageIndex(pages);
    expect(index.get("a")).toBe(1);
    expect(index.get("c")).toBe(2);
    expect(resolvePageForSegment(index, "c", 1)).toBe(2);
    expect(resolvePageForSegment(index, "missing", 1)).toBe(1);
    expect(resolvePageForSegment(index, null, 3)).toBe(3);
    expect(firstPageNumber(pages)).toBe(1);
    expect(firstPageNumber([])).toBe(1);
  });

  it("builds data URL without inventing paths", () => {
    expect(pageImageDataUrl("abc")).toBe("data:image/png;base64,abc");
    expect(pageImageDataUrl("data:image/png;base64,xyz")).toBe(
      "data:image/png;base64,xyz",
    );
    expect(pageImageDataUrl("  ")).toBe("");
  });

  it("gates OCR correctability and submit", () => {
    expect(
      isOcrCorrectable({ sourceKind: "ocr", state: "untranslated" }),
    ).toBe(true);
    expect(isOcrCorrectable({ sourceKind: "ocr", state: "confirmed" })).toBe(
      false,
    );
    expect(
      isOcrCorrectable({ sourceKind: "text", state: "draft" }),
    ).toBe(false);
    expect(
      canSubmitOcrCorrection({
        sourceText: "hi",
        reason: "fix",
        pending: false,
      }),
    ).toBe(true);
    expect(
      canSubmitOcrCorrection({
        sourceText: "  ",
        reason: "fix",
        pending: false,
      }),
    ).toBe(false);
    expect(
      canSubmitOcrCorrection({
        sourceText: "hi",
        reason: "",
        pending: false,
      }),
    ).toBe(false);
    expect(
      canSubmitOcrCorrection({
        sourceText: "hi",
        reason: "fix",
        pending: true,
      }),
    ).toBe(false);
  });

  it("cycles dock modes", () => {
    expect(nextDockMode("collapsed")).toBe("docked");
    expect(nextDockMode("docked")).toBe("maximized");
    expect(nextDockMode("maximized")).toBe("collapsed");
  });

  it("classifies non-PDF list InvalidRequest vs real list failures", () => {
    expect(
      isNonPdfDocumentListError({
        code: "invalid_request",
        message: "pdf.page.list requires a PDF document",
      }),
    ).toBe(true);
    expect(
      isNonPdfDocumentListError({
        message: "Invalid document type for PDF page list",
      }),
    ).toBe(true);
    expect(
      isNonPdfDocumentListError({
        code: "storage_error",
        message: "failed to open PDF layout",
      }),
    ).toBe(false);
    expect(
      isNonPdfDocumentListError({
        code: "invalid_request",
        message: "limit must be between 1 and 500",
      }),
    ).toBe(false);
  });

  it("mounts dock for pages or real list errors, not non-PDF empty error", () => {
    expect(
      shouldMountPdfDock({
        pageCount: 2,
        listStatus: "ready",
        listError: null,
      }),
    ).toBe(true);
    expect(
      shouldMountPdfDock({
        pageCount: 0,
        listStatus: "ready",
        listError: null,
      }),
    ).toBe(false);
    expect(
      shouldMountPdfDock({
        pageCount: 0,
        listStatus: "error",
        listError: {
          code: "storage_error",
          message: "layout read failed",
        },
      }),
    ).toBe(true);
    expect(
      shouldMountPdfDock({
        pageCount: 0,
        listStatus: "error",
        listError: {
          code: "invalid_request",
          message: "pdf.page.list requires a PDF document",
        },
      }),
    ).toBe(false);
  });
});
