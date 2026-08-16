import { describe, expect, it } from "vitest";

import { isOcrStructuralPath, structureLabel } from "./structure-label";

describe("isOcrStructuralPath", () => {
  it("recognises Engine PDF OCR units", () => {
    expect(
      isOcrStructuralPath("pdf:p=1;b=0;k=text;x=1;y=2;w=3;h=4;s=ocr;c=80"),
    ).toBe(true);
    expect(isOcrStructuralPath("pdf:p=1;b=0;k=text")).toBe(false);
    expect(isOcrStructuralPath("word/document.xml#p:12")).toBe(false);
  });
});

describe("structureLabel", () => {
  it("labels OCR and PDF paths before the generic fallback", () => {
    expect(
      structureLabel("pdf:p=1;b=0;k=text;x=1;y=2;w=3;h=4;s=ocr;c=80"),
    ).toBe("OCR");
    expect(structureLabel("pdf:p=1;b=0;k=text")).toBe("PDF");
    expect(structureLabel("word/document.xml#p:12")).toBe("¶");
  });

  it("keeps format fallbacks short enough for the CTX column", () => {
    expect(structureLabel("txt:bytes:0-80")).toBe("txt");
    expect(structureLabel("html:text:h1")).toBe("html");
    expect(structureLabel("md:paragraph:3")).toBe("md");
  });
});
