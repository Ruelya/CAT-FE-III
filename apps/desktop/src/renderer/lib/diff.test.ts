import { describe, expect, it } from "vitest";

import { diffChars } from "./diff.js";

describe("diffChars", () => {
  it("returns a single equal part for identical strings", () => {
    expect(diffChars("同一句", "同一句")).toEqual([
      { kind: "equal", text: "同一句" },
    ]);
    expect(diffChars("", "")).toEqual([]);
  });

  it("marks pure insertion when the base is empty", () => {
    expect(diffChars("", "新译文")).toEqual([
      { kind: "insert", text: "新译文" },
    ]);
  });

  it("keeps the common core and isolates the edit", () => {
    const parts = diffChars("保留期为 30 天。", "保留期为 60 天。");
    expect(parts.filter((part) => part.kind === "delete")).toEqual([
      { kind: "delete", text: "3" },
    ]);
    expect(parts.filter((part) => part.kind === "insert")).toEqual([
      { kind: "insert", text: "6" },
    ]);
    const joined = parts
      .filter((part) => part.kind !== "delete")
      .map((part) => part.text)
      .join("");
    expect(joined).toBe("保留期为 60 天。");
  });

  it("survives placeholder-heavy edits", () => {
    const parts = diffChars("点击 {button} 继续。", "点击按钮继续。");
    const deleted = parts
      .filter((part) => part.kind === "delete")
      .map((part) => part.text)
      .join("");
    expect(deleted).toContain("{button}");
  });

  it("falls back to whole-string replace beyond the size guard", () => {
    const before = "甲".repeat(600);
    const after = "乙".repeat(600);
    expect(diffChars(before, after)).toEqual([
      { kind: "delete", text: before },
      { kind: "insert", text: after },
    ]);
  });
});
