import { describe, expect, it } from "vitest";

import {
  canDisablePlugin,
  canEnablePlugin,
  isContributionOpenable,
  isPanelSessionUrl,
  projectAiActionSchema,
  requireActorReason,
  sessionMatchesRevocation,
} from "./plugin-view";

describe("plugin-view", () => {
  it("projects AI action schema and rejects json fields", () => {
    const ok = projectAiActionSchema([
      { key: "tone", label: "Tone", fieldType: "text", required: true },
    ]);
    expect(ok.ok).toBe(true);
    const bad = projectAiActionSchema([
      { key: "raw", label: "Raw", fieldType: "json" },
    ]);
    expect(bad).toEqual({
      ok: false,
      reason: "unsupported",
      unsupportedKeys: ["raw"],
    });
  });

  it("guards lifecycle, actor/reason, panels", () => {
    expect(canEnablePlugin("disabled")).toBe(true);
    expect(canDisablePlugin("enabled")).toBe(true);
    expect(isContributionOpenable("active")).toBe(true);
    expect(isContributionOpenable("detached")).toBe(false);
    expect(requireActorReason("", "x")).toEqual({ ok: false, field: "actor" });
    expect(requireActorReason("a", "  ")).toEqual({
      ok: false,
      field: "reason",
    });
    expect(requireActorReason("a", "r")).toEqual({ ok: true });
    expect(isPanelSessionUrl("translunar-plugin://x")).toBe(true);
    expect(isPanelSessionUrl("https://evil")).toBe(false);
    expect(sessionMatchesRevocation({ pluginId: "p1" }, null)).toBe(true);
    expect(sessionMatchesRevocation({ pluginId: "p1" }, "p2")).toBe(false);
  });
});
