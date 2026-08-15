import { describe, expect, it } from "vitest";

import {
  AI_COMPLETE_MARKER,
  attachCompletion,
  buildCompletePrompt,
  completionSuffix,
  firstAcceptUnit,
  isCompletePrompt,
  livePrefix,
} from "./inline-completion";

describe("completionSuffix", () => {
  it("returns the untyped tail of a matching candidate", () => {
    expect(completionSuffix("power supply", "pow")).toBe("er supply");
    expect(completionSuffix("battery capacity", "Batt")).toBe("ery capacity");
  });

  it("is empty when the candidate is already typed or does not match", () => {
    expect(completionSuffix("power", "power")).toBe("");
    expect(completionSuffix("power", "")).toBe("");
    expect(completionSuffix("station", "pow")).toBe("");
  });
});

describe("livePrefix", () => {
  it("reads only the word being typed", () => {
    expect(livePrefix("hello wor", 9)).toBe("wor");
    expect(livePrefix("hello ", 6)).toBe("");
  });

  it("caps scripts without spaces", () => {
    const text = "电池容量为一千零二十四瓦时";
    expect(livePrefix(text, [...text].length, 4).length).toBe(4);
  });
});

describe("attachCompletion", () => {
  it("strips the typed prefix from a full continuation", () => {
    expect(attachCompletion("pow completed", "pow", 3)).toBe(" completed");
  });

  it("accepts a bare suffix", () => {
    expect(attachCompletion("er supply", "pow", 3)).toBe("er supply");
  });

  it("drops whole-segment fake translate shapes", () => {
    expect(attachCompletion("AI translate: source", "pow", 3)).toBe("");
    expect(attachCompletion("Corrected: INV-1", "pow", 3)).toBe("");
  });

  it("drops a proposal that only repeats the live draft", () => {
    expect(attachCompletion("pow", "pow", 3)).toBe("");
  });
});

describe("firstAcceptUnit", () => {
  it("takes the next whitespace-delimited word, keeping a leading space", () => {
    expect(firstAcceptUnit("er supply")).toBe("er");
    expect(firstAcceptUnit(" completed now")).toBe(" completed");
  });

  it("takes the next CJK character", () => {
    expect(firstAcceptUnit("电源站")).toBe("电");
  });
});

describe("buildCompletePrompt", () => {
  it("embeds the live draft and caret marker", () => {
    const prompt = buildCompletePrompt("hello world", 5);
    expect(isCompletePrompt(prompt)).toBe(true);
    expect(prompt).toContain(`hello${AI_COMPLETE_MARKER} world`);
  });
});
