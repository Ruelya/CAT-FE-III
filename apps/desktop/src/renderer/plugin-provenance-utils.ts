import type {
  PluginCapabilityRequestView,
  PluginContributionDescriptor,
  QaIssueView,
  QaRun,
  QaRunPluginRuleSnapshot,
} from "@translunar/contracts";

export type ExecutablePluginContribution = Extract<
  PluginContributionDescriptor,
  { kind: "qaRule" | "pipelineStep" }
>;

export function listExecutableContributions(
  contributions: readonly PluginContributionDescriptor[] | null | undefined,
): ExecutablePluginContribution[] {
  return (contributions ?? []).filter(
    (contribution): contribution is ExecutablePluginContribution =>
      contribution.kind === "qaRule" || contribution.kind === "pipelineStep",
  );
}

export function findContributionPermission(
  requests: readonly PluginCapabilityRequestView[] | null | undefined,
  contribution: ExecutablePluginContribution,
): PluginCapabilityRequestView | null | undefined {
  if (requests == null) return undefined;
  const capabilityId =
    contribution.kind === "qaRule" ? "qa.register" : "pipeline.register";
  return (
    requests.find(
      (request) =>
        request.capabilityId === capabilityId &&
        request.contributionId === contribution.id,
    ) ?? null
  );
}

export function findQaRuleSnapshot(
  runs: readonly QaRun[],
  issue: QaIssueView | null,
): QaRunPluginRuleSnapshot | null {
  if (!issue?.runId) return null;
  const run = runs.find((candidate) => candidate.id === issue.runId);
  return (
    run?.pluginRules?.find((snapshot) =>
      snapshot.provenance.ruleIds.includes(issue.ruleId),
    ) ?? null
  );
}

export function formatDescriptorValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "--";
  try {
    return JSON.stringify(value) ?? "--";
  } catch {
    return "--";
  }
}
