import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

export const QA_RULE_OPERATION_PROTOCOL_VERSION = 1 as const;
export const PIPELINE_STEP_OPERATION_PROTOCOL_VERSION = 1 as const;
export const PUBLIC_CONFIG_SCHEMA_VERSION = 1 as const;

export const QA_RULE_OPERATIONS_V1 = ["evaluateSegment"] as const;
export const PIPELINE_STEP_OPERATIONS_V1 = ["execute", "resume"] as const;
export const PIPELINE_CHECKPOINT_MIGRATION_OPERATION_V1 =
  "checkpointMigrate" as const;

export const PUBLIC_CONTRIBUTION_LIMITS = Object.freeze({
  descriptorBytes: 64 * 1024,
  configBytes: 64 * 1024,
  checkpointBytes: 1024 * 1024,
  invocationBytes: 4 * 1024 * 1024,
  resultBytes: 8 * 1024 * 1024,
  jsonDepth: 16,
  jsonNodes: 65_536,
  collectionItems: 4_096,
  textBytes: 1024 * 1024,
  qaFindings: 1_024,
  qaMessageBytes: 2_048,
  qaEvidenceItems: 128,
  qaEvidenceTextBytes: 4_096,
  qaRelatedSegments: 128,
  usageUnits: 1_000_000_000,
  deadlineMs: 120_000,
} as const);

export type PublicJsonPrimitive = null | boolean | number | string;
export type PublicJsonValue =
  PublicJsonPrimitive | PublicJsonValue[] | { [key: string]: PublicJsonValue };

export type PublicConfigFieldTypeV1 =
  "text" | "boolean" | "integer" | "number" | "select" | "json";

export interface PublicConfigOptionV1 {
  value: string;
  label: string;
}

export interface PublicConfigFieldV1 {
  key: string;
  label: string;
  fieldType: PublicConfigFieldTypeV1;
  required: boolean;
  defaultValue?: PublicJsonValue;
  min?: number;
  max?: number;
  options?: PublicConfigOptionV1[];
}

export interface PublicConfigSchemaV1 {
  schemaVersion: 1;
  fields: PublicConfigFieldV1[];
}

export type QaCategoryV1 =
  | "completeness"
  | "numbers"
  | "tags"
  | "punctuation"
  | "whitespace"
  | "repetition"
  | "length"
  | "terminology"
  | "consistency"
  | "custom";

export type QaSeverityV1 = "error" | "warning" | "info";
export type ArtifactKindV1 =
  "none" | "project" | "document" | "segments" | "qaFindings" | "json";

export interface QaRuleLimitsV1 {
  maxFindings: number;
  maxMessageBytes: number;
  maxEvidenceItems: number;
  maxRelatedSegmentIds: number;
  maxDeadlineMs: number;
}

export interface PipelineStepLimitsV1 {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxConfigBytes: number;
  maxCheckpointBytes: number;
  maxDeadlineMs: number;
}

export interface QaRuleContributionDescriptorV1 {
  kind: "qaRule";
  descriptorVersion: 1;
  operationProtocolVersion: 1;
  id: string;
  version: string;
  displayName: string;
  ruleType: "mechanical";
  severity: QaSeverityV1;
  definition: Record<string, never>;
  ruleKind: "mechanical";
  categories: QaCategoryV1[];
  configSchemaVersion: 1;
  configSchema: PublicConfigSchemaV1;
  limits: QaRuleLimitsV1;
  config?: PublicJsonValue;
  declarative?: never;
}

export interface PipelineStepContributionDescriptorV1 {
  kind: "pipelineStep";
  descriptorVersion: 1;
  operationProtocolVersion: 1;
  id: string;
  version: string;
  displayName: string;
  input: ArtifactKindV1;
  output: ArtifactKindV1;
  configSchemaVersion: 1;
  configSchema: PublicConfigSchemaV1;
  resumable: boolean;
  cancellable: true;
  checkpointSchemaVersion?: 1;
  limits: PipelineStepLimitsV1;
  declarative?: never;
}

export interface QaTagFindingV1 {
  code: string;
  message: string;
}

export interface QaTermExpectationV1 {
  id: string;
  source: string;
  expectedTargets: string[];
  forbiddenTargets: string[];
}

export interface QaSegmentContextV1 {
  projectId: string;
  documentId: string;
  segmentId: string;
  ordinal: number;
  structuralPath: string;
  sourceLocale: string;
  targetLocale: string;
  sourceText: string;
  targetText: string;
  tagFindings: QaTagFindingV1[];
  termExpectations: QaTermExpectationV1[];
}

export interface QaRuleInvocationV1 {
  protocolVersion: 1;
  invocationId: string;
  contributionId: string;
  operation: "evaluateSegment";
  context: QaSegmentContextV1;
  configSchemaVersion: 1;
  config: PublicJsonValue;
  deadlineMs: number;
}

export interface QaSpanV1 {
  field: "source" | "target";
  start: number;
  end: number;
}

export interface QaFindingCandidateV1 {
  ruleId: string;
  category: QaCategoryV1;
  severity: QaSeverityV1;
  message: string;
  fingerprint: string;
  spans: QaSpanV1[];
  evidence: string[];
  relatedSegmentIds: string[];
}

export interface PluginUsageV1 {
  workUnits: number;
  inputBytes: number;
  outputBytes: number;
}

export interface QaRuleResultV1 {
  protocolVersion: 1;
  findings: QaFindingCandidateV1[];
  usage: PluginUsageV1;
}

export type QaRuleFailureCodeV1 =
  | "invalid_input"
  | "invalid_result"
  | "permission_denied"
  | "cancelled"
  | "timeout"
  | "host_crash"
  | "protocol"
  | "resource_limit"
  | "stale_activation";

export interface QaRuleFailureV1 {
  protocolVersion: 1;
  invocationId: string;
  code: QaRuleFailureCodeV1;
  message: string;
  retryable: boolean;
}

export interface PipelineArtifactV1 {
  kind: ArtifactKindV1;
  value: PublicJsonValue;
}

export interface PipelineCheckpointV1 {
  schemaVersion: number;
  value: PublicJsonValue;
}

export interface PipelineStepCheckpointProgressV1 {
  protocolVersion: 1;
  invocationId: string;
  contributionId: string;
  checkpoint: PipelineCheckpointV1;
}

export interface PipelineCheckpointMigrationInvocationV1 {
  protocolVersion: 1;
  invocationId: string;
  contributionId: string;
  runId: string;
  projectId: string;
  documentId?: string;
  configSchemaVersion: 1;
  config: PublicJsonValue;
  sourceCheckpoint: PipelineCheckpointV1;
  targetCheckpointSchemaVersion: 1;
  deadlineMs: number;
}

export interface PipelineCheckpointMigrationResultV1 {
  protocolVersion: 1;
  checkpoint: PipelineCheckpointV1;
  usage: PluginUsageV1;
}

export interface PipelineStepInvocationV1 {
  protocolVersion: 1;
  invocationId: string;
  contributionId: string;
  operation: "execute" | "resume";
  runId: string;
  projectId: string;
  documentId?: string;
  input: PipelineArtifactV1;
  configSchemaVersion: 1;
  config: PublicJsonValue;
  checkpoint?: PipelineCheckpointV1;
  deadlineMs: number;
}

export interface PipelineStepResultV1 {
  protocolVersion: 1;
  output: PipelineArtifactV1;
  checkpoint?: PipelineCheckpointV1;
  usage: PluginUsageV1;
}

export type PipelineStepFailureCodeV1 =
  | "invalid_input"
  | "invalid_output"
  | "permission_denied"
  | "cancelled"
  | "timeout"
  | "host_crash"
  | "protocol"
  | "resource_limit"
  | "stale_activation"
  | "step_not_resumable"
  | "plugin_checkpoint_incompatible";

export interface PipelineStepFailureV1 {
  protocolVersion: 1;
  invocationId: string;
  code: PipelineStepFailureCodeV1;
  message: string;
  retryable: boolean;
}

export interface ContributionCancelRequestV1 {
  protocolVersion: 1;
  invocationId: string;
}

export interface ContributionContractCompatibilityV1 {
  compatible: boolean;
  descriptorVersionSupported: boolean;
  operationProtocolVersionSupported: boolean;
  configSchemaVersionSupported: boolean;
  checkpointSchemaVersionSupported: boolean;
  reasons: string[];
}

export interface ContributionInvocationContextV1 {
  readonly signal: AbortSignal;
}

