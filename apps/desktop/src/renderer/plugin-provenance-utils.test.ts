import type {
  PluginCapabilityRequestView,
  PluginContributionDescriptor,
  QaIssueView,
  QaRun,
} from "@translunar/contracts";
import { describe, expect, it } from "vitest";

import {
  findContributionPermission,
  findQaRuleSnapshot,
  formatDescriptorValue,
  listExecutableContributions,
} from "./plugin-provenance-utils";

describe("plugin provenance presentation helpers", () => {
  const qaContribution = {
    kind: "qaRule",
    id: "example.qa",
    displayName: "Example QA",
    version: "2.0.0",
    descriptorVersion: 1,
    definition: {},
    ruleType: "mechanical",
    severity: "warning",
  } satisfies PluginContributionDescriptor;
  const pipelineContribution = {
    kind: "pipelineStep",
    id: "example.pipeline",
    displayName: "Example pipeline",
    version: "3.0.0",
    descriptorVersion: 1,
    configSchemaVersion: 1,
    input: "segments",
    output: "json",
    resumable: true,
    cancellable: true,
  } satisfies PluginContributionDescriptor;

  it("keeps only public QA and pipeline descriptors", () => {
    const filter = {
      kind: "filter",
      id: "example.filter",
      displayName: "Filter",
      version: "1.0.0",
      descriptorVersion: 1,
      extensions: ["txt"],
      capabilities: {
        degradationReport: false,
        export: true,
        import: true,
        inlineTags: false,
        notes: false,
        probe: false,
        validate: false,
      },
    } satisfies PluginContributionDescriptor;

    expect(
      listExecutableContributions([
        filter,
        qaContribution,
        pipelineContribution,
      ]).map((item) => item.id),
    ).toEqual(["example.qa", "example.pipeline"]);
  });

  it("matches only the exact capability and contribution request", () => {
    const qaGrant = permission("qa.register", "example.qa", "granted");
    const broadPipelineGrant = permission("pipeline.register", null, "granted");
    const requests = [qaGrant, broadPipelineGrant];

    expect(findContributionPermission(requests, qaContribution)).toBe(qaGrant);
    expect(findContributionPermission(requests, pipelineContribution)).toBe(
      null,
    );
    expect(findContributionPermission(undefined, qaContribution)).toBe(
      undefined,
    );
  });

  it("joins a finding only to provenance from its own run and rule", () => {
    const snapshot = {
      contributionIndex: 0,
      executionCount: 1,
      findingCount: 1,
      inputHash: "input",
      outputHash: "output",
      status: "succeeded" as const,
      usage: { inputBytes: 10, outputBytes: 5, workUnits: 1 },
      provenance: {
        activationRevision: 7,
        configHash: "config",
        configSchemaVersion: 1,
        contributionId: "example.qa",
        contributionVersion: "2.0.0",
        descriptorHash: "descriptor",
        descriptorVersion: 1,
        operationProtocolVersion: 1,
        pluginId: "example.plugin",
        ruleIds: ["example.qa/style"],
        tier: "process",
        versionId: "version-2",
      },
    };
    const run = { id: "run-2", pluginRules: [snapshot] } as QaRun;
    const issue = {
      runId: "run-2",
      ruleId: "example.qa/style",
    } as QaIssueView;

    expect(findQaRuleSnapshot([run], issue)).toBe(snapshot);
    expect(findQaRuleSnapshot([{ ...run, id: "other" }], issue)).toBeNull();
  });

  it("formats closed descriptor values without throwing", () => {
    expect(formatDescriptorValue("segments")).toBe("segments");
    expect(formatDescriptorValue({ kind: "json" })).toBe('{"kind":"json"}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatDescriptorValue(cyclic)).toBe("--");
  });
});

function permission(
  capabilityId: string,
  contributionId: string | null,
  decision: PluginCapabilityRequestView["decision"],
): PluginCapabilityRequestView {
  return {
    actor: "tester",
    capabilityId,
    contributionId,
    createdAtMs: 1,
    decision,
    effectKey: capabilityId,
    grantedScope: { kind: "contributions", contributionIds: ["example.qa"] },
    id: `${capabilityId}:${contributionId ?? "all"}`,
    pluginId: "example.plugin",
    reason: "test",
    requestedScope: {
      kind: "contributions",
      contributionIds: [contributionId ?? "example.qa"],
    },
    required: true,
    revision: 1,
    risk: "medium",
    supported: true,
    updatedAtMs: 1,
    versionId: "version-1",
  };
}
