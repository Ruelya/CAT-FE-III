/** Last-used PDF OCR import options. Applied to every `project.batchImport`. */

export type PdfOcrEngine = "auto" | "mineru" | "tesseract";
export type PdfOcrMode = "auto" | "always" | "never";

export interface PdfImportOptions {
  ocrEngine: PdfOcrEngine;
  ocrMode: PdfOcrMode;
  ocrLanguages: string;
}

export const PDF_IMPORT_OPTIONS_KEY = "translunar.renderer.pdf-import-options.v1";

export const DEFAULT_PDF_IMPORT_OPTIONS: PdfImportOptions = {
  ocrEngine: "auto",
  ocrMode: "auto",
  ocrLanguages: "eng",
};

export function readPdfImportOptions(
  storage: Pick<Storage, "getItem"> = localStorage,
): PdfImportOptions {
  try {
    const raw = storage.getItem(PDF_IMPORT_OPTIONS_KEY);
    if (!raw) return { ...DEFAULT_PDF_IMPORT_OPTIONS };
    const parsed = JSON.parse(raw) as Partial<PdfImportOptions>;
    return normalizePdfImportOptions(parsed);
  } catch {
    return { ...DEFAULT_PDF_IMPORT_OPTIONS };
  }
}

export function writePdfImportOptions(
  next: PdfImportOptions,
  storage: Pick<Storage, "setItem"> = localStorage,
): PdfImportOptions {
  const normalized = normalizePdfImportOptions(next);
  storage.setItem(PDF_IMPORT_OPTIONS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function normalizePdfImportOptions(
  raw: Partial<PdfImportOptions> | null | undefined,
): PdfImportOptions {
  return {
    ocrEngine:
      raw?.ocrEngine === "mineru" || raw?.ocrEngine === "tesseract"
        ? raw.ocrEngine
        : "auto",
    ocrMode:
      raw?.ocrMode === "always" || raw?.ocrMode === "never"
        ? raw.ocrMode
        : "auto",
    ocrLanguages:
      typeof raw?.ocrLanguages === "string" ? raw.ocrLanguages : "eng",
  };
}

/** Closed-enum import options the Engine PDF/MinerU router already understands. */
export function toBatchImportOptions(
  prefs: PdfImportOptions = readPdfImportOptions(),
): Record<string, string> {
  const normalized = normalizePdfImportOptions(prefs);
  const languages = normalized.ocrLanguages.trim();
  return {
    ocrEngine: normalized.ocrEngine,
    ocrMode: normalized.ocrMode,
    ocrLanguages: languages.length > 0 ? languages : "eng",
  };
}
