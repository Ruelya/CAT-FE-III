import { describe, expect, it } from "vitest";
import type {
  PluginCapabilityRequestView,
  PluginContributionDescriptor,
} from "@translunar/contracts";

import {
  countContributionKinds,
  isUnenforceableCapability,
  mapPermissionDecision,
  permissionRowsFromRequests,
  showTier3Honesty,
  tierLabelKey,
} from "./plugin-permission-presenters";

describe("plugin-permission-presenters", () => {
  it("counts contribution kinds", () => {
    const contributions = [
      { kind: "qaRule" },
      { kind: "uiPanel" },
      { kind: "aiAction" },
      { kind: "aiAction" },
      { kind: "filter" },
    ] as PluginContributionDescriptor[];
    const counts = countContributionKinds(contributions);
    expect(counts.total).toBe(5);
    expect(counts.aiAction).toBe(2);
    expect(counts.qaRule).toBe(1);
    expect(counts.uiPanel).toBe(1);
    expect(counts.filter).toBe(1);
  });

  it("maps decisions including unknown/null", () => {
    expect(mapPermissionDecision("granted", true)).toBe("granted");
    expect(mapPermissionDecision("denied", true)).toBe("denied");
    expect(mapPermissionDecision(null, true)).toBe("not-requested");
    expect(mapPermissionDecision("granted", "unknown")).toBe("unknown");
    expect(mapPermissionDecision(undefined, false)).toBe("not-requested");
  });

  it("flags unenforceable capabilities and tier 3 honesty", () => {
    expect(isUnenforceableCapability("file.read")).toBe(true);
    expect(isUnenforceableCapability("network.connect")).toBe(true);
    expect(isUnenforceableCapability("qa.register")).toBe(false);
    expect(isUnenforceableCapability("qa.register", false)).toBe(true);
    expect(showTier3Honesty({ tier: "process" })).toBe(true);
    expect(showTier3Honesty({ tier: "sandbox" })).toBe(false);
    expect(tierLabelKey("process")).toBe("plugins.tier.process");
  });

  it("builds permission rows from requests", () => {
    const requests = [
      {
        id: "r1",
        capabilityId: "file.read",
        contributionId: "c1",
        decision: "granted",
        requestedScope: { kind: "paths", paths: [] },
        supported: true,
      },
    ] as unknown as PluginCapabilityRequestView[];
    const rows = permissionRowsFromRequests(requests);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unenforceable).toBe(true);
    expect(rows[0]?.decision).toBe("granted");
    expect(permissionRowsFromRequests(undefined)).toEqual([]);
  });
});
