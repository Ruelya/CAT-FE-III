import { describe, expect, it } from "vitest";

import {
  hideFormattingCapsule,
  isRecognizedFormatting,
  readEditorDisplay,
  smartPastePlain,
  splitWhitespace,
  wrapWhitespaceHtml,
  writeEditorDisplay,
} from "./editor-display";

describe("isRecognizedFormatting", () => {
  it("treats bold and italic labels as formatting", () => {
    expect(isRecognizedFormatting("b")).toBe(true);
    expect(isRecognizedFormatting("<i>")).toBe(true);
    expect(isRecognizedFormatting("ph")).toBe(false);
  });
});

describe("hideFormattingCapsule", () => {
  it("hides recognized pairs only in formatted mode", () => {
    expect(hideFormattingCapsule("start", "b", "formatted", false)).toBe(true);
    expect(hideFormattingCapsule("end", "b", "formatted", false)).toBe(true);
    expect(hideFormattingCapsule("start", "b", "full", false)).toBe(false);
    expect(hideFormattingCapsule("standalone", "ph", "formatted", false)).toBe(
      false,
    );
    expect(hideFormattingCapsule("start", "b", "formatted", true)).toBe(false);
  });
});

describe("smartPastePlain", () => {
  it("drops a leading space when the caret already sits after one", () => {
    expect(smartPastePlain("ab cd", 3, 3, " xx")).toBe("xx");
  });

  it("drops a trailing space before punctuation", () => {
    expect(smartPastePlain("ab.", 2, 2, "xx ")).toBe("xx");
  });
});

describe("splitWhitespace", () => {
  it("keeps ordinary text together and splits spaces", () => {
    expect(splitWhitespace("a b\u00a0c\td")).toEqual([
      { kind: "text", text: "a" },
      { kind: "space", text: " " },
      { kind: "text", text: "b" },
      { kind: "nbsp", text: "\u00a0" },
      { kind: "text", text: "c" },
      { kind: "tab", text: "\t" },
      { kind: "text", text: "d" },
    ]);
  });
});

describe("wrapWhitespaceHtml", () => {
  it("leaves escaped text alone when the switch is off", () => {
    expect(wrapWhitespaceHtml("a b", false)).toBe("a b");
  });

  it("wraps spaces so serialize still sees a real space", () => {
    expect(wrapWhitespaceHtml("a b", true)).toContain("data-ws=\"space\"");
    expect(wrapWhitespaceHtml("a b", true)).toContain("> <");
  });
});

describe("editor display storage", () => {
  it("round-trips a preference object", () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    writeEditorDisplay(
      { formatting: "formatted", tagText: "none", whitespace: true },
      fake,
    );
    expect(readEditorDisplay(fake)).toEqual({
      formatting: "formatted",
      tagText: "none",
      whitespace: true,
    });
  });
});
