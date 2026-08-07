import { describe, expect, it } from "vitest";

import { tokenize, wordDiff } from "./wordDiff";

describe("tokenize", () => {
  it("splits on whitespace runs", () => {
    expect(tokenize("hello world")).toEqual(["hello", " ", "world"]);
  });

  it("keeps CJK runs intact", () => {
    expect(tokenize("供应商 应")).toEqual(["供应商", " ", "应"]);
  });

  it("returns empty for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("wordDiff", () => {
  it("returns plain equal when strings match", () => {
    expect(wordDiff("same text", "same text")).toEqual([
      { kind: "equal", text: "same text" },
    ]);
  });

  it("returns empty for both empty", () => {
    expect(wordDiff("", "")).toEqual([]);
  });

  it("marks single substitution", () => {
    const tokens = wordDiff("the cat sat", "the dog sat");
    expect(tokens.filter((t) => t.kind === "equal").map((t) => t.text)).toEqual(
      ["the ", " sat"],
    );
    expect(tokens.some((t) => t.kind === "delete" && t.text === "dog")).toBe(
      true,
    );
    expect(tokens.some((t) => t.kind === "insert" && t.text === "cat")).toBe(
      true,
    );
  });

  it("marks insertion (in active, not in match)", () => {
    const tokens = wordDiff("hello beautiful world", "hello world");
    expect(tokens.some((t) => t.kind === "insert" && t.text.includes("beautiful"))).toBe(
      true,
    );
    expect(tokens.some((t) => t.kind === "delete")).toBe(false);
  });

  it("marks deletion (in match, not in active)", () => {
    const tokens = wordDiff("hello world", "hello extra world");
    expect(tokens.some((t) => t.kind === "delete" && t.text.includes("extra"))).toBe(
      true,
    );
  });
});
