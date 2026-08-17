import { describe, expect, it } from "vitest";

import {
  normalizePdfImportOptions,
  readPdfImportOptions,
  toBatchImportOptions,
  writePdfImportOptions,
} from "./pdf-import-options";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("normalizePdfImportOptions", () => {
  it("falls back to auto for unknown engine/mode values", () => {
    expect(
      normalizePdfImportOptions({
        ocrEngine: "mineruu" as never,
        ocrMode: "sometimes" as never,
        ocrLanguages: "  ",
      }),
    ).toEqual({
      ocrEngine: "auto",
      ocrMode: "auto",
      ocrLanguages: "  ",
      mineruBaseUrl: "https://mineru.net/api/v4",
    });
  });

  it("keeps closed-enum MinerU choices", () => {
    expect(
      normalizePdfImportOptions({
        ocrEngine: "mineru",
        ocrMode: "always",
        ocrLanguages: "ch",
      }),
    ).toEqual({
      ocrEngine: "mineru",
      ocrMode: "always",
      ocrLanguages: "ch",
      mineruBaseUrl: "https://mineru.net/api/v4",
    });
  });
});

describe("pdf import options storage", () => {
  it("round-trips a preference object", () => {
    const storage = memoryStorage();
    writePdfImportOptions(
      { ocrEngine: "tesseract", ocrMode: "never", ocrLanguages: "eng+chi_sim" },
      storage,
    );
    expect(readPdfImportOptions(storage)).toEqual({
      ocrEngine: "tesseract",
      ocrMode: "never",
      ocrLanguages: "eng+chi_sim",
      mineruBaseUrl: "https://mineru.net/api/v4",
    });
  });

  it("returns defaults when storage is empty or corrupt", () => {
    expect(readPdfImportOptions(memoryStorage())).toEqual({
      ocrEngine: "auto",
      ocrMode: "auto",
      ocrLanguages: "eng",
      mineruBaseUrl: "https://mineru.net/api/v4",
    });
    expect(
      readPdfImportOptions(memoryStorage({ "translunar.renderer.pdf-import-options.v1": "{" })),
    ).toEqual({
      ocrEngine: "auto",
      ocrMode: "auto",
      ocrLanguages: "eng",
      mineruBaseUrl: "https://mineru.net/api/v4",
    });
  });
});

describe("toBatchImportOptions", () => {
  it("emits the Engine option keys", () => {
    expect(
      toBatchImportOptions({
        ocrEngine: "mineru",
        ocrMode: "auto",
        ocrLanguages: "ch",
      }),
    ).toEqual({
      ocrEngine: "mineru",
      ocrMode: "auto",
      ocrLanguages: "ch",
      mineruBaseUrl: "https://mineru.net/api/v4",
    });
    expect(
      toBatchImportOptions({
        ocrEngine: "auto",
        ocrMode: "auto",
        ocrLanguages: "   ",
      }).ocrLanguages,
    ).toBe("eng");
  });
});
