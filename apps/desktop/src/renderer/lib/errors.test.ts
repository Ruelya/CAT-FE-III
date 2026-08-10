import { describe, expect, it } from "vitest";

import { formatAiError, formatUiError, toUiError, type UiError } from "./errors";

describe("formatAiError", () => {
  it("formats policy_denied with profileId", () => {
    const err: UiError = {
      code: "policy_denied",
      message: "blocked",
      kind: "domain",
      details: { profileId: "prof-1", policy: "batch_disabled" },
    };
    const text = formatAiError(err);
    expect(text).toContain("Policy denied");
    expect(text).toContain("batch_disabled");
    expect(text).toContain("prof-1");
    expect(text).toContain("policy_denied");
  });

  it("includes profileId for other AI codes", () => {
    const err: UiError = {
      code: "AI_PROVIDER_ERROR",
      message: "timeout",
      kind: "domain",
      details: { profileId: "p2" },
    };
    expect(formatAiError(err)).toContain("profile p2");
  });

  it("falls back to formatUiError without structured fields", () => {
    const err = toUiError({ code: "X", message: "y" });
    expect(formatAiError(err)).toBe(formatUiError(err));
  });
});
