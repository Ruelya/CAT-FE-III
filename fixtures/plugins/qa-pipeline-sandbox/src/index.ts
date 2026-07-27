import {
  createSandboxPipelineStepPlugin,
  createSandboxQaRulePlugin,
  definePipelineStep,
  defineQaRule,
  type PipelineCheckpointMigrationResultV1,
  type PipelineStepInvocationV1,
  type PipelineStepResultV1,
  type PublicJsonValue,
  type QaRuleInvocationV1,
  type QaRuleResultV1,
} from "@translunar/plugin-sdk";

const qaDescriptor = defineQaRule({
  id: "fixture.qa.sandbox-marker",
  version: "1.0.0",
  displayName: "Sandbox marker",
  severity: "warning",
  categories: ["custom"],
  configSchema: { schemaVersion: 1, fields: [] },
  config: {},
  limits: {
    maxFindings: 4,
    maxMessageBytes: 256,
    maxEvidenceItems: 4,
    maxRelatedSegmentIds: 4,
    maxDeadlineMs: 1_000,
  },
});

const pipelineDescriptor = definePipelineStep({
  id: "fixture.pipeline.sandbox-normalize",
  version: "1.0.0",
  displayName: "Sandbox normalize",
  input: "json",
  output: "json",
  configSchema: { schemaVersion: 1, fields: [] },
  resumable: true,
  checkpointSchemaVersion: 1,
  limits: {
    maxInputBytes: 65_536,
    maxOutputBytes: 65_536,
    maxConfigBytes: 1_024,
    maxCheckpointBytes: 1_024,
    maxDeadlineMs: 2_000,
  },
});

function record(value: PublicJsonValue): Record<string, PublicJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function evaluateMarker(invocation: QaRuleInvocationV1): QaRuleResultV1 {
  const marker = "TIER2";
  const start = invocation.context.targetText.indexOf(marker);
  return {
    protocolVersion: 1,
    findings:
      start < 0
        ? []
        : [
            {
              ruleId: "sandbox.marker",
              category: "custom",
              severity: "warning",
              message: "Sandbox marker requires review.",
              fingerprint: `sandbox.marker:${start}`,
              spans: [{ field: "target", start, end: start + marker.length }],
              evidence: [marker],
              relatedSegmentIds: [],
            },
          ],
    usage: {
      workUnits: 1,
      inputBytes: invocation.context.targetText.length,
      outputBytes: start < 0 ? 0 : marker.length,
    },
  };
}

function normalize(invocation: PipelineStepInvocationV1): PipelineStepResultV1 {
  const values = record(invocation.input.value).values;
  const normalized = Array.isArray(values)
    ? values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toUpperCase())
    : [];
  return {
    protocolVersion: 1,
    output: { kind: "json", value: { values: normalized } },
    checkpoint: { schemaVersion: 1, value: { cursor: normalized.length } },
    usage: {
      workUnits: normalized.length,
      inputBytes: JSON.stringify(values ?? []).length,
      outputBytes: JSON.stringify(normalized).length,
    },
  };
}

const qaPlugin = createSandboxQaRulePlugin({
  descriptor: qaDescriptor,
  handler: { evaluateSegment: evaluateMarker },
});
const pipelinePlugin = createSandboxPipelineStepPlugin({
  descriptor: pipelineDescriptor,
  handler: {
    execute(invocation, context) {
      const result = normalize(invocation);
      context.publishCheckpoint(result.checkpoint!);
      return result;
    },
    resume(invocation, context) {
      const result = normalize(invocation);
      context.publishCheckpoint(result.checkpoint!);
      return result;
    },
    migrateCheckpoint(invocation): PipelineCheckpointMigrationResultV1 {
      const source = record(invocation.sourceCheckpoint.value);
      const cursor =
        typeof source.cursor === "number" && Number.isInteger(source.cursor)
          ? source.cursor
          : 0;
      return {
        protocolVersion: 1,
        checkpoint: { schemaVersion: 1, value: { cursor } },
        usage: { workUnits: 1, inputBytes: 0, outputBytes: 0 },
      };
    },
  },
});

export default Object.freeze({
  activate(context: { protocolVersion: number }) {
    if (context.protocolVersion !== 1) throw new Error("unsupported protocol");
  },
  invoke(
    request: Parameters<typeof qaPlugin.invoke>[0],
    host: Parameters<typeof pipelinePlugin.invoke>[1],
  ) {
    if (request.contributionId === qaDescriptor.id) {
      return qaPlugin.invoke(request, host);
    }
    if (request.contributionId === pipelineDescriptor.id) {
      return pipelinePlugin.invoke(request, host);
    }
    return {
      protocolVersion: 1 as const,
      ok: false as const,
      error: {
        code: "plugin_sandbox_failed",
        message: "unsupported contribution",
        retryable: false,
      },
    };
  },
  async deactivate() {
    await qaPlugin.deactivate?.();
    await pipelinePlugin.deactivate?.();
  },
});
