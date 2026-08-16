/** Last-used PDF OCR import options. Applied to every `project.batchImport`. */

export type PdfOcrEngine = "auto" | "mineru" | "tesseract";
export type PdfOcrMode = "auto" | "always" | "never";

export const DEFAULT_MINERU_BASE_URL = "https://mineru.net/api/v4";

export interface PdfImportOptions {
  ocrEngine: PdfOcrEngine;
  ocrMode: PdfOcrMode;
  ocrLanguages: string;
  /** Official Precision Extract or self-hosted mineru-api root. */
  mineruBaseUrl: string;
}

export const PDF_IMPORT_OPTIONS_KEY = "translunar.renderer.pdf-import-options.v1";

export const DEFAULT_PDF_IMPORT_OPTIONS: PdfImportOptions = {
  ocrEngine: "auto",
  ocrMode: "auto",
  ocrLanguages: "eng",
  mineruBaseUrl: DEFAULT_MINERU_BASE_URL,
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
  next: Partial<PdfImportOptions>,
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
    mineruBaseUrl: normalizeMineruBaseUrl(raw?.mineruBaseUrl),
  };
}

function normalizeMineruBaseUrl(raw: string | undefined): string {
  if (typeof raw !== "string") return DEFAULT_MINERU_BASE_URL;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_MINERU_BASE_URL;
  if (!/^https?:\/\//i.test(trimmed) || /\s/.test(trimmed)) {
    return DEFAULT_MINERU_BASE_URL;
  }
  return trimmed;
}

/** Closed-enum import options the Engine PDF/MinerU router already understands. */
export function toBatchImportOptions(
  prefs: Partial<PdfImportOptions> = readPdfImportOptions(),
): Record<string, string> {
  const normalized = normalizePdfImportOptions(prefs);
  const languages = normalized.ocrLanguages.trim();
  const options: Record<string, string> = {
    ocrEngine: normalized.ocrEngine,
    ocrMode: normalized.ocrMode,
    ocrLanguages: languages.length > 0 ? languages : "eng",
  };
  if (normalized.ocrEngine === "mineru") {
    options.mineruBaseUrl = normalized.mineruBaseUrl;
  }
  return options;
}