export interface PipelineStepInvocationContextV1 extends ContributionInvocationContextV1 {
  publishCheckpoint(checkpoint: PipelineCheckpointV1): void;
}

export interface QaRuleHandlerV1 {
  evaluateSegment(
    invocation: QaRuleInvocationV1,
    context: ContributionInvocationContextV1,
  ): QaRuleResultV1 | Promise<QaRuleResultV1>;
  cancel?(invocationId: string): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface PipelineStepHandlerV1 {
  execute(
    invocation: PipelineStepInvocationV1 & { operation: "execute" },
    context: PipelineStepInvocationContextV1,
  ): PipelineStepResultV1 | Promise<PipelineStepResultV1>;
  resume?(
    invocation: PipelineStepInvocationV1 & { operation: "resume" },
    context: PipelineStepInvocationContextV1,
  ): PipelineStepResultV1 | Promise<PipelineStepResultV1>;
  migrateCheckpoint?(
    invocation: PipelineCheckpointMigrationInvocationV1,
    context: ContributionInvocationContextV1,
  ):
    | PipelineCheckpointMigrationResultV1
    | Promise<PipelineCheckpointMigrationResultV1>;
  cancel?(invocationId: string): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface QaPipelineSandboxPluginV1 {
  invoke(
    request: {
      protocolVersion: 1;
      invocationId: string;
      contributionId: string;
      operation: string;
      input: PublicJsonValue;
    },
    host?: SandboxContributionHostV1,
  ): SandboxContributionResultV1 | Promise<SandboxContributionResultV1>;
  deactivate?(): void | Promise<void>;
}

export type SandboxContributionResultV1 =
  | { protocolVersion: 1; ok: true; output: PublicJsonValue }
  | {
      protocolVersion: 1;
      ok: false;
      error: { code: string; message: string; retryable: boolean };
    };

export interface SandboxContributionHostV1 {
  call(request: {
    protocolVersion: 1;
    requestId: string;
    method: string;
    params: PublicJsonValue;
  }): unknown;
}

export class QaRuleHandlerError extends Error {
  readonly failure: QaRuleFailureV1;

  constructor(failure: QaRuleFailureV1) {
    const errors = validateQaRuleFailure(failure);
    if (errors.length > 0) {
      throw new TypeError(`invalid QA failure: ${errors.join("; ")}`);
    }
    super(failure.message);
    this.name = "QaRuleHandlerError";
    this.failure = failure;
  }
}

export class PipelineStepHandlerError extends Error {
  readonly failure: PipelineStepFailureV1;

  constructor(failure: PipelineStepFailureV1) {
    const errors = validatePipelineStepFailure(failure);
    if (errors.length > 0) {
      throw new TypeError(`invalid pipeline failure: ${errors.join("; ")}`);
    }
    super(failure.message);
    this.name = "PipelineStepHandlerError";
    this.failure = failure;
  }
}

const qaCategories = new Set<string>([
  "completeness",
  "numbers",
  "tags",
  "punctuation",
  "whitespace",
  "repetition",
  "length",
  "terminology",
  "consistency",
  "custom",
]);
const qaSeverities = new Set<string>(["error", "warning", "info"]);
const artifactKinds = new Set<string>([
  "none",
  "project",
  "document",
  "segments",
  "qaFindings",
  "json",
]);

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function jsonBytes(value: unknown): number {
  try {
    return utf8Bytes(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function strictObject(
  value: unknown,
  keys: readonly string[],
  label: string,
  errors: string[],
): Record<string, unknown> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    errors.push(`${label} must be a plain object`);
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key))
      errors.push(`${label} contains unknown field ${key}`);
  }
  return record;
}

function boundaryString(
  value: unknown,
  label: string,
  maxBytes: number,
  errors: string[],
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8Bytes(value) > maxBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    errors.push(`${label} is empty, malformed, or oversized`);
    return false;
  }
  return true;
}

function boundaryId(
  value: unknown,
  label: string,
  errors: string[],
): value is string {
  if (!boundaryString(value, label, 128, errors)) return false;
  if (!/^[A-Za-z0-9._:-]+$/u.test(value)) {
    errors.push(`${label} contains unsupported characters`);
    return false;
  }
  return true;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  label: string,
  errors: string[],
): value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  ) {
    errors.push(`${label} must be an integer between ${min} and ${max}`);
    return false;
  }
  return true;
}

export function validatePublicJson(
  value: unknown,
  maxBytes = PUBLIC_CONTRIBUTION_LIMITS.resultBytes,
): value is PublicJsonValue {
  let nodes = 0;
  const stack = new Set<object>();
  const walk = (candidate: unknown, depth: number): boolean => {
    nodes += 1;
    if (
      nodes > PUBLIC_CONTRIBUTION_LIMITS.jsonNodes ||
      depth > PUBLIC_CONTRIBUTION_LIMITS.jsonDepth
    ) {
      return false;
    }
    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      typeof candidate === "string"
    ) {
      return (
        typeof candidate !== "string" ||
        utf8Bytes(candidate) <= PUBLIC_CONTRIBUTION_LIMITS.textBytes
      );
    }
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate !== "object" || stack.has(candidate)) return false;
    stack.add(candidate);
    if (Array.isArray(candidate)) {
      const valid =
        candidate.length <= PUBLIC_CONTRIBUTION_LIMITS.collectionItems &&
        candidate.every((item) => walk(item, depth + 1));
      stack.delete(candidate);
      return valid;
    }
    if (Object.getPrototypeOf(candidate) !== Object.prototype) {
      stack.delete(candidate);
      return false;
    }
    const entries = Object.entries(candidate);
    const valid =
      entries.length <= PUBLIC_CONTRIBUTION_LIMITS.collectionItems &&
      entries.every(
        ([key, item]) =>
          utf8Bytes(key) <= 256 &&
          !/[\u0000-\u001f\u007f]/u.test(key) &&
          walk(item, depth + 1),
      );
    stack.delete(candidate);
    return valid;
  };
  return walk(value, 0) && jsonBytes(value) <= maxBytes;
}

export function canonicalizePublicJson(
  value: PublicJsonValue,
): PublicJsonValue {
  if (!validatePublicJson(value))
    throw new TypeError("invalid public JSON value");
  if (Array.isArray(value)) return value.map(canonicalizePublicJson);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizePublicJson(value[key]!)]),
    );
  }
  return value;
}

export function defaultQaRuleLimits(): QaRuleLimitsV1 {
  return {
    maxFindings: 256,
    maxMessageBytes: 1_024,
    maxEvidenceItems: 64,
    maxRelatedSegmentIds: 32,
    maxDeadlineMs: 2_000,
  };
}

export function defaultPipelineStepLimits(): PipelineStepLimitsV1 {
  return {
    maxInputBytes: 1024 * 1024,
    maxOutputBytes: 1024 * 1024,
    maxConfigBytes: PUBLIC_CONTRIBUTION_LIMITS.configBytes,
    maxCheckpointBytes: PUBLIC_CONTRIBUTION_LIMITS.checkpointBytes,
    maxDeadlineMs: 30_000,
  };
}

export function defineQaRule(
  descriptor: Omit<
    QaRuleContributionDescriptorV1,
    | "kind"
    | "descriptorVersion"
    | "operationProtocolVersion"
    | "ruleType"
    | "definition"
    | "ruleKind"
    | "configSchemaVersion"
    | "limits"
  > & { limits?: QaRuleLimitsV1 },
): QaRuleContributionDescriptorV1 {
  const result: QaRuleContributionDescriptorV1 = {
    ...descriptor,
    kind: "qaRule",
    descriptorVersion: 1,
    operationProtocolVersion: 1,
    ruleType: "mechanical",
    definition: {},
    ruleKind: "mechanical",
    configSchemaVersion: 1,
    limits: descriptor.limits ?? defaultQaRuleLimits(),
  };
  const errors = validateQaRuleDescriptor(result);
  if (errors.length > 0)
    throw new TypeError(`invalid QA descriptor: ${errors.join("; ")}`);
  return result;
}

