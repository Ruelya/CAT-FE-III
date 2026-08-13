import type {
  PdfPageBlock,
  PdfPageSummary,
  SegmentState,
} from "@translunar/contracts";

/** Build segmentId → page number map from Engine page summaries. */
export function buildSegmentPageIndex(
  pages: readonly PdfPageSummary[],
): Map<string, number> {
  const index = new Map<string, number>();
  for (const page of pages) {
    for (const segmentId of page.segmentIds) {
      if (!index.has(segmentId)) {
        index.set(segmentId, page.page);
      }
    }
  }
  return index;
}

/** Resolve active page for a segment; fall back when segment has no mapping. */
export function resolvePageForSegment(
  index: Map<string, number>,
  segmentId: string | null,
  fallbackPage: number,
): number {
  if (!segmentId) return fallbackPage;
  return index.get(segmentId) ?? fallbackPage;
}

/** In-memory PNG data URL from Engine base64 (no filesystem path). */
export function pageImageDataUrl(imagePngBase64: string): string {
  const trimmed = imagePngBase64.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

/** OCR correction only for OCR-origin, non-confirmed blocks. */
export function isOcrCorrectable(block: {
  sourceKind: string;
  state: SegmentState;
}): boolean {
  if (block.state === "confirmed") return false;
  const kind = block.sourceKind.trim().toLowerCase();
  return kind === "ocr" || kind === "ocr_block" || kind === "pdf_ocr";
}

export function canSubmitOcrCorrection(input: {
  sourceText: string;
  reason: string;
  pending: boolean;
}): boolean {
  if (input.pending) return false;
  return input.sourceText.trim().length > 0 && input.reason.trim().length > 0;
}

/** First page number from summaries, or 1 when empty. */
export function firstPageNumber(pages: readonly PdfPageSummary[]): number {
  if (pages.length === 0) return 1;
  return pages[0]!.page;
}

/** Find block for segment on the loaded page. */
export function findBlockForSegment(
  blocks: readonly PdfPageBlock[],
  segmentId: string | null,
): PdfPageBlock | null {
  if (!segmentId) return null;
  return blocks.find((b) => b.segmentId === segmentId) ?? null;
}

export type PdfDockMode = "collapsed" | "docked" | "maximized";

export function nextDockMode(mode: PdfDockMode): PdfDockMode {
  if (mode === "collapsed") return "docked";
  if (mode === "docked") return "maximized";
  return "collapsed";
}

/**
 * Engine returns InvalidRequest ("invalid_request") when `pdf.page.list`
 * is called on a non-PDF document (`filter_id != builtin.pdf`).
 * That is not a dock-worthy failure — treat as empty/non-PDF.
 */
export function isNonPdfDocumentListError(error: {
  code?: string;
  message: string;
}): boolean {
  const message = error.message.trim().toLowerCase();
  if (!message) return false;
  // Engine: "pdf.page.list requires a PDF document"
  if (message.includes("requires a pdf")) return true;
  if (message.includes("not a pdf")) return true;
  if (message.includes("invalid document type")) return true;
  if (message.includes("non-pdf")) return true;
  // Engine code alone is too broad (many invalid_request causes).
  return false;
}

/** Whether Workbench should mount PDF dock / error chrome. */
export function shouldMountPdfDock(input: {
  pageCount: number;
  listStatus: "idle" | "loading" | "ready" | "error";
  listError: { code?: string; message: string } | null;
}): boolean {
  if (input.pageCount > 0) return true;
  if (input.listStatus !== "error") return false;
  // Empty + non-PDF type rejection → hide (no error chrome).
  if (input.listError && isNonPdfDocumentListError(input.listError)) {
    return false;
  }
  // Real list failure after PDF type / I/O / layout → thin error chrome.
  return true;
}
