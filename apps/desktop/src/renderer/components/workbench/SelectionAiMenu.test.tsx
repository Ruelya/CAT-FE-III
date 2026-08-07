import { describe, expect, it } from "vitest";

import { canOpenSelectionAiMenu } from "./SelectionAiMenu";

describe("canOpenSelectionAiMenu", () => {
  it("opens only when enabled, not composing, and selection non-empty", () => {
    expect(
      canOpenSelectionAiMenu({
        enabled: true,
        composing: false,
        selectionText: "hello",
      }),
    ).toBe(true);
    expect(
      canOpenSelectionAiMenu({
        enabled: false,
        composing: false,
        selectionText: "hello",
      }),
    ).toBe(false);
    expect(
      canOpenSelectionAiMenu({
        enabled: true,
        composing: true,
        selectionText: "hello",
      }),
    ).toBe(false);
    expect(
      canOpenSelectionAiMenu({
        enabled: true,
        composing: false,
        selectionText: "   ",
      }),
    ).toBe(false);
  });
});