export function definePipelineStep(
  descriptor: Omit<
    PipelineStepContributionDescriptorV1,
    | "kind"
    | "descriptorVersion"
    | "operationProtocolVersion"
    | "configSchemaVersion"
    | "cancellable"
    | "limits"
  > & { limits?: PipelineStepLimitsV1 },
): PipelineStepContributionDescriptorV1 {
  const result: PipelineStepContributionDescriptorV1 = {
    ...descriptor,
    kind: "pipelineStep",
    descriptorVersion: 1,
    operationProtocolVersion: 1,
    configSchemaVersion: 1,
    cancellable: true,
    limits: descriptor.limits ?? defaultPipelineStepLimits(),
  };
  const errors = validatePipelineStepDescriptor(result);
  if (errors.length > 0) {
    throw new TypeError(`invalid pipeline descriptor: ${errors.join("; ")}`);
  }
  return result;
}

export function validatePublicConfigSchema(value: unknown): string[] {
  const errors: string[] = [];
  const schema = strictObject(
    value,
    ["schemaVersion", "fields"],
    "config schema",
    errors,
  );
  if (schema?.schemaVersion !== 1)
    errors.push("config schemaVersion must be 1");
  if (!Array.isArray(schema?.fields) || schema.fields.length > 128) {
    errors.push(
      "config schema fields must be an array with at most 128 entries",
    );
    return errors;
  }
  const keys = new Set<string>();
  schema.fields.forEach((candidate, index) => {
    const field = strictObject(
      candidate,
      [
        "key",
        "label",
        "fieldType",
        "required",
        "defaultValue",
        "min",
        "max",
        "options",
      ],
      `config field ${index}`,
      errors,
    );
    if (!field) return;
    if (boundaryId(field.key, `config field ${index} key`, errors)) {
      if (keys.has(field.key))
        errors.push(`config field ${field.key} is duplicated`);
      keys.add(field.key);
    }
    boundaryString(field.label, `config field ${index} label`, 256, errors);
    if (
      !["text", "boolean", "integer", "number", "select", "json"].includes(
        String(field.fieldType),
      )
    ) {
      errors.push(`config field ${index} fieldType is unsupported`);
    }
    if (typeof field.required !== "boolean")
      errors.push(`config field ${index} required must be boolean`);
    if (field.min !== undefined && !Number.isSafeInteger(field.min))
      errors.push(`config field ${index} min must be an integer`);
    if (field.max !== undefined && !Number.isSafeInteger(field.max))
      errors.push(`config field ${index} max must be an integer`);
    if (
      typeof field.min === "number" &&
      typeof field.max === "number" &&
      field.min > field.max
    ) {
      errors.push(`config field ${index} range is invalid`);
    }
    const options = field.options ?? [];
    if (!Array.isArray(options) || options.length > 128) {
      errors.push(`config field ${index} options are invalid`);
    } else {
      const optionValues = new Set<string>();
      for (const [optionIndex, candidateOption] of options.entries()) {
        const option = strictObject(
          candidateOption,
          ["value", "label"],
          `config option ${optionIndex}`,
          errors,
        );
        if (option) {
          boundaryString(option.value, "config option value", 256, errors);
          boundaryString(option.label, "config option label", 256, errors);
          if (typeof option.value === "string") {
            if (optionValues.has(option.value))
              errors.push(`config field ${index} has duplicate option values`);
            optionValues.add(option.value);
          }
        }
      }
    }
    if (
      (field.fieldType === "select") !==
      (Array.isArray(options) && options.length > 0)
    ) {
      errors.push(`config field ${index} select/options contract is invalid`);
    }
    if (
      field.defaultValue !== undefined &&
      !validatePublicJson(
        field.defaultValue,
        PUBLIC_CONTRIBUTION_LIMITS.configBytes,
      )
    ) {
      errors.push(`config field ${index} defaultValue is invalid`);
    } else if (
      field.defaultValue !== undefined &&
      !configFieldAccepts(
        field as unknown as PublicConfigFieldV1,
        field.defaultValue,
      )
    ) {
      errors.push(
        `config field ${index} defaultValue does not match fieldType`,
      );
    }
  });
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.descriptorBytes)
    errors.push("config schema is oversized");
  return errors;
}

function configFieldAccepts(
  field: PublicConfigFieldV1,
  value: unknown,
): boolean {
  switch (field.fieldType) {
    case "text":
      return typeof value === "string" && utf8Bytes(value) <= 16 * 1024;
    case "select":
      return (
        typeof value === "string" &&
        (field.options ?? []).some((option) => option.value === value)
      );
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return (
        Number.isSafeInteger(value) &&
        (field.min === undefined || (value as number) >= field.min) &&
        (field.max === undefined || (value as number) <= field.max)
      );
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)
      );
    case "json":
      return validatePublicJson(value, PUBLIC_CONTRIBUTION_LIMITS.configBytes);
  }
}

export function validatePublicConfig(
  value: unknown,
  schema: PublicConfigSchemaV1,
): string[] {
  const errors = validatePublicConfigSchema(schema);
  const config = strictObject(
    value,
    schema.fields.map((field) => field.key),
    "config",
    errors,
  );
  if (!config || jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.configBytes) {
    if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.configBytes)
      errors.push("config is oversized");
    return errors;
  }
  for (const field of schema.fields) {
    const candidate = config[field.key];
    if (candidate === undefined) {
      if (field.required && field.defaultValue === undefined)
        errors.push(`config is missing required field ${field.key}`);
    } else if (!configFieldAccepts(field, candidate)) {
      errors.push(`config field ${field.key} has an invalid value`);
    }
  }
  return errors;
}

function validateUsage(value: unknown, errors: string[]): void {
  const usage = strictObject(
    value,
    ["workUnits", "inputBytes", "outputBytes"],
    "usage",
    errors,
  );
  if (!usage) return;
  boundedInteger(
    usage.workUnits,
    0,
    PUBLIC_CONTRIBUTION_LIMITS.usageUnits,
    "usage workUnits",
    errors,
  );
  boundedInteger(
    usage.inputBytes,
    0,
    PUBLIC_CONTRIBUTION_LIMITS.invocationBytes,
    "usage inputBytes",
    errors,
  );
  boundedInteger(
    usage.outputBytes,
    0,
    PUBLIC_CONTRIBUTION_LIMITS.resultBytes,
    "usage outputBytes",
    errors,
  );
}

export function validateQaRuleDescriptor(value: unknown): string[] {
  const errors: string[] = [];
  const descriptor = strictObject(
    value,
    [
      "kind",
      "descriptorVersion",
      "operationProtocolVersion",
      "id",
      "version",
      "displayName",
      "ruleType",
      "severity",
      "definition",
      "ruleKind",
      "categories",
      "configSchemaVersion",
      "configSchema",
      "limits",
      "config",
    ],
    "QA descriptor",
    errors,
  );
  if (!descriptor) return errors;
  if (
    descriptor.kind !== "qaRule" ||
    descriptor.descriptorVersion !== 1 ||
    descriptor.operationProtocolVersion !== 1 ||
    descriptor.ruleType !== "mechanical" ||
    descriptor.ruleKind !== "mechanical" ||
    descriptor.configSchemaVersion !== 1
  ) {
    errors.push(
      "QA descriptor versions and kinds must use the closed V1 contract",
    );
  }
  boundaryId(descriptor.id, "QA id", errors);
  boundaryString(descriptor.version, "QA version", 128, errors);
  boundaryString(descriptor.displayName, "QA displayName", 256, errors);
  if (!qaSeverities.has(String(descriptor.severity)))
    errors.push("QA severity is unsupported");
  if (
    !Array.isArray(descriptor.categories) ||
    descriptor.categories.length === 0 ||
    descriptor.categories.length > 256 ||
    descriptor.categories.some(
      (category) => !qaCategories.has(String(category)),
    )
  )
    errors.push("QA categories are invalid");
  else if (
    descriptor.categories.some(
      (category, index, values) =>
        index > 0 && String(values[index - 1]) >= String(category),
    )
  )
    errors.push("QA categories must be unique and deterministically ordered");
  if (
    typeof descriptor.definition !== "object" ||
    descriptor.definition === null ||
    Array.isArray(descriptor.definition) ||
    Object.keys(descriptor.definition).length !== 0
  )
    errors.push("QA definition must be the closed empty V1 object");
  errors.push(...validatePublicConfigSchema(descriptor.configSchema));
  if (descriptor.config !== undefined && descriptor.configSchema)
    errors.push(
      ...validatePublicConfig(
        descriptor.config,
        descriptor.configSchema as PublicConfigSchemaV1,
      ),
    );
  const limits = strictObject(
    descriptor.limits,
    [
      "maxFindings",
      "maxMessageBytes",
      "maxEvidenceItems",
      "maxRelatedSegmentIds",
      "maxDeadlineMs",
    ],
    "QA limits",
    errors,
  );
  if (limits) {
    boundedInteger(
      limits.maxFindings,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.qaFindings,
      "QA maxFindings",
      errors,
    );
    boundedInteger(
      limits.maxMessageBytes,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.qaMessageBytes,
      "QA maxMessageBytes",
      errors,
    );
    boundedInteger(
      limits.maxEvidenceItems,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceItems,
      "QA maxEvidenceItems",
      errors,
    );
    boundedInteger(
      limits.maxRelatedSegmentIds,
      0,
      PUBLIC_CONTRIBUTION_LIMITS.qaRelatedSegments,
      "QA maxRelatedSegmentIds",
      errors,
    );
    boundedInteger(
      limits.maxDeadlineMs,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.deadlineMs,
      "QA maxDeadlineMs",
      errors,
    );
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.descriptorBytes)
    errors.push("QA descriptor is oversized");
  return errors;
}

