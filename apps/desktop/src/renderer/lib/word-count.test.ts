import { describe, expect, it } from "vitest";

import { countWords } from "./word-count";

describe("countWords", () => {
  it("counts Latin tokens and CJK characters separately", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  power station  ")).toBe(2);
    expect(countWords("电站")).toBe(2);
    expect(countWords("power 电站")).toBe(3);
  });
});
