import {
  PipelineStepHandlerError,
  definePipelineStep,
  defineQaRule,
  startProcessQaPipelinePlugin,
  type PipelineCheckpointMigrationInvocationV1,
  type PipelineCheckpointMigrationResultV1,
  type PipelineStepInvocationV1,
  type PipelineStepInvocationContextV1,
  type PipelineStepResultV1,
  type PublicJsonValue,
  type QaRuleInvocationV1,
  type QaRuleResultV1,
} from "@translunar/plugin-sdk";

const qaDescriptor = defineQaRule({
  id: "example.qa.brand-compliance",
  version: "1.0.0",
  displayName: "Brand compliance",
  severity: "warning",
  categories: ["custom", "terminology"],
  configSchema: {
    schemaVersion: 1,
    fields: [
      {
        key: "brand",
        label: "Required brand spelling",
        fieldType: "text",
        required: true,
      },
    ],
  },
  config: { brand: "ACME" },
  limits: {
    maxFindings: 64,
    maxMessageBytes: 1_024,
    maxEvidenceItems: 32,
    maxRelatedSegmentIds: 16,
    maxDeadlineMs: 2_000,
  },
});

const pipelineDescriptor = definePipelineStep({
  id: "example.pipeline.batch-normalize",
  version: "1.0.0",
  displayName: "Batch normalize",
  input: "json",
  output: "json",
  configSchema: {
    schemaVersion: 1,
    fields: [
      {
        key: "batchSize",
        label: "Batch size",
        fieldType: "integer",
        required: true,
        min: 1,
        max: 100,
      },
    ],
  },
  resumable: true,
  checkpointSchemaVersion: 1,
});

function configRecord(value: PublicJsonValue): Record<string, PublicJsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value;
}

function recordsFromInvocation(invocation: PipelineStepInvocationV1): string[] {
  const payload = configRecord(invocation.input.value);
  const records = payload.records;
  return Array.isArray(records)
    ? records.filter((value): value is string => typeof value === "string")
    : [];
}

function checkpointCursor(invocation: PipelineStepInvocationV1): number {
  const value = invocation.checkpoint?.value;
  const cursor = configRecord(value ?? {}).cursor;
  return typeof cursor === "number" && Number.isSafeInteger(cursor)
    ? cursor
    : 0;
}

function evaluateBrand(invocation: QaRuleInvocationV1): QaRuleResultV1 {
  const configured = configRecord(invocation.config).brand;
  const brand = typeof configured === "string" ? configured : "ACME";
  const lowerTarget = invocation.context.targetText.toLocaleLowerCase("und");
  const lowerBrand = brand.toLocaleLowerCase("und");
  const start = lowerTarget.indexOf(lowerBrand);
  const actual =
    start >= 0
      ? [...invocation.context.targetText]
          .slice(start, start + [...brand].length)
          .join("")
      : "";
  const findings =
    start >= 0 && actual !== brand
      ? [
          {
            ruleId: "brand.spelling",
            category: "custom" as const,
            severity: "warning" as const,
            message: `Brand spelling must be ${brand}.`,
            fingerprint: `brand.spelling:${start}`,
            spans: [
              {
                field: "target" as const,
                start,
                end: start + [...brand].length,
              },
            ],
            evidence: [actual],
            relatedSegmentIds: [],
          },
        ]
      : [];
  return {
    protocolVersion: 1,
    findings,
    usage: {
      workUnits: 1,
      inputBytes: new TextEncoder().encode(invocation.context.targetText)
        .length,
      outputBytes: new TextEncoder().encode(actual).length,
    },
  };
}

async function normalizeBatch(
  invocation: PipelineStepInvocationV1,
  context: PipelineStepInvocationContextV1,
): Promise<PipelineStepResultV1> {
  if (context.signal.aborted) {
    throw new PipelineStepHandlerError({
      protocolVersion: 1,
      invocationId: invocation.invocationId,
      code: "cancelled",
      message: "pipeline step was cancelled",
      retryable: false,
    });
  }
  if (configRecord(invocation.input.value).fixtureFailure === "protocol") {
    throw new Error("fixture protocol failure");
  }
  const records = recordsFromInvocation(invocation);
  const cursor =
    invocation.operation === "resume" ? checkpointCursor(invocation) : 0;
  const batchSizeValue = configRecord(invocation.config).batchSize;
  const batchSize = typeof batchSizeValue === "number" ? batchSizeValue : 1;
  const end = Math.min(records.length, cursor + batchSize);
  const normalized = records
    .slice(0, cursor)
    .map((record) => record.toUpperCase());
  for (const record of records.slice(cursor, end)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    if (context.signal.aborted) {
      throw new PipelineStepHandlerError({
        protocolVersion: 1,
        invocationId: invocation.invocationId,
        code: "cancelled",
        message: "pipeline step was cancelled",
        retryable: false,
      });
    }
    normalized.push(record.toUpperCase());
    context.publishCheckpoint({
      schemaVersion: 1,
      value: { cursor: normalized.length },
    });
  }
  return {
    protocolVersion: 1,
    output: { kind: "json", value: { records: normalized } },
    checkpoint: { schemaVersion: 1, value: { cursor: end } },
    usage: {
      workUnits: end - cursor,
      inputBytes: new TextEncoder().encode(JSON.stringify(records)).length,
      outputBytes: new TextEncoder().encode(JSON.stringify(normalized)).length,
    },
  };
}

function migrateCheckpoint(
  invocation: PipelineCheckpointMigrationInvocationV1,
): PipelineCheckpointMigrationResultV1 {
  const source = configRecord(invocation.sourceCheckpoint.value);
  const cursor =
    typeof source.cursor === "number" && Number.isInteger(source.cursor)
      ? source.cursor
      : 0;
  return {
    protocolVersion: 1,
    checkpoint: { schemaVersion: 1, value: { cursor } },
    usage: { workUnits: 1, inputBytes: 0, outputBytes: 0 },
  };
}

startProcessQaPipelinePlugin({
  manifest: {
    id: "example.qa-pipeline-process",
    contributions: [qaDescriptor, pipelineDescriptor],
  },
  qaRules: {
    [qaDescriptor.id]: {
      evaluateSegment(invocation) {
        return evaluateBrand(invocation);
      },
    },
  },
  pipelineSteps: {
    [pipelineDescriptor.id]: {
      execute(invocation, context) {
        return normalizeBatch(invocation, context);
      },
      resume(invocation, context) {
        return normalizeBatch(invocation, context);
      },
      migrateCheckpoint(invocation) {
        return migrateCheckpoint(invocation);
      },
    },
  },
});
