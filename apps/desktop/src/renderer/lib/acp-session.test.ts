import { describe, expect, it } from "vitest";

import { acpPromptText, textPrompt } from "./acp-session";

describe("acp session helpers", () => {
  it("joins text content blocks", () => {
    expect(
      acpPromptText([
        { type: "text", text: "Term for" },
        { type: "text", text: "power station" },
      ]),
    ).toBe("Term for\npower station");
  });

  it("wraps a user line as an ACP prompt", () => {
    expect(textPrompt("hello")).toEqual([{ type: "text", text: "hello" }]);
  });
});