export function validatePipelineStepDescriptor(value: unknown): string[] {
  const errors: string[] = [];
  const descriptor = strictObject(
    value,
    [
      "kind",
      "descriptorVersion",
      "operationProtocolVersion",
      "id",
      "version",
      "displayName",
      "input",
      "output",
      "configSchemaVersion",
      "configSchema",
      "resumable",
      "cancellable",
      "checkpointSchemaVersion",
      "limits",
    ],
    "pipeline descriptor",
    errors,
  );
  if (!descriptor) return errors;
  if (
    descriptor.kind !== "pipelineStep" ||
    descriptor.descriptorVersion !== 1 ||
    descriptor.operationProtocolVersion !== 1 ||
    descriptor.configSchemaVersion !== 1 ||
    descriptor.cancellable !== true
  )
    errors.push(
      "pipeline descriptor versions and flags must use the closed V1 contract",
    );
  boundaryId(descriptor.id, "pipeline id", errors);
  boundaryString(descriptor.version, "pipeline version", 128, errors);
  boundaryString(descriptor.displayName, "pipeline displayName", 256, errors);
  if (
    !artifactKinds.has(String(descriptor.input)) ||
    descriptor.input === "none"
  )
    errors.push("pipeline input artifact kind is invalid");
  if (
    !artifactKinds.has(String(descriptor.output)) ||
    descriptor.output === "none"
  )
    errors.push("pipeline output artifact kind is invalid");
  if (typeof descriptor.resumable !== "boolean")
    errors.push("pipeline resumable must be boolean");
  if (
    descriptor.resumable === true
      ? descriptor.checkpointSchemaVersion !== 1
      : descriptor.checkpointSchemaVersion !== undefined
  )
    errors.push("pipeline checkpoint schema must be 1 exactly when resumable");
  errors.push(...validatePublicConfigSchema(descriptor.configSchema));
  const limits = strictObject(
    descriptor.limits,
    [
      "maxInputBytes",
      "maxOutputBytes",
      "maxConfigBytes",
      "maxCheckpointBytes",
      "maxDeadlineMs",
    ],
    "pipeline limits",
    errors,
  );
  if (limits) {
    boundedInteger(
      limits.maxInputBytes,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.invocationBytes,
      "pipeline maxInputBytes",
      errors,
    );
    boundedInteger(
      limits.maxOutputBytes,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.resultBytes,
      "pipeline maxOutputBytes",
      errors,
    );
    boundedInteger(
      limits.maxConfigBytes,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.configBytes,
      "pipeline maxConfigBytes",
      errors,
    );
    boundedInteger(
      limits.maxCheckpointBytes,
      0,
      PUBLIC_CONTRIBUTION_LIMITS.checkpointBytes,
      "pipeline maxCheckpointBytes",
      errors,
    );
    boundedInteger(
      limits.maxDeadlineMs,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.deadlineMs,
      "pipeline maxDeadlineMs",
      errors,
    );
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.descriptorBytes)
    errors.push("pipeline descriptor is oversized");
  return errors;
}

function validateInvocationCommon(
  record: Record<string, unknown>,
  protocol: number,
  errors: string[],
): void {
  if (record.protocolVersion !== protocol)
    errors.push("invocation protocolVersion is unsupported");
  boundaryId(record.invocationId, "invocationId", errors);
  boundaryId(record.contributionId, "contributionId", errors);
  boundedInteger(
    record.deadlineMs,
    1,
    PUBLIC_CONTRIBUTION_LIMITS.deadlineMs,
    "deadlineMs",
    errors,
  );
}

export function validateQaRuleInvocation(
  value: unknown,
  descriptor: QaRuleContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  const invocation = strictObject(
    value,
    [
      "protocolVersion",
      "invocationId",
      "contributionId",
      "operation",
      "context",
      "configSchemaVersion",
      "config",
      "deadlineMs",
    ],
    "QA invocation",
    errors,
  );
  if (!invocation) return errors;
  validateInvocationCommon(invocation, 1, errors);
  if (
    invocation.operation !== "evaluateSegment" ||
    invocation.contributionId !== descriptor.id ||
    invocation.configSchemaVersion !== descriptor.configSchemaVersion
  )
    errors.push(
      "QA invocation operation, contribution, or config version does not match",
    );
  if (
    typeof invocation.deadlineMs === "number" &&
    invocation.deadlineMs > descriptor.limits.maxDeadlineMs
  )
    errors.push("QA invocation deadline exceeds descriptor limit");
  errors.push(
    ...validatePublicConfig(invocation.config, descriptor.configSchema),
  );
  const context = strictObject(
    invocation.context,
    [
      "projectId",
      "documentId",
      "segmentId",
      "ordinal",
      "structuralPath",
      "sourceLocale",
      "targetLocale",
      "sourceText",
      "targetText",
      "tagFindings",
      "termExpectations",
    ],
    "QA context",
    errors,
  );
  if (context) {
    boundaryId(context.projectId, "QA projectId", errors);
    boundaryId(context.documentId, "QA documentId", errors);
    boundaryId(context.segmentId, "QA segmentId", errors);
    boundedInteger(
      context.ordinal,
      0,
      Number.MAX_SAFE_INTEGER,
      "QA ordinal",
      errors,
    );
    boundaryString(context.structuralPath, "QA structuralPath", 4_096, errors);
    boundaryString(context.sourceLocale, "QA sourceLocale", 64, errors);
    boundaryString(context.targetLocale, "QA targetLocale", 64, errors);
    if (
      typeof context.sourceText !== "string" ||
      utf8Bytes(context.sourceText) > PUBLIC_CONTRIBUTION_LIMITS.textBytes ||
      typeof context.targetText !== "string" ||
      utf8Bytes(context.targetText) > PUBLIC_CONTRIBUTION_LIMITS.textBytes
    )
      errors.push("QA source/target text exceeds public bounds");
    if (
      !Array.isArray(context.tagFindings) ||
      context.tagFindings.length > PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceItems
    ) {
      errors.push("QA tag findings are invalid");
    } else {
      context.tagFindings.forEach((candidate, index) => {
        const finding = strictObject(
          candidate,
          ["code", "message"],
          `QA tag finding ${index}`,
          errors,
        );
        if (finding) {
          boundaryId(finding.code, `QA tag finding ${index} code`, errors);
          boundaryString(
            finding.message,
            `QA tag finding ${index} message`,
            PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceTextBytes,
            errors,
          );
        }
      });
    }
    if (
      !Array.isArray(context.termExpectations) ||
      context.termExpectations.length >
        PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceItems
    ) {
      errors.push("QA term expectations are invalid");
    } else {
      context.termExpectations.forEach((candidate, index) => {
        const term = strictObject(
          candidate,
          ["id", "source", "expectedTargets", "forbiddenTargets"],
          `QA term expectation ${index}`,
          errors,
        );
        if (!term) return;
        boundaryId(term.id, `QA term expectation ${index} id`, errors);
        boundaryString(
          term.source,
          `QA term expectation ${index} source`,
          PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceTextBytes,
          errors,
        );
        for (const key of ["expectedTargets", "forbiddenTargets"] as const) {
          const values = term[key];
          if (
            !Array.isArray(values) ||
            values.length > PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceItems ||
            values.some(
              (item) =>
                typeof item !== "string" ||
                utf8Bytes(item) >
                  PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceTextBytes,
            )
          ) {
            errors.push(`QA term expectation ${index} ${key} is invalid`);
          }
        }
      });
    }
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.invocationBytes)
    errors.push("QA invocation is oversized");
  return errors;
}

