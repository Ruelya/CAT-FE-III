import type {
  PluginCapabilityRequestView,
  PluginContributionDescriptor,
  PluginSummary,
  PluginTier,
} from "@translunar/contracts";

export type PermissionDecisionChip =
  | "granted"
  | "denied"
  | "not-requested"
  | "unknown";

export type ContributionKindCountKey =
  | "filter"
  | "qaRule"
  | "uiPanel"
  | "aiAction"
  | "pipelineStep"
  | "engineConnector"
  | "other";

export interface ContributionKindCounts {
  filter: number;
  qaRule: number;
  uiPanel: number;
  aiAction: number;
  pipelineStep: number;
  engineConnector: number;
  other: number;
  total: number;
}

export function countContributionKinds(
  contributions: readonly PluginContributionDescriptor[] | null | undefined,
): ContributionKindCounts {
  const counts: ContributionKindCounts = {
    filter: 0,
    qaRule: 0,
    uiPanel: 0,
    aiAction: 0,
    pipelineStep: 0,
    engineConnector: 0,
    other: 0,
    total: 0,
  };
  for (const c of contributions ?? []) {
    counts.total += 1;
    switch (c.kind) {
      case "filter":
        counts.filter += 1;
        break;
      case "qaRule":
        counts.qaRule += 1;
        break;
      case "uiPanel":
        counts.uiPanel += 1;
        break;
      case "aiAction":
        counts.aiAction += 1;
        break;
      case "pipelineStep":
        counts.pipelineStep += 1;
        break;
      case "engineConnector":
        counts.engineConnector += 1;
        break;
      default:
        counts.other += 1;
    }
  }
  return counts;
}

export function mapPermissionDecision(
  decision: string | null | undefined,
  requestPresent: boolean | "unknown",
): PermissionDecisionChip {
  if (requestPresent === "unknown") return "unknown";
  if (!requestPresent || decision === null || decision === undefined) {
    return "not-requested";
  }
  if (decision === "granted") return "granted";
  if (decision === "denied" || decision === "revoked") return "denied";
  if (decision === "pending") return "not-requested";
  return "unknown";
}

export function permissionRowsFromRequests(
  requests: readonly PluginCapabilityRequestView[] | null | undefined,
): Array<{
  requestId: string;
  capabilityId: string;
  contributionId: string | null;
  scopeKind: string;
  decision: PermissionDecisionChip;
  rawDecision: string | null;
  unenforceable: boolean;
}> {
  if (requests === null || requests === undefined) {
    return [];
  }
  return requests.map((request) => {
    const decision = mapPermissionDecision(request.decision, true);
    return {
      requestId: request.id,
      capabilityId: request.capabilityId,
      contributionId: request.contributionId ?? null,
      scopeKind: request.requestedScope?.kind ?? "none",
      decision,
      rawDecision: request.decision ?? null,
      unenforceable: isUnenforceableCapability(
        request.capabilityId,
        request.supported,
      ),
    };
  });
}

/** Process-tier / OS-boundary capabilities the host cannot fully enforce. */
export function isUnenforceableCapability(
  capabilityId: string,
  supported?: boolean,
): boolean {
  if (supported === false) return true;
  return (
    capabilityId.startsWith("file.") ||
    capabilityId === "network.connect" ||
    capabilityId.startsWith("external.") ||
    capabilityId === "process.spawn"
  );
}

export function tierLabelKey(
  tier: PluginTier | string,
):
  | "plugins.tier.declarative"
  | "plugins.tier.sandbox"
  | "plugins.tier.process"
  | "plugins.tier.unknown" {
  if (tier === "declarative") return "plugins.tier.declarative";
  if (tier === "sandbox") return "plugins.tier.sandbox";
  if (tier === "process") return "plugins.tier.process";
  return "plugins.tier.unknown";
}

export function showTier3Honesty(plugin: Pick<PluginSummary, "tier">): boolean {
  return plugin.tier === "process";
}