export function validateQaRuleResult(
  value: unknown,
  invocation: QaRuleInvocationV1,
  descriptor: QaRuleContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  const result = strictObject(
    value,
    ["protocolVersion", "findings", "usage"],
    "QA result",
    errors,
  );
  if (!result) return errors;
  if (result.protocolVersion !== 1)
    errors.push("QA result protocolVersion must be 1");
  validateUsage(result.usage, errors);
  if (
    !Array.isArray(result.findings) ||
    result.findings.length > descriptor.limits.maxFindings
  ) {
    errors.push("QA findings exceed descriptor bounds");
    return errors;
  }
  const sourceLength = [...invocation.context.sourceText].length;
  const targetLength = [...invocation.context.targetText].length;
  let previous = "";
  const identities = new Set<string>();
  for (const [index, candidate] of result.findings.entries()) {
    const finding = strictObject(
      candidate,
      [
        "ruleId",
        "category",
        "severity",
        "message",
        "fingerprint",
        "spans",
        "evidence",
        "relatedSegmentIds",
      ],
      `QA finding ${index}`,
      errors,
    );
    if (!finding) continue;
    boundaryId(finding.ruleId, `QA finding ${index} ruleId`, errors);
    if (!qaCategories.has(String(finding.category)))
      errors.push(`QA finding ${index} category is unsupported`);
    if (!qaSeverities.has(String(finding.severity)))
      errors.push(`QA finding ${index} severity is unsupported`);
    boundaryString(
      finding.message,
      `QA finding ${index} message`,
      descriptor.limits.maxMessageBytes,
      errors,
    );
    boundaryString(
      finding.fingerprint,
      `QA finding ${index} fingerprint`,
      256,
      errors,
    );
    const identity = `${String(finding.ruleId)}\u0000${String(finding.fingerprint)}`;
    if (identities.has(identity))
      errors.push("QA result contains duplicate findings");
    identities.add(identity);
    if (identity <= previous)
      errors.push("QA findings are not deterministically ordered");
    previous = identity;
    if (
      !Array.isArray(finding.spans) ||
      finding.spans.length > descriptor.limits.maxEvidenceItems
    )
      errors.push(`QA finding ${index} spans are invalid`);
    else {
      let priorSpan = "";
      for (const [spanIndex, candidateSpan] of finding.spans.entries()) {
        const span = strictObject(
          candidateSpan,
          ["field", "start", "end"],
          `QA span ${spanIndex}`,
          errors,
        );
        if (!span) continue;
        const limit =
          span.field === "source"
            ? sourceLength
            : span.field === "target"
              ? targetLength
              : -1;
        if (
          limit < 0 ||
          !Number.isSafeInteger(span.start) ||
          !Number.isSafeInteger(span.end) ||
          (span.start as number) < 0 ||
          (span.end as number) <= (span.start as number) ||
          (span.end as number) > limit
        )
          errors.push(`QA span ${spanIndex} is outside the segment`);
        const spanKey = `${String(span.field)}:${String(span.start).padStart(10, "0")}:${String(span.end).padStart(10, "0")}`;
        if (spanKey <= priorSpan)
          errors.push("QA spans are not deterministically ordered");
        priorSpan = spanKey;
      }
    }
    if (
      !Array.isArray(finding.evidence) ||
      finding.evidence.length > descriptor.limits.maxEvidenceItems ||
      finding.evidence.some(
        (item) =>
          typeof item !== "string" ||
          utf8Bytes(item) > PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceTextBytes,
      )
    )
      errors.push(`QA finding ${index} evidence is invalid`);
    if (
      !Array.isArray(finding.relatedSegmentIds) ||
      finding.relatedSegmentIds.length >
        descriptor.limits.maxRelatedSegmentIds ||
      finding.relatedSegmentIds.some(
        (item) => typeof item !== "string" || !/^[A-Za-z0-9._:-]+$/u.test(item),
      )
    )
      errors.push(`QA finding ${index} related segment IDs are invalid`);
    else if (
      finding.relatedSegmentIds.some(
        (item, itemIndex, values) =>
          itemIndex > 0 && String(values[itemIndex - 1]) >= String(item),
      )
    )
      errors.push("QA related segment IDs are not deterministically ordered");
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.resultBytes)
    errors.push("QA result is oversized");
  return errors;
}

function validatePipelineArtifact(
  value: unknown,
  expected: ArtifactKindV1,
  maxBytes: number,
  label: string,
  errors: string[],
): void {
  const artifact = strictObject(value, ["kind", "value"], label, errors);
  if (!artifact) return;
  if (artifact.kind !== expected)
    errors.push(`${label} kind does not match descriptor`);
  if (!validatePublicJson(artifact.value, maxBytes))
    errors.push(`${label} value is invalid or oversized`);
}

export function validatePipelineStepInvocation(
  value: unknown,
  descriptor: PipelineStepContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  const invocation = strictObject(
    value,
    [
      "protocolVersion",
      "invocationId",
      "contributionId",
      "operation",
      "runId",
      "projectId",
      "documentId",
      "input",
      "configSchemaVersion",
      "config",
      "checkpoint",
      "deadlineMs",
    ],
    "pipeline invocation",
    errors,
  );
  if (!invocation) return errors;
  validateInvocationCommon(invocation, 1, errors);
  if (
    !PIPELINE_STEP_OPERATIONS_V1.includes(
      invocation.operation as "execute" | "resume",
    ) ||
    invocation.contributionId !== descriptor.id ||
    invocation.configSchemaVersion !== 1
  )
    errors.push(
      "pipeline invocation operation, contribution, or config version does not match",
    );
  boundaryId(invocation.runId, "pipeline runId", errors);
  boundaryId(invocation.projectId, "pipeline projectId", errors);
  if (invocation.documentId !== undefined)
    boundaryId(invocation.documentId, "pipeline documentId", errors);
  if (
    typeof invocation.deadlineMs === "number" &&
    invocation.deadlineMs > descriptor.limits.maxDeadlineMs
  )
    errors.push("pipeline invocation deadline exceeds descriptor limit");
  errors.push(
    ...validatePublicConfig(invocation.config, descriptor.configSchema),
  );
  validatePipelineArtifact(
    invocation.input,
    descriptor.input,
    descriptor.limits.maxInputBytes,
    "pipeline input",
    errors,
  );
  if (invocation.operation === "execute" && invocation.checkpoint !== undefined)
    errors.push("pipeline execute cannot include a checkpoint");
  if (invocation.operation === "resume") {
    if (!descriptor.resumable || !invocation.checkpoint)
      errors.push("pipeline step is not resumable or checkpoint is missing");
    const checkpoint = strictObject(
      invocation.checkpoint,
      ["schemaVersion", "value"],
      "pipeline checkpoint",
      errors,
    );
    if (
      checkpoint &&
      (checkpoint.schemaVersion !== descriptor.checkpointSchemaVersion ||
        !validatePublicJson(
          checkpoint.value,
          descriptor.limits.maxCheckpointBytes,
        ))
    )
      errors.push("plugin checkpoint is incompatible or oversized");
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.invocationBytes)
    errors.push("pipeline invocation is oversized");
  return errors;
}

export function validatePipelineStepResult(
  value: unknown,
  descriptor: PipelineStepContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  const result = strictObject(
    value,
    ["protocolVersion", "output", "checkpoint", "usage"],
    "pipeline result",
    errors,
  );
  if (!result) return errors;
  if (result.protocolVersion !== 1)
    errors.push("pipeline result protocolVersion must be 1");
  validatePipelineArtifact(
    result.output,
    descriptor.output,
    descriptor.limits.maxOutputBytes,
    "pipeline output",
    errors,
  );
  validateUsage(result.usage, errors);
  if (result.checkpoint !== undefined) {
    const checkpoint = strictObject(
      result.checkpoint,
      ["schemaVersion", "value"],
      "pipeline checkpoint",
      errors,
    );
    if (
      !descriptor.resumable ||
      !checkpoint ||
      checkpoint.schemaVersion !== descriptor.checkpointSchemaVersion ||
      !validatePublicJson(
        checkpoint.value,
        descriptor.limits.maxCheckpointBytes,
      )
    )
      errors.push("pipeline result checkpoint is incompatible or oversized");
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.resultBytes)
    errors.push("pipeline result is oversized");
  return errors;
}

export function validatePipelineStepCheckpointProgress(
  value: unknown,
  invocation: PipelineStepInvocationV1,
  descriptor: PipelineStepContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  const progress = strictObject(
    value,
    ["protocolVersion", "invocationId", "contributionId", "checkpoint"],
    "pipeline checkpoint progress",
    errors,
  );
  if (!progress) return errors;
  if (
    progress.protocolVersion !== 1 ||
    progress.invocationId !== invocation.invocationId ||
    progress.contributionId !== descriptor.id
  )
    errors.push("pipeline checkpoint progress identity is incompatible");
  const checkpoint = strictObject(
    progress.checkpoint,
    ["schemaVersion", "value"],
    "pipeline checkpoint progress value",
    errors,
  );
  if (
    !descriptor.resumable ||
    !checkpoint ||
    checkpoint.schemaVersion !== descriptor.checkpointSchemaVersion ||
    !validatePublicJson(checkpoint.value, descriptor.limits.maxCheckpointBytes)
  )
    errors.push("pipeline checkpoint progress is incompatible or oversized");
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.resultBytes)
    errors.push("pipeline checkpoint progress is oversized");
  return errors;
}

export function validatePipelineCheckpointMigrationInvocation(
  value: unknown,
  descriptor: PipelineStepContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  const invocation = strictObject(
    value,
    [
      "protocolVersion",
      "invocationId",
      "contributionId",
      "runId",
      "projectId",
      "documentId",
      "configSchemaVersion",
      "config",
      "sourceCheckpoint",
      "targetCheckpointSchemaVersion",
      "deadlineMs",
    ],
    "checkpoint migration invocation",
    errors,
  );
  if (!invocation) return errors;
  validateInvocationCommon(invocation, 1, errors);
  if (
    invocation.contributionId !== descriptor.id ||
    invocation.configSchemaVersion !== descriptor.configSchemaVersion ||
    invocation.targetCheckpointSchemaVersion !==
      descriptor.checkpointSchemaVersion
  )
    errors.push("checkpoint migration descriptor versions do not match");
  boundaryId(invocation.runId, "checkpoint migration runId", errors);
  boundaryId(invocation.projectId, "checkpoint migration projectId", errors);
  if (invocation.documentId !== undefined)
    boundaryId(
      invocation.documentId,
      "checkpoint migration documentId",
      errors,
    );
  errors.push(
    ...validatePublicConfig(invocation.config, descriptor.configSchema),
  );
  const source = strictObject(
    invocation.sourceCheckpoint,
    ["schemaVersion", "value"],
    "source checkpoint",
    errors,
  );
  if (
    !source ||
    !Number.isInteger(source.schemaVersion) ||
    (source.schemaVersion as number) < 1 ||
    !validatePublicJson(source.value, descriptor.limits.maxCheckpointBytes)
  )
    errors.push("source checkpoint is invalid or oversized");
  if (
    typeof invocation.deadlineMs === "number" &&
    invocation.deadlineMs > descriptor.limits.maxDeadlineMs
  )
    errors.push("checkpoint migration deadline exceeds descriptor limit");
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.invocationBytes)
    errors.push("checkpoint migration invocation is oversized");
  return errors;
}

export function validatePipelineCheckpointMigrationResult(
  value: unknown,
  descriptor: PipelineStepContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  const result = strictObject(
    value,
    ["protocolVersion", "checkpoint", "usage"],
    "checkpoint migration result",
    errors,
  );
  if (!result) return errors;
  if (result.protocolVersion !== 1)
    errors.push("checkpoint migration result protocolVersion must be 1");
  const checkpoint = strictObject(
    result.checkpoint,
    ["schemaVersion", "value"],
    "migrated checkpoint",
    errors,
  );
  if (
    !checkpoint ||
    checkpoint.schemaVersion !== descriptor.checkpointSchemaVersion ||
    !validatePublicJson(checkpoint.value, descriptor.limits.maxCheckpointBytes)
  )
    errors.push("migrated checkpoint is incompatible or oversized");
  validateUsage(result.usage, errors);
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.resultBytes)
    errors.push("checkpoint migration result is oversized");
  return errors;
}

function validateFailure(
  value: unknown,
  codes: ReadonlySet<string>,
  label: string,
): string[] {
  const errors: string[] = [];
  const failure = strictObject(
    value,
    ["protocolVersion", "invocationId", "code", "message", "retryable"],
    label,
    errors,
  );
  if (!failure) return errors;
  if (failure.protocolVersion !== 1)
    errors.push(`${label} protocolVersion must be 1`);
  boundaryId(failure.invocationId, `${label} invocationId`, errors);
  if (!codes.has(String(failure.code)))
    errors.push(`${label} code is unsupported`);
  boundaryString(failure.message, `${label} message`, 1_024, errors);
  if (typeof failure.retryable !== "boolean")
    errors.push(`${label} retryable must be boolean`);
  return errors;
}

const qaFailureCodes = new Set<string>([
  "invalid_input",
  "invalid_result",
  "permission_denied",
  "cancelled",
  "timeout",
  "host_crash",
  "protocol",
  "resource_limit",
  "stale_activation",
]);
const pipelineFailureCodes = new Set<string>([
  "invalid_input",
  "invalid_output",
  "permission_denied",
  "cancelled",
  "timeout",
  "host_crash",
  "protocol",
  "resource_limit",
  "stale_activation",
  "step_not_resumable",
  "plugin_checkpoint_incompatible",
]);

export function validateQaRuleFailure(value: unknown): string[] {
  return validateFailure(value, qaFailureCodes, "QA failure");
}

export function validatePipelineStepFailure(value: unknown): string[] {
  return validateFailure(value, pipelineFailureCodes, "pipeline failure");
}

export function validateContributionCancelRequest(value: unknown): string[] {
  const errors: string[] = [];
  const request = strictObject(
    value,
    ["protocolVersion", "invocationId"],
    "cancel request",
    errors,
  );
  if (!request) return errors;
  if (request.protocolVersion !== 1)
    errors.push("cancel request protocolVersion must be 1");
  boundaryId(request.invocationId, "cancel request invocationId", errors);
  return errors;
}

export function inspectContributionCompatibility(options: {
  descriptorVersion: number;
  operationProtocolVersion?: number;
  configSchemaVersion?: number;
  checkpointSchemaVersion?: number;
  resumable: boolean;
}): ContributionContractCompatibilityV1 {
  const descriptorVersionSupported = options.descriptorVersion === 1;
  const operationProtocolVersionSupported =
    options.operationProtocolVersion === 1;
  const configSchemaVersionSupported = options.configSchemaVersion === 1;
  const checkpointSchemaVersionSupported = options.resumable
    ? options.checkpointSchemaVersion === 1
    : options.checkpointSchemaVersion === undefined;
  const reasons = [
    ...(descriptorVersionSupported ? [] : ["unsupported_descriptor_version"]),
    ...(operationProtocolVersionSupported
      ? []
      : ["unsupported_operation_protocol_version"]),
    ...(configSchemaVersionSupported
      ? []
      : ["unsupported_config_schema_version"]),
    ...(checkpointSchemaVersionSupported
      ? []
      : ["unsupported_checkpoint_schema_version"]),
  ];
  return {
    compatible: reasons.length === 0,
    descriptorVersionSupported,
    operationProtocolVersionSupported,
    configSchemaVersionSupported,
    checkpointSchemaVersionSupported,
    reasons,
  };
}

function throwErrors(errors: string[], label: string): void {
  if (errors.length > 0) throw new TypeError(`${label}: ${errors.join("; ")}`);
}

interface PortableAbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

function createPortableAbortController(): PortableAbortController {
  let aborted = false;
  const signal = {
    get aborted() {
      return aborted;
    },
    get reason() {
      return aborted ? "plugin contribution cancelled" : undefined;
    },
    onabort: null,
    throwIfAborted() {
      if (aborted) throw new Error("plugin contribution cancelled");
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  } as AbortSignal;
  return {
    signal,
    abort() {
      aborted = true;
    },
  };
}

async function withInvocationSignal<T>(
  invocationId: string,
  active: Map<string, PortableAbortController>,
  operation: (context: ContributionInvocationContextV1) => T | Promise<T>,
  suppliedController?: PortableAbortController,
): Promise<T> {
  if (active.has(invocationId))
    throw new Error("invocationId is already active");
  const controller = suppliedController ?? createPortableAbortController();
  active.set(invocationId, controller);
  try {
    return await operation({ signal: controller.signal });
  } finally {
    active.delete(invocationId);
  }
}

function sandboxContributionFailure(
  error: unknown,
): Extract<SandboxContributionResultV1, { ok: false }> {
  const failure =
    error instanceof QaRuleHandlerError ||
    error instanceof PipelineStepHandlerError
      ? error.failure
      : undefined;
  return {
    protocolVersion: 1,
    ok: false,
    error: {
      code: failure?.code ?? "plugin_sandbox_failed",
      message: "plugin contribution invocation failed",
      retryable: failure?.retryable ?? false,
    },
  };
}

export function createSandboxQaRulePlugin(options: {
  descriptor: QaRuleContributionDescriptorV1;
  handler: QaRuleHandlerV1;
}): QaPipelineSandboxPluginV1 {
  throwErrors(
    validateQaRuleDescriptor(options.descriptor),
    "invalid QA descriptor",
  );
  const active = new Map<string, PortableAbortController>();
  return {
    async invoke(request) {
      try {
        if (
          request.contributionId !== options.descriptor.id ||
          request.operation !== "qa.evaluateSegment"
        )
          throw new Error("unsupported QA sandbox operation");
        const invocation = request.input as unknown as QaRuleInvocationV1;
        throwErrors(
          validateQaRuleInvocation(invocation, options.descriptor),
          "invalid QA invocation",
        );
        const result = await withInvocationSignal(
          invocation.invocationId,
          active,
          (context) => options.handler.evaluateSegment(invocation, context),
        );
        throwErrors(
          validateQaRuleResult(result, invocation, options.descriptor),
          "invalid QA result",
        );
        return {
          protocolVersion: 1,
          ok: true,
          output: result as unknown as PublicJsonValue,
        };
      } catch (error) {
        return sandboxContributionFailure(error);
      }
    },
    async deactivate() {
      for (const controller of active.values()) controller.abort();
      active.clear();
      await options.handler.shutdown?.();
    },
  };
}

export function createSandboxPipelineStepPlugin(options: {
  descriptor: PipelineStepContributionDescriptorV1;
  handler: PipelineStepHandlerV1;
}): QaPipelineSandboxPluginV1 {
  throwErrors(
    validatePipelineStepDescriptor(options.descriptor),
    "invalid pipeline descriptor",
  );
  const active = new Map<string, PortableAbortController>();
  return {
    async invoke(request, host) {
      try {
        if (
          request.contributionId !== options.descriptor.id ||
          ![
            "pipeline.execute",
            "pipeline.resume",
            "pipeline.checkpointMigrate",
          ].includes(request.operation)
        )
          throw new Error("unsupported pipeline sandbox operation");
        if (request.operation === "pipeline.checkpointMigrate") {
          const migration =
            request.input as unknown as PipelineCheckpointMigrationInvocationV1;
          throwErrors(
            validatePipelineCheckpointMigrationInvocation(
              migration,
              options.descriptor,
            ),
            "invalid checkpoint migration invocation",
          );
          if (!options.handler.migrateCheckpoint)
            throw new PipelineStepHandlerError({
              protocolVersion: 1,
              invocationId: migration.invocationId,
              code: "plugin_checkpoint_incompatible",
              message: "pipeline step has no checkpoint migration handler",
              retryable: false,
            });
          const result = await withInvocationSignal(
            migration.invocationId,
            active,
            (context) =>
              options.handler.migrateCheckpoint?.(migration, context) as
                | PipelineCheckpointMigrationResultV1
                | Promise<PipelineCheckpointMigrationResultV1>,
          );
          throwErrors(
            validatePipelineCheckpointMigrationResult(
              result,
              options.descriptor,
            ),
            "invalid checkpoint migration result",
          );
          return {
            protocolVersion: 1,
            ok: true,
            output: result as unknown as PublicJsonValue,
          };
        }
        const invocation = request.input as unknown as PipelineStepInvocationV1;
        throwErrors(
          validatePipelineStepInvocation(invocation, options.descriptor),
          "invalid pipeline invocation",
        );
        let checkpointOpen = true;
        let checkpointSequence = 0;
        const result = await withInvocationSignal(
          invocation.invocationId,
          active,
          (context) => {
            const pipelineContext: PipelineStepInvocationContextV1 = {
              signal: context.signal,
              publishCheckpoint(checkpoint) {
                if (!checkpointOpen || context.signal.aborted || !host)
                  throw new Error(
                    "pipeline checkpoint publication is unavailable",
                  );
                const progress: PipelineStepCheckpointProgressV1 = {
                  protocolVersion: 1,
                  invocationId: invocation.invocationId,
                  contributionId: invocation.contributionId,
                  checkpoint,
                };
                throwErrors(
                  validatePipelineStepCheckpointProgress(
                    progress,
                    invocation,
                    options.descriptor,
                  ),
                  "invalid pipeline checkpoint progress",
                );
                checkpointSequence += 1;
                host.call({
                  protocolVersion: 1,
                  requestId: `${invocation.invocationId}.checkpoint.${checkpointSequence}`,
                  method: "pipeline.checkpoint",
                  params: progress as unknown as PublicJsonValue,
                });
              },
            };
            if (invocation.operation === "execute")
              return options.handler.execute(
                invocation as PipelineStepInvocationV1 & {
                  operation: "execute";
                },
                pipelineContext,
              );
            if (!options.handler.resume)
              throw new PipelineStepHandlerError({
                protocolVersion: 1,
                invocationId: invocation.invocationId,
                code: "step_not_resumable",
                message: "pipeline step is not resumable",
                retryable: false,
              });
            return options.handler.resume(
              invocation as PipelineStepInvocationV1 & { operation: "resume" },
              pipelineContext,
            );
          },
        ).finally(() => {
          checkpointOpen = false;
        });
        throwErrors(
          validatePipelineStepResult(result, options.descriptor),
          "invalid pipeline result",
        );
        return {
          protocolVersion: 1,
          ok: true,
          output: result as unknown as PublicJsonValue,
        };
      } catch (error) {
        return sandboxContributionFailure(error);
      }
    },
    async deactivate() {
      for (const controller of active.values()) controller.abort();
      active.clear();
      await options.handler.shutdown?.();
    },
  };
}

export interface ProcessQaPipelinePluginOptionsV1 {
  manifest: {
    id: string;
    contributions: Array<
      | QaRuleContributionDescriptorV1
      | PipelineStepContributionDescriptorV1
      | Record<string, unknown>
    >;
  };
  qaRules?: Record<string, QaRuleHandlerV1>;
  pipelineSteps?: Record<string, PipelineStepHandlerV1>;
}

interface JsonRpcRequestV1 {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
}

function writeRpcResult(id: number, result: unknown): void {
  output.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function writeRpcNotification(method: string, params: unknown): void {
  output.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function safeProcessFailure(
  error: unknown,
  invocationId: string,
): QaRuleFailureV1 | PipelineStepFailureV1 {
  if (
    error instanceof QaRuleHandlerError ||
    error instanceof PipelineStepHandlerError
  )
    return error.failure;
  const code =
    error instanceof Error && error.message.includes("timed out")
      ? "timeout"
      : "protocol";
  return {
    protocolVersion: 1,
    invocationId,
    code,
    message: "plugin contribution invocation failed",
    retryable: false,
  };
}

function writeRpcFailure(
  id: number,
  failure: QaRuleFailureV1 | PipelineStepFailureV1,
): void {
  output.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32020, message: "plugin contribution invocation failed", data: failure } })}\n`,
  );
}

export function startProcessQaPipelinePlugin(
  options: ProcessQaPipelinePluginOptionsV1,
): void {
  const qaDescriptors = new Map<string, QaRuleContributionDescriptorV1>();
  const pipelineDescriptors = new Map<
    string,
    PipelineStepContributionDescriptorV1
  >();
  for (const contribution of options.manifest.contributions) {
    if (
      contribution.kind === "qaRule" &&
      contribution.operationProtocolVersion === 1
    ) {
      throwErrors(
        validateQaRuleDescriptor(contribution),
        "invalid QA descriptor",
      );
      qaDescriptors.set(
        contribution.id as string,
        contribution as unknown as QaRuleContributionDescriptorV1,
      );
    }
    if (
      contribution.kind === "pipelineStep" &&
      contribution.operationProtocolVersion === 1
    ) {
      throwErrors(
        validatePipelineStepDescriptor(contribution),
        "invalid pipeline descriptor",
      );
      pipelineDescriptors.set(
        contribution.id as string,
        contribution as unknown as PipelineStepContributionDescriptorV1,
      );
    }
  }
  for (const id of qaDescriptors.keys())
    if (!options.qaRules?.[id]) throw new Error(`missing QA handler ${id}`);
  for (const id of pipelineDescriptors.keys())
    if (!options.pipelineSteps?.[id])
      throw new Error(`missing pipeline handler ${id}`);
  const active = new Map<
    string,
    {
      controller: PortableAbortController;
      cancel?: (id: string) => void | Promise<void>;
    }
  >();
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on(
    "line",
    (line) =>
      void handleQaPipelineProcessLine(
        line,
        options,
        qaDescriptors,
        pipelineDescriptors,
        active,
      ),
  );
}

async function handleQaPipelineProcessLine(
  line: string,
  options: ProcessQaPipelinePluginOptionsV1,
  qaDescriptors: Map<string, QaRuleContributionDescriptorV1>,
  pipelineDescriptors: Map<string, PipelineStepContributionDescriptorV1>,
  active: Map<
    string,
    {
      controller: PortableAbortController;
      cancel?: (id: string) => void | Promise<void>;
    }
  >,
): Promise<void> {
  if (!line.trim()) return;
  let request: JsonRpcRequestV1;
  try {
    request = JSON.parse(line) as JsonRpcRequestV1;
  } catch {
    return;
  }
  const id = typeof request.id === "number" ? request.id : undefined;
  let invocationId = "unknown";
  try {
    if (request.jsonrpc !== "2.0") throw new Error("jsonrpc must be 2.0");
    if (request.method === "plugin.handshake") {
      if (id !== undefined)
        writeRpcResult(id, {
          apiVersion: 1,
          pluginId: options.manifest.id,
          contributions: options.manifest.contributions,
        });
      return;
    }
    if (request.method === "plugin.shutdown") {
      for (const item of active.values()) item.controller.abort();
      active.clear();
      await Promise.all([
        ...Object.values(options.qaRules ?? {}).map((handler) =>
          handler.shutdown?.(),
        ),
        ...Object.values(options.pipelineSteps ?? {}).map((handler) =>
          handler.shutdown?.(),
        ),
      ]);
      if (id !== undefined) writeRpcResult(id, {});
      setTimeout(() => process.exit(0), 0).unref?.();
      return;
    }
    if (
      request.method === "qa.cancel" ||
      request.method === "pipeline.cancel"
    ) {
      if (validateContributionCancelRequest(request.params).length > 0) return;
      const cancel = request.params as ContributionCancelRequestV1;
      const current = active.get(cancel.invocationId);
      current?.controller.abort();
      await current?.cancel?.(cancel.invocationId);
      if (id !== undefined) writeRpcResult(id, {});
      return;
    }
    if (request.method === "qa.evaluateSegment") {
      const raw = request.params as QaRuleInvocationV1;
      invocationId = raw?.invocationId ?? "unknown";
      const descriptor = qaDescriptors.get(raw?.contributionId);
      const handler = options.qaRules?.[raw?.contributionId];
      if (!descriptor || !handler) throw new Error("unknown QA contribution");
      throwErrors(
        validateQaRuleInvocation(raw, descriptor),
        "invalid QA invocation",
      );
      if (active.has(raw.invocationId))
        throw new Error("invocationId is already active");
      const controller = createPortableAbortController();
      active.set(raw.invocationId, {
        controller,
        ...(handler.cancel ? { cancel: handler.cancel.bind(handler) } : {}),
      });
      try {
        const result = await withInvocationSignal(
          raw.invocationId,
          new Map(),
          (context) => handler.evaluateSegment(raw, context),
          controller,
        );
        throwErrors(
          validateQaRuleResult(result, raw, descriptor),
          "invalid QA result",
        );
        if (id !== undefined) writeRpcResult(id, result);
      } finally {
        active.delete(raw.invocationId);
      }
      return;
    }
    if (request.method === "pipeline.checkpointMigrate") {
      const raw = request.params as PipelineCheckpointMigrationInvocationV1;
      invocationId = raw?.invocationId ?? "unknown";
      const descriptor = pipelineDescriptors.get(raw?.contributionId);
      const handler = options.pipelineSteps?.[raw?.contributionId];
      if (!descriptor || !handler)
        throw new Error("unknown pipeline contribution");
      throwErrors(
        validatePipelineCheckpointMigrationInvocation(raw, descriptor),
        "invalid checkpoint migration invocation",
      );
      if (!handler.migrateCheckpoint)
        throw new PipelineStepHandlerError({
          protocolVersion: 1,
          invocationId: raw.invocationId,
          code: "plugin_checkpoint_incompatible",
          message: "pipeline step has no checkpoint migration handler",
          retryable: false,
        });
      if (active.has(raw.invocationId))
        throw new Error("invocationId is already active");
      const controller = createPortableAbortController();
      active.set(raw.invocationId, {
        controller,
        ...(handler.cancel ? { cancel: handler.cancel.bind(handler) } : {}),
      });
      try {
        const result = await withInvocationSignal(
          raw.invocationId,
          new Map(),
          (context) =>
            handler.migrateCheckpoint?.(raw, context) as
              | PipelineCheckpointMigrationResultV1
              | Promise<PipelineCheckpointMigrationResultV1>,
          controller,
        );
        throwErrors(
          validatePipelineCheckpointMigrationResult(result, descriptor),
          "invalid checkpoint migration result",
        );
        if (id !== undefined) writeRpcResult(id, result);
      } finally {
        active.delete(raw.invocationId);
      }
      return;
    }
    if (
      request.method === "pipeline.execute" ||
      request.method === "pipeline.resume"
    ) {
      const raw = request.params as PipelineStepInvocationV1;
      invocationId = raw?.invocationId ?? "unknown";
      const descriptor = pipelineDescriptors.get(raw?.contributionId);
      const handler = options.pipelineSteps?.[raw?.contributionId];
      if (!descriptor || !handler)
        throw new Error("unknown pipeline contribution");
      throwErrors(
        validatePipelineStepInvocation(raw, descriptor),
        "invalid pipeline invocation",
      );
      if (active.has(raw.invocationId))
        throw new Error("invocationId is already active");
      const controller = createPortableAbortController();
      active.set(raw.invocationId, {
        controller,
        ...(handler.cancel ? { cancel: handler.cancel.bind(handler) } : {}),
      });
      let checkpointOpen = true;
      try {
        const result = await withInvocationSignal(
          raw.invocationId,
          new Map(),
          (context) => {
            const pipelineContext: PipelineStepInvocationContextV1 = {
              signal: context.signal,
              publishCheckpoint(checkpoint) {
                if (!checkpointOpen || context.signal.aborted)
                  throw new Error(
                    "pipeline checkpoint publication is unavailable",
                  );
                const progress: PipelineStepCheckpointProgressV1 = {
                  protocolVersion: 1,
                  invocationId: raw.invocationId,
                  contributionId: raw.contributionId,
                  checkpoint,
                };
                throwErrors(
                  validatePipelineStepCheckpointProgress(
                    progress,
                    raw,
                    descriptor,
                  ),
                  "invalid pipeline checkpoint progress",
                );
                writeRpcNotification("pipeline.checkpoint", progress);
              },
            };
            if (raw.operation === "execute")
              return handler.execute(
                raw as PipelineStepInvocationV1 & { operation: "execute" },
                pipelineContext,
              );
            if (!handler.resume)
              throw new PipelineStepHandlerError({
                protocolVersion: 1,
                invocationId: raw.invocationId,
                code: "step_not_resumable",
                message: "pipeline step is not resumable",
                retryable: false,
              });
            return handler.resume(
              raw as PipelineStepInvocationV1 & { operation: "resume" },
              pipelineContext,
            );
          },
          controller,
        );
        throwErrors(
          validatePipelineStepResult(result, descriptor),
          "invalid pipeline result",
        );
        if (id !== undefined) writeRpcResult(id, result);
      } finally {
        checkpointOpen = false;
        active.delete(raw.invocationId);
      }
      return;
    }
    throw new Error("unsupported plugin process operation");
  } catch (error) {
    if (id !== undefined)
      writeRpcFailure(id, safeProcessFailure(error, invocationId));
  }
}
