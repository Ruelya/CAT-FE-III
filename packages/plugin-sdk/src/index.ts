import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createHash } from "node:crypto";

import type {
  AiActionContributionDescriptor,
  UiPanelContributionDescriptor,
} from "./ai-ui.js";
import {
  validateAiActionDescriptor,
  validateUiPanelDescriptor,
} from "./ai-ui.js";
import type {
  PipelineStepContributionDescriptorV1,
  QaRuleContributionDescriptorV1,
} from "./qa-pipeline.js";
import {
  validatePipelineStepDescriptor,
  validateQaRuleDescriptor,
} from "./qa-pipeline.js";

export * from "./ai-ui.js";
export * from "./qa-pipeline.js";

export const HOST_API_VERSION = 1;
export const NORMALIZED_MANIFEST_VERSION = 1;
export const RUNTIME_DESCRIPTOR_VERSION = 1;
export const CONTRIBUTION_DESCRIPTOR_VERSION = 1;
export const PROCESS_PROTOCOL_VERSION = 1;
export const DECLARATIVE_DEFINITION_VERSION = 1;
export const SANDBOX_PROTOCOL_VERSION = 1;
export const SANDBOX_BRIDGE_VERSION = 1;
export const ENGINE_CONNECTOR_CONTRACT_VERSION = 1;
export const ENGINE_CONNECTOR_PROTOCOL_V1 =
  "translunar.engineConnector.v1" as const;
export const ENGINE_CONNECTOR_CONFIG_SCHEMA_VERSION = 1;
export const MAX_ENGINE_CONNECTOR_CREDENTIAL_BYTES = 16 * 1024;

export const ENGINE_CONNECTOR_LIMITS = Object.freeze({
  configBytes: 64 * 1024,
  configFields: 64,
  configKeyBytes: 64,
  configValueBytes: 4 * 1024,
  messages: 128,
  messageBytes: 64 * 1024,
  sourceTextBytes: 1024 * 1024,
  outputBytes: 4 * 1024 * 1024,
  events: 8_192,
  models: 256,
  modelIdBytes: 256,
  deadlineMs: 120_000,
  requestIdBytes: 128,
  localeBytes: 64,
  errorMessageBytes: 1024,
  endpointBytes: 2_048,
  headers: 32,
  headerNameBytes: 128,
  headerValueBytes: 1024,
  jsonPathDepth: 16,
  jsonPathSegmentBytes: 128,
} as const);

export const SANDBOX_LIMITS = Object.freeze({
  heapBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  initializationMs: 1_000,
  invocationMs: 2_000,
  shutdownMs: 500,
  moduleBytes: 1024 * 1024,
  aggregateModuleBytes: 8 * 1024 * 1024,
  moduleCount: 128,
  pendingRequests: 32,
  invocationJsonBytes: 1024 * 1024,
  hostCallJsonBytes: 256 * 1024,
  jsonDepth: 16,
  hostCallsPerInvocation: 256,
  diagnosticBytes: 4 * 1024,
} as const);

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SandboxErrorCode =
  | "plugin_sandbox_failed"
  | "sandbox_cancelled"
  | "sandbox_timeout"
  | "sandbox_overloaded"
  | "sandbox_resource_limit"
  | "sandbox_invalid_module"
  | "sandbox_invalid_message"
  | "host_method_unsupported"
  | "host_call_denied";

export interface SafePluginErrorV1 {
  code: SandboxErrorCode;
  message: string;
  retryable: boolean;
}

export interface SandboxLifecycleContextV1 {
  protocolVersion: 1;
  pluginId: string;
  version: string;
}

export interface SandboxInvocationV1 {
  protocolVersion: 1;
  invocationId: string;
  contributionId: string;
  operation: string;
  input: JsonValue;
}

export interface SandboxInvocationContextV1 {
  /** Host-only ephemeral value. It is deliberately outside SandboxInvocationV1. */
  readonly credential?: string;
}

export type SandboxResultV1 =
  | { protocolVersion: 1; ok: true; output: JsonValue }
  | { protocolVersion: 1; ok: false; error: SafePluginErrorV1 };

export interface SandboxHostCallV1 {
  protocolVersion: 1;
  requestId: string;
  method: string;
  params: JsonValue;
}

export interface SandboxHostV1 {
  call(request: SandboxHostCallV1): Promise<JsonValue>;
}

export interface SandboxPluginV1 {
  activate?(context: SandboxLifecycleContextV1): void | Promise<void>;
  invoke(
    request: SandboxInvocationV1,
    host: SandboxHostV1,
    context?: SandboxInvocationContextV1,
  ): unknown | Promise<unknown>;
  deactivate?(context: SandboxLifecycleContextV1): void | Promise<void>;
}

export type PluginPanelMessageV1 =
  | { version: 1; type: "ready"; nonce: string }
  | {
      version: 1;
      type: "request";
      id: string;
      method: string;
      params: JsonValue;
    }
  | { version: 1; type: "cancel"; id: string };

export type HostPanelMessageV1 =
  | { version: 1; type: "context"; context: JsonValue }
  | { version: 1; type: "result"; id: string; result: JsonValue }
  | { version: 1; type: "error"; id: string; error: SafePluginErrorV1 }
  | { version: 1; type: "revoked"; reason: string };

export interface FilterCapabilities {
  import: boolean;
  export: boolean;
  validate: boolean;
  inlineTags: boolean;
  notes: boolean;
  degradationReport: boolean;
}

export interface FilterDescriptor {
  id: string;
  version: string;
  displayName: string;
  extensions: string[];
  capabilities: FilterCapabilities;
}

export interface PluginManifest {
  manifestVersion: 1;
  id: string;
  displayName: string;
  version: string;
  apiVersion: number;
  apiVersionMin: number;
  tier: "process";
  entry: { kind: "node" | "executable"; path: string };
  contributions: { filters: FilterDescriptor[] };
  permissions: string[];
  capabilities?: PluginCapabilityRequest[];
}

export type PluginTier = "declarative" | "sandbox" | "process";

export const PLUGIN_CAPABILITY_IDS = [
  "file.read",
  "file.write",
  "network.connect",
  "asset.read",
  "asset.write",
  "project.read",
  "project.write",
  "engine.connector",
  "qa.register",
  "pipeline.register",
  "ai.action",
  "ui.panel",
  "external.connector",
  "diagnostics.read",
] as const;

export type KnownPluginCapabilityId = (typeof PLUGIN_CAPABILITY_IDS)[number];
export type PluginCapabilityId =
  | KnownPluginCapabilityId
  | (string & { readonly __pluginCapabilityIdExtension?: never });
export type PluginFileArea = "source" | "output";
export type PluginCapabilityScope =
  | { kind: "unscoped" }
  | { kind: "file"; areas: PluginFileArea[] }
  | { kind: "network"; origins: string[] }
  | { kind: "projects"; projectIds: string[] }
  | { kind: "assets"; projectIds: string[]; assetIds: string[] }
  | { kind: "operations"; operations: string[] }
  | { kind: "contributions"; contributionIds: string[] }
  | { kind: "diagnostics"; categories: string[] };

export interface PluginCapabilityRequest {
  capabilityId: PluginCapabilityId;
  required?: boolean;
  scope: PluginCapabilityScope;
  contributionId?: string;
}

export type PluginRuntimeDescriptor =
  | {
      tier: "declarative";
      runtimeVersion: 1;
      entry: { kind: "manifest" };
    }
  | {
      tier: "sandbox";
      runtimeVersion: 1;
      entry: { kind: "javascript"; path: string; exportName?: string };
    }
  | {
      tier: "process";
      runtimeVersion: 1;
      protocolVersion: 1;
      entry: { kind: "node" | "executable"; path: string };
    };

export interface FilterContributionDescriptor extends FilterDescriptor {
  kind: "filter";
  descriptorVersion: 1;
  declarative?: DeclarativeFilterDefinitionV1;
}

export interface DeclarativeFilterDefinitionV1 {
  definitionVersion: 1;
  encoding: "utf8";
  probeHeaderPattern?: string;
  unitPattern: string;
  limits: {
    maxSourceBytes: number;
    maxOutputBytes: number;
    maxUnits: number;
    maxUnitBytes: number;
    maxCaptureBytes: number;
    probeHeaderBytes: number;
  };
}

export type QaField = "source" | "target" | "both";
export type QaSeverity = "error" | "warning" | "info";

export interface DeclarativeQaRegexRule {
  id: string;
  label: string;
  field: QaField;
  pattern: string;
  severity: QaSeverity;
  message: string;
  replacementHint?: string;
}

export interface DeclarativeQaPackDefinitionV1 {
  definitionVersion: 1;
  rules: DeclarativeQaRegexRule[];
}

export type ArtifactKind =
  "none" | "project" | "document" | "segments" | "qaFindings" | "json";

export type DeclarativePipelineOperation =
  | { operation: "select"; path: string[] }
  | { operation: "set"; path: string[]; value: unknown }
  | { operation: "assert"; path: string[]; equals: unknown }
  | {
      operation: "regexReplace";
      path: string[];
      pattern: string;
      replacement: string;
      maxReplacements: number;
    };

export interface DeclarativePipelineDefinitionV1 {
  definitionVersion: 1;
  input: ArtifactKind;
  output: ArtifactKind;
  operations: DeclarativePipelineOperation[];
  maxInputBytes: number;
  maxOutputBytes: number;
}

export const ENGINE_CONNECTOR_OPERATIONS_V1 = [
  "validateConfig",
  "test",
  "models.list",
  "generate",
] as const;

export type EngineConnectorOperationV1 =
  (typeof ENGINE_CONNECTOR_OPERATIONS_V1)[number];
export type EngineConnectorConfigValueV1 = string | boolean | number;
export type EngineConnectorConfigV1 = Record<
  string,
  EngineConnectorConfigValueV1
>;
export type EngineConnectorConfigFieldTypeV1 =
  "text" | "boolean" | "integer" | "select";

export interface EngineConnectorConfigOptionV1 {
  value: string;
  label: string;
}

export interface EngineConnectorConfigFieldV1 {
  key: string;
  label: string;
  fieldType: EngineConnectorConfigFieldTypeV1;
  required: boolean;
  description?: string;
  defaultValue?: EngineConnectorConfigValueV1;
  min?: number;
  max?: number;
  options?: EngineConnectorConfigOptionV1[];
}

export interface EngineConnectorConfigSchemaV1 {
  schemaVersion: 1;
  fields: EngineConnectorConfigFieldV1[];
}

export interface EngineConnectorLimitsV1 {
  maxConfigBytes: number;
  maxMessages: number;
  maxMessageBytes: number;
  maxSourceTextBytes: number;
  maxOutputBytes: number;
  maxEvents: number;
  maxModels: number;
  maxModelIdBytes: number;
  maxDeadlineMs: number;
}

export interface DeclarativeConnectorHeaderV1 {
  name: string;
  value: string;
}

export interface DeclarativeConnectorEndpointV1 {
  destinationOrigin: string;
  urlTemplate: string;
  method: "POST";
}

export type DeclarativeConnectorAuthenticationV1 =
  { kind: "none" } | { kind: "bearer" } | { kind: "header"; name: string };

export interface DeclarativeConnectorRequestMappingV1 {
  fixedBody?: Record<string, JsonValue>;
  modelPath: string[];
  messagesPath: string[];
  sourceTextPath?: string[];
  sourceLocalePath?: string[];
  targetLocalePath?: string[];
  streamPath?: string[];
}

export interface DeclarativeConnectorUsageMappingV1 {
  inputTokensPath?: string[];
  outputTokensPath?: string[];
  totalTokensPath?: string[];
}

export type DeclarativeConnectorResponseMappingV1 =
  | {
      kind: "json";
      textPath: string[];
      finishReasonPath?: string[];
      usage?: DeclarativeConnectorUsageMappingV1;
    }
  | {
      kind: "serverSentEvents";
      deltaPath: string[];
      finishReasonPath?: string[];
      usage?: DeclarativeConnectorUsageMappingV1;
      doneMarker: string;
      maxLineBytes: number;
    };

export type EngineConnectorFailureCodeV1 =
  | "invalidConfig"
  | "authentication"
  | "rateLimit"
  | "timeout"
  | "unavailable"
  | "protocol"
  | "responseSize"
  | "cancelled"
  | "hostCrash";

export interface DeclarativeConnectorFailureMappingV1 {
  status: number;
  code: EngineConnectorFailureCodeV1;
  retryable: boolean;
}

export interface DeclarativeEngineConnectorDefinitionV1 {
  definitionVersion: 1;
  endpoint: DeclarativeConnectorEndpointV1;
  fixedHeaders?: DeclarativeConnectorHeaderV1[];
  authentication: DeclarativeConnectorAuthenticationV1;
  request: DeclarativeConnectorRequestMappingV1;
  response: DeclarativeConnectorResponseMappingV1;
  failures?: DeclarativeConnectorFailureMappingV1[];
}

interface EngineConnectorContributionDescriptorBase {
  kind: "engineConnector";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  protocol: string;
  operations: string[];
  configSchemaVersion: number;
}

/** Released inventory-only shape. It remains readable but is incompatible. */
export interface LegacyEngineConnectorContributionDescriptor extends EngineConnectorContributionDescriptorBase {
  contractVersion?: undefined;
  configSchema?: undefined;
  limits?: undefined;
  declarative?: undefined;
}

export interface EngineConnectorContributionDescriptorV1 extends EngineConnectorContributionDescriptorBase {
  protocol: typeof ENGINE_CONNECTOR_PROTOCOL_V1;
  contractVersion: 1;
  operations: EngineConnectorOperationV1[];
  configSchema: EngineConnectorConfigSchemaV1;
  limits: EngineConnectorLimitsV1;
  declarative?: DeclarativeEngineConnectorDefinitionV1;
}

export type EngineConnectorContributionDescriptor =
  | LegacyEngineConnectorContributionDescriptor
  | EngineConnectorContributionDescriptorV1;

export type EngineConnectorMessageRoleV1 = "system" | "user" | "assistant";

export interface EngineConnectorMessageV1 {
  role: EngineConnectorMessageRoleV1;
  content: string;
}

interface EngineConnectorRequestBaseV1 {
  contractVersion: 1;
  requestId: string;
  config: EngineConnectorConfigV1;
  deadlineMs: number;
}

export interface EngineConnectorValidateConfigRequestV1 extends EngineConnectorRequestBaseV1 {
  operation: "validateConfig";
}

export interface EngineConnectorTestRequestV1 extends EngineConnectorRequestBaseV1 {
  operation: "test";
  model?: string;
  sourceLocale: string;
  targetLocale: string;
}

export interface EngineConnectorModelsListRequestV1 extends EngineConnectorRequestBaseV1 {
  operation: "models.list";
  cursor?: string;
  limit: number;
}

export interface EngineConnectorGenerateRequestV1 extends EngineConnectorRequestBaseV1 {
  operation: "generate";
  sourceLocale: string;
  targetLocale: string;
  sourceText: string;
  messages: EngineConnectorMessageV1[];
  model: string;
}

export type EngineConnectorRequestV1 =
  | EngineConnectorValidateConfigRequestV1
  | EngineConnectorTestRequestV1
  | EngineConnectorModelsListRequestV1
  | EngineConnectorGenerateRequestV1;

export interface EngineConnectorConfigIssueV1 {
  field: string;
  code: string;
  message: string;
}

export interface EngineConnectorConfigValidationResultV1 {
  valid: boolean;
  issues: EngineConnectorConfigIssueV1[];
}

export interface EngineConnectorTestResultV1 {
  ok: boolean;
  latencyMs: number;
  model?: string;
}

export interface EngineConnectorModelV1 {
  id: string;
  displayName: string;
  contextTokens?: number;
}

export interface EngineConnectorModelCatalogV1 {
  models: EngineConnectorModelV1[];
  nextCursor?: string;
}

export interface EngineConnectorUsageV1 {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type EngineConnectorFinishReasonV1 = "stop" | "length" | "contentFilter";

export interface EngineConnectorResultV1 {
  outputText: string;
  model: string;
  finishReason: EngineConnectorFinishReasonV1;
  usage?: EngineConnectorUsageV1;
}

interface EngineConnectorEventBaseV1 {
  contractVersion: 1;
  requestId: string;
  sequence: number;
}

export type EngineConnectorEventV1 =
  | (EngineConnectorEventBaseV1 & { kind: "delta"; text: string })
  | (EngineConnectorEventBaseV1 & {
      kind: "usage";
      usage: EngineConnectorUsageV1;
    })
  | (EngineConnectorEventBaseV1 & {
      kind: "completed";
      result: EngineConnectorResultV1;
    });

export interface EngineConnectorFailureV1 {
  contractVersion: 1;
  requestId: string;
  code: EngineConnectorFailureCodeV1;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface EngineConnectorCancelRequestV1 {
  contractVersion: 1;
  requestId: string;
}

export interface EngineConnectorShutdownRequestV1 {
  contractVersion: 1;
}

export interface EngineConnectorInvocationContextV1 {
  /** One Engine-selected credential for this invocation; never persist it. */
  readonly credential?: string;
  readonly signal: AbortSignal;
}

export interface EngineConnectorHandlerV1 {
  validateConfig(
    request: EngineConnectorValidateConfigRequestV1,
    context: EngineConnectorInvocationContextV1,
  ):
    | EngineConnectorConfigValidationResultV1
    | Promise<EngineConnectorConfigValidationResultV1>;
  test(
    request: EngineConnectorTestRequestV1,
    context: EngineConnectorInvocationContextV1,
  ): EngineConnectorTestResultV1 | Promise<EngineConnectorTestResultV1>;
  listModels?(
    request: EngineConnectorModelsListRequestV1,
    context: EngineConnectorInvocationContextV1,
  ): EngineConnectorModelCatalogV1 | Promise<EngineConnectorModelCatalogV1>;
  generate(
    request: EngineConnectorGenerateRequestV1,
    context: EngineConnectorInvocationContextV1,
  ): AsyncIterable<EngineConnectorEventV1>;
  cancel(request: EngineConnectorCancelRequestV1): void | Promise<void>;
  shutdown(request: EngineConnectorShutdownRequestV1): void | Promise<void>;
}

export class EngineConnectorHandlerError extends Error {
  readonly failure: EngineConnectorFailureV1;

  constructor(failure: EngineConnectorFailureV1) {
    const errors = validateEngineConnectorFailure(failure);
    if (errors.length > 0) {
      throw new TypeError(`invalid connector failure: ${errors.join("; ")}`);
    }
    super(failure.message);
    this.name = "EngineConnectorHandlerError";
    this.failure = failure;
  }
}

export interface SandboxEngineConnectorOptionsV1 {
  contributionId: string;
  handler: EngineConnectorHandlerV1;
  limits?: EngineConnectorLimitsV1;
}

export interface ProcessEngineConnectorOptionsV1 {
  manifest: PluginManifestV2;
  contributionId: string;
  handler: EngineConnectorHandlerV1;
}

export interface LegacyQaRuleContributionDescriptor {
  kind: "qaRule";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  ruleType: string;
  severity: string;
  definition: Record<string, unknown>;
  declarative?: DeclarativeQaPackDefinitionV1;
  config?: Record<string, unknown>;
  operationProtocolVersion?: undefined;
}

export type QaRuleContributionDescriptor =
  LegacyQaRuleContributionDescriptor | QaRuleContributionDescriptorV1;

export interface LegacyPipelineStepContributionDescriptor {
  kind: "pipelineStep";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  input: unknown;
  output: unknown;
  configSchemaVersion: number;
  resumable: boolean;
  cancellable: boolean;
  declarative?: DeclarativePipelineDefinitionV1;
  operationProtocolVersion?: undefined;
}

export type PipelineStepContributionDescriptor =
  | LegacyPipelineStepContributionDescriptor
  | PipelineStepContributionDescriptorV1;

export interface ExternalConnectorContributionDescriptor {
  kind: "externalConnector";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  transports: string[];
  checkpointVersion: number;
  capabilities: Record<string, boolean>;
}

export type PluginContributionDescriptor =
  | FilterContributionDescriptor
  | EngineConnectorContributionDescriptor
  | QaRuleContributionDescriptor
  | PipelineStepContributionDescriptor
  | AiActionContributionDescriptor
  | UiPanelContributionDescriptor
  | ExternalConnectorContributionDescriptor;

export interface PluginManifestV2 {
  manifestVersion: 2;
  id: string;
  displayName: string;
  version: string;
  hostApi: { min: number; max: number };
  runtime: PluginRuntimeDescriptor;
  contributions: PluginContributionDescriptor[];
  permissions: string[];
  capabilities?: PluginCapabilityRequest[];
}

export interface NormalizedPluginManifest {
  normalizedVersion: 1;
  sourceManifestVersion: 1 | 2;
  id: string;
  displayName: string;
  version: string;
  hostApi: { min: number; max: number };
  runtime: PluginRuntimeDescriptor;
  contributions: PluginContributionDescriptor[];
  requestedPermissions: string[];
  requestedCapabilities: PluginCapabilityRequest[];
  originalManifestJson: Record<string, unknown>;
}

export function defineDeclarativeFilter(
  contribution: Omit<
    FilterContributionDescriptor,
    "kind" | "descriptorVersion"
  > & { declarative: DeclarativeFilterDefinitionV1 },
): FilterContributionDescriptor {
  return {
    kind: "filter",
    descriptorVersion: CONTRIBUTION_DESCRIPTOR_VERSION,
    ...contribution,
  };
}

export function defineDeclarativeQaPack(
  contribution: Omit<
    LegacyQaRuleContributionDescriptor,
    "kind" | "descriptorVersion" | "ruleType"
  > & { declarative: DeclarativeQaPackDefinitionV1 },
): LegacyQaRuleContributionDescriptor {
  return {
    kind: "qaRule",
    descriptorVersion: CONTRIBUTION_DESCRIPTOR_VERSION,
    ruleType: "regexPack",
    ...contribution,
  };
}

export function defineDeclarativePipelineStep(
  contribution: Omit<
    LegacyPipelineStepContributionDescriptor,
    | "kind"
    | "descriptorVersion"
    | "input"
    | "output"
    | "configSchemaVersion"
    | "resumable"
    | "cancellable"
  > & { declarative: DeclarativePipelineDefinitionV1 },
): LegacyPipelineStepContributionDescriptor {
  return {
    kind: "pipelineStep",
    descriptorVersion: CONTRIBUTION_DESCRIPTOR_VERSION,
    input: contribution.declarative.input,
    output: contribution.declarative.output,
    configSchemaVersion: DECLARATIVE_DEFINITION_VERSION,
    resumable: false,
    cancellable: true,
    ...contribution,
  };
}

export function defaultEngineConnectorLimits(): EngineConnectorLimitsV1 {
  return {
    maxConfigBytes: ENGINE_CONNECTOR_LIMITS.configBytes,
    maxMessages: ENGINE_CONNECTOR_LIMITS.messages,
    maxMessageBytes: ENGINE_CONNECTOR_LIMITS.messageBytes,
    maxSourceTextBytes: ENGINE_CONNECTOR_LIMITS.sourceTextBytes,
    maxOutputBytes: ENGINE_CONNECTOR_LIMITS.outputBytes,
    maxEvents: ENGINE_CONNECTOR_LIMITS.events,
    maxModels: ENGINE_CONNECTOR_LIMITS.models,
    maxModelIdBytes: ENGINE_CONNECTOR_LIMITS.modelIdBytes,
    maxDeadlineMs: ENGINE_CONNECTOR_LIMITS.deadlineMs,
  };
}

export function defineEngineConnector(
  contribution: Omit<
    EngineConnectorContributionDescriptorV1,
    | "kind"
    | "descriptorVersion"
    | "protocol"
    | "contractVersion"
    | "operations"
    | "limits"
  > & {
    operations?: EngineConnectorOperationV1[];
    limits?: EngineConnectorLimitsV1;
  },
): EngineConnectorContributionDescriptorV1 {
  const { operations, limits, ...rest } = contribution;
  const descriptor: EngineConnectorContributionDescriptorV1 = {
    kind: "engineConnector",
    descriptorVersion: CONTRIBUTION_DESCRIPTOR_VERSION,
    protocol: ENGINE_CONNECTOR_PROTOCOL_V1,
    contractVersion: ENGINE_CONNECTOR_CONTRACT_VERSION,
    operations: operations ?? ["validateConfig", "test", "generate"],
    limits: limits ?? defaultEngineConnectorLimits(),
    ...rest,
  };
  const errors = validateEngineConnectorDescriptor(descriptor);
  if (errors.length > 0) {
    throw new Error(`invalid engine connector: ${errors.join("; ")}`);
  }
  return descriptor;
}

export function defineDeclarativeEngineConnector(
  contribution: Omit<
    Parameters<typeof defineEngineConnector>[0],
    "declarative"
  > & { declarative: DeclarativeEngineConnectorDefinitionV1 },
): EngineConnectorContributionDescriptorV1 {
  return defineEngineConnector(contribution);
}

export function validateEngineConnectorDescriptor(
  value: unknown,
  tier?: PluginTier,
): string[] {
  const errors: string[] = [];
  const descriptor = strictRecord(
    value,
    [
      "kind",
      "descriptorVersion",
      "id",
      "version",
      "displayName",
      "protocol",
      "contractVersion",
      "operations",
      "configSchemaVersion",
      "configSchema",
      "limits",
      "declarative",
    ],
    "connector descriptor",
    errors,
  );
  if (!descriptor) return errors;
  if (descriptor.kind !== "engineConnector") {
    errors.push("connector kind must be engineConnector");
  }
  if (descriptor.descriptorVersion !== CONTRIBUTION_DESCRIPTOR_VERSION) {
    errors.push("connector descriptorVersion must be 1");
  }
  validateId(
    typeof descriptor.id === "string" ? descriptor.id : undefined,
    "connector id",
    errors,
  );
  boundedString(descriptor.version, 1, 128, "connector version", errors);
  if (
    typeof descriptor.version === "string" &&
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      descriptor.version,
    )
  ) {
    errors.push("connector version must be semantic version syntax");
  }
  boundedString(
    descriptor.displayName,
    1,
    256,
    "connector displayName",
    errors,
  );
  if (descriptor.protocol !== ENGINE_CONNECTOR_PROTOCOL_V1) {
    errors.push(`connector protocol must be ${ENGINE_CONNECTOR_PROTOCOL_V1}`);
  }
  if (descriptor.contractVersion !== ENGINE_CONNECTOR_CONTRACT_VERSION) {
    errors.push("connector contractVersion must be 1");
  }
  if (
    !Number.isSafeInteger(descriptor.configSchemaVersion) ||
    (descriptor.configSchemaVersion as number) < 1
  ) {
    errors.push("connector configSchemaVersion must be a positive integer");
  }
  validateConnectorOperations(descriptor.operations, errors);
  validateConnectorConfigSchema(descriptor.configSchema, errors);
  validateConnectorLimits(descriptor.limits, errors);
  if (descriptor.declarative !== undefined) {
    validateDeclarativeConnectorDefinition(descriptor.declarative, errors);
  }
  if (tier === "declarative" && descriptor.declarative === undefined) {
    errors.push("declarative connector requires a typed definition");
  }
  if (tier !== undefined && tier !== "declarative" && descriptor.declarative) {
    errors.push(
      "executable connector tiers cannot include a declarative definition",
    );
  }
  return errors;
}

export function validateEngineConnectorRequest(
  value: unknown,
  limits: EngineConnectorLimitsV1 = defaultEngineConnectorLimits(),
): string[] {
  const errors: string[] = [];
  validateConnectorLimits(limits, errors);
  if (!isPlainRecord(value)) return ["connector request must be an object"];
  const operation = value.operation;
  const common = [
    "operation",
    "contractVersion",
    "requestId",
    "config",
    "deadlineMs",
  ];
  const operationKeys: Record<EngineConnectorOperationV1, string[]> = {
    validateConfig: [],
    test: ["model", "sourceLocale", "targetLocale"],
    "models.list": ["cursor", "limit"],
    generate: [
      "sourceLocale",
      "targetLocale",
      "sourceText",
      "messages",
      "model",
    ],
  };
  if (!isConnectorOperation(operation)) {
    errors.push("connector request operation is unsupported");
    return errors;
  }
  rejectUnknownKeys(
    value,
    [...common, ...operationKeys[operation]],
    "connector request",
    errors,
  );
  if (value.contractVersion !== ENGINE_CONNECTOR_CONTRACT_VERSION) {
    errors.push("connector request contractVersion must be 1");
  }
  validateRequestId(value.requestId, errors);
  validateConnectorConfig(value.config, limits.maxConfigBytes, errors);
  integerRange(value.deadlineMs, 1, limits.maxDeadlineMs, "deadlineMs", errors);
  if (operation === "test") {
    if (value.model !== undefined) {
      boundedString(value.model, 1, limits.maxModelIdBytes, "model", errors);
    }
    validateLocale(value.sourceLocale, "sourceLocale", errors);
    validateLocale(value.targetLocale, "targetLocale", errors);
  } else if (operation === "models.list") {
    if (value.cursor !== undefined) {
      boundedString(value.cursor, 1, 512, "cursor", errors);
    }
    integerRange(value.limit, 1, limits.maxModels, "limit", errors);
  } else if (operation === "generate") {
    validateLocale(value.sourceLocale, "sourceLocale", errors);
    validateLocale(value.targetLocale, "targetLocale", errors);
    boundedString(
      value.sourceText,
      0,
      limits.maxSourceTextBytes,
      "sourceText",
      errors,
    );
    boundedString(value.model, 1, limits.maxModelIdBytes, "model", errors);
    if (
      !Array.isArray(value.messages) ||
      value.messages.length > limits.maxMessages
    ) {
      errors.push("connector messages exceed maxMessages");
    } else {
      let totalBytes = 0;
      for (const [index, message] of value.messages.entries()) {
        const record = strictRecord(
          message,
          ["role", "content"],
          `message ${index}`,
          errors,
        );
        if (!record) continue;
        if (!["system", "user", "assistant"].includes(String(record.role))) {
          errors.push(`message ${index} has an unsupported role`);
        }
        boundedString(
          record.content,
          0,
          limits.maxMessageBytes,
          `message ${index} content`,
          errors,
        );
        if (typeof record.content === "string") {
          totalBytes += utf8Bytes(record.content);
        }
      }
      if (totalBytes > ENGINE_CONNECTOR_LIMITS.sourceTextBytes) {
        errors.push("connector messages exceed the aggregate byte limit");
      }
      if (
        value.messages.length === 0 &&
        typeof value.sourceText === "string" &&
        value.sourceText.length === 0
      ) {
        errors.push("connector generation requires sourceText or messages");
      }
    }
  }
  return errors;
}

export function validateEngineConnectorEvent(
  value: unknown,
  limits: EngineConnectorLimitsV1 = defaultEngineConnectorLimits(),
): string[] {
  const errors: string[] = [];
  if (!isPlainRecord(value)) return ["connector event must be an object"];
  const kind = value.kind;
  const allowed =
    kind === "delta"
      ? ["kind", "contractVersion", "requestId", "sequence", "text"]
      : kind === "usage"
        ? ["kind", "contractVersion", "requestId", "sequence", "usage"]
        : kind === "completed"
          ? ["kind", "contractVersion", "requestId", "sequence", "result"]
          : [];
  if (allowed.length === 0) {
    errors.push("connector event kind is unsupported");
    return errors;
  }
  rejectUnknownKeys(value, allowed, "connector event", errors);
  if (value.contractVersion !== ENGINE_CONNECTOR_CONTRACT_VERSION) {
    errors.push("connector event contractVersion must be 1");
  }
  validateRequestId(value.requestId, errors);
  integerRange(value.sequence, 0, limits.maxEvents - 1, "sequence", errors);
  if (kind === "delta") {
    boundedString(value.text, 1, limits.maxOutputBytes, "delta text", errors);
  } else if (kind === "usage") {
    validateConnectorUsage(value.usage, errors);
  } else {
    errors.push(...validateEngineConnectorResult(value.result, limits));
  }
  return errors;
}

export class EngineConnectorEventSequenceValidatorV1 {
  readonly requestId: string;
  private readonly limits: EngineConnectorLimitsV1;
  private nextSequence = 0;
  private outputBytes = 0;
  private completed = false;

  constructor(
    requestId: string,
    limits: EngineConnectorLimitsV1 = defaultEngineConnectorLimits(),
  ) {
    const errors: string[] = [];
    validateRequestId(requestId, errors);
    validateConnectorLimits(limits, errors);
    throwIfErrors(errors, "invalid connector event sequence");
    this.requestId = requestId;
    this.limits = { ...limits };
  }

  accept(event: EngineConnectorEventV1): string[] {
    const errors = validateEngineConnectorEvent(event, this.limits);
    if (this.completed)
      errors.push("connector emitted an event after completion");
    if (event.requestId !== this.requestId) {
      errors.push("connector event targets another request");
    }
    if (event.sequence !== this.nextSequence) {
      errors.push("connector event sequence is not contiguous");
    }
    const nextOutputBytes =
      this.outputBytes + (event.kind === "delta" ? utf8Bytes(event.text) : 0);
    if (nextOutputBytes > this.limits.maxOutputBytes) {
      errors.push("connector delta stream exceeds maxOutputBytes");
    }
    if (errors.length === 0) {
      this.outputBytes = nextOutputBytes;
      this.completed = event.kind === "completed";
      this.nextSequence += 1;
    }
    return errors;
  }

  isCompleted(): boolean {
    return this.completed;
  }
}

export function validateEngineConnectorResult(
  value: unknown,
  limits: EngineConnectorLimitsV1 = defaultEngineConnectorLimits(),
): string[] {
  const errors: string[] = [];
  const result = strictRecord(
    value,
    ["outputText", "model", "finishReason", "usage"],
    "connector result",
    errors,
  );
  if (!result) return errors;
  boundedString(
    result.outputText,
    0,
    limits.maxOutputBytes,
    "outputText",
    errors,
  );
  boundedString(result.model, 1, limits.maxModelIdBytes, "model", errors);
  if (
    !["stop", "length", "contentFilter"].includes(String(result.finishReason))
  ) {
    errors.push("connector finishReason is unsupported");
  }
  if (result.usage !== undefined) validateConnectorUsage(result.usage, errors);
  return errors;
}

export function validateEngineConnectorFailure(value: unknown): string[] {
  const errors: string[] = [];
  const failure = strictRecord(
    value,
    [
      "contractVersion",
      "requestId",
      "code",
      "message",
      "retryable",
      "retryAfterMs",
    ],
    "connector failure",
    errors,
  );
  if (!failure) return errors;
  if (failure.contractVersion !== ENGINE_CONNECTOR_CONTRACT_VERSION) {
    errors.push("connector failure contractVersion must be 1");
  }
  validateRequestId(failure.requestId, errors);
  const codes: EngineConnectorFailureCodeV1[] = [
    "invalidConfig",
    "authentication",
    "rateLimit",
    "timeout",
    "unavailable",
    "protocol",
    "responseSize",
    "cancelled",
    "hostCrash",
  ];
  if (!codes.includes(failure.code as EngineConnectorFailureCodeV1)) {
    errors.push("connector failure code is unsupported");
  }
  boundedString(
    failure.message,
    1,
    ENGINE_CONNECTOR_LIMITS.errorMessageBytes,
    "failure message",
    errors,
  );
  if (typeof failure.retryable !== "boolean") {
    errors.push("connector failure retryable must be boolean");
  }
  if (failure.retryAfterMs !== undefined) {
    integerRange(
      failure.retryAfterMs,
      0,
      ENGINE_CONNECTOR_LIMITS.deadlineMs,
      "retryAfterMs",
      errors,
    );
    if (
      failure.retryable !== true ||
      !["rateLimit", "unavailable"].includes(String(failure.code))
    ) {
      errors.push(
        "retryAfterMs requires a retryable rateLimit or unavailable failure",
      );
    }
  }
  return errors;
}

export function validateEngineConnectorConfigValidationResult(
  value: unknown,
): string[] {
  const errors: string[] = [];
  const result = strictRecord(
    value,
    ["valid", "issues"],
    "connector config validation result",
    errors,
  );
  if (!result) return errors;
  if (typeof result.valid !== "boolean") errors.push("valid must be boolean");
  if (!Array.isArray(result.issues) || result.issues.length > 64) {
    errors.push("connector config issues must contain at most 64 items");
    return errors;
  }
  for (const [index, rawIssue] of result.issues.entries()) {
    const issue = strictRecord(
      rawIssue,
      ["field", "code", "message"],
      `connector config issue ${index}`,
      errors,
    );
    if (!issue) continue;
    validateConfigKey(
      issue.field,
      `connector config issue ${index} field`,
      errors,
    );
    validateConfigKey(
      issue.code,
      `connector config issue ${index} code`,
      errors,
    );
    boundedString(
      issue.message,
      1,
      512,
      `connector config issue ${index} message`,
      errors,
    );
  }
  if (result.valid === true && result.issues.length > 0) {
    errors.push("valid connector config cannot contain issues");
  }
  return errors;
}

export function validateEngineConnectorTestResult(value: unknown): string[] {
  const errors: string[] = [];
  const result = strictRecord(
    value,
    ["ok", "latencyMs", "model"],
    "connector test result",
    errors,
  );
  if (!result) return errors;
  if (typeof result.ok !== "boolean")
    errors.push("test result ok must be boolean");
  integerRange(
    result.latencyMs,
    0,
    ENGINE_CONNECTOR_LIMITS.deadlineMs,
    "latencyMs",
    errors,
  );
  if (result.model !== undefined) {
    boundedString(
      result.model,
      1,
      ENGINE_CONNECTOR_LIMITS.modelIdBytes,
      "test result model",
      errors,
    );
  }
  return errors;
}

export function validateEngineConnectorModelCatalog(
  value: unknown,
  limits: EngineConnectorLimitsV1 = defaultEngineConnectorLimits(),
): string[] {
  const errors: string[] = [];
  const catalog = strictRecord(
    value,
    ["models", "nextCursor"],
    "connector model catalog",
    errors,
  );
  if (!catalog) return errors;
  if (
    !Array.isArray(catalog.models) ||
    catalog.models.length > limits.maxModels
  ) {
    errors.push("connector model catalog exceeds maxModels");
    return errors;
  }
  const ids = new Set<string>();
  for (const [index, rawModel] of catalog.models.entries()) {
    const model = strictRecord(
      rawModel,
      ["id", "displayName", "contextTokens"],
      `connector model ${index}`,
      errors,
    );
    if (!model) continue;
    boundedString(
      model.id,
      1,
      limits.maxModelIdBytes,
      `connector model ${index} id`,
      errors,
    );
    boundedString(
      model.displayName,
      1,
      256,
      `connector model ${index} displayName`,
      errors,
    );
    if (typeof model.id === "string") {
      if (ids.has(model.id)) errors.push("connector model ids must be unique");
      ids.add(model.id);
    }
    if (model.contextTokens !== undefined) {
      integerRange(
        model.contextTokens,
        1,
        Number.MAX_SAFE_INTEGER,
        `connector model ${index} contextTokens`,
        errors,
      );
    }
  }
  if (catalog.nextCursor !== undefined) {
    boundedString(catalog.nextCursor, 1, 512, "nextCursor", errors);
  }
  return errors;
}

export function validateEngineConnectorConfig(
  schema: EngineConnectorConfigSchemaV1,
  config: unknown,
): string[] {
  const errors: string[] = [];
  validateConnectorConfigSchema(schema, errors);
  validateConnectorConfig(config, ENGINE_CONNECTOR_LIMITS.configBytes, errors);
  if (!isPlainRecord(config)) return errors;
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(config)) {
    if (!fields.has(key)) errors.push(`unknown connector config field ${key}`);
  }
  for (const field of schema.fields) {
    const value = config[field.key];
    if (value === undefined) {
      if (field.required && field.defaultValue === undefined) {
        errors.push(`required connector config field ${field.key} is missing`);
      }
      continue;
    }
    if (field.fieldType === "text" && typeof value !== "string") {
      errors.push(`connector config field ${field.key} must be text`);
    } else if (field.fieldType === "boolean" && typeof value !== "boolean") {
      errors.push(`connector config field ${field.key} must be boolean`);
    } else if (
      field.fieldType === "integer" &&
      (!Number.isSafeInteger(value) ||
        (field.min !== undefined && (value as number) < field.min) ||
        (field.max !== undefined && (value as number) > field.max))
    ) {
      errors.push(
        `connector config field ${field.key} is outside integer bounds`,
      );
    } else if (
      field.fieldType === "select" &&
      (typeof value !== "string" ||
        !(field.options ?? []).some((option) => option.value === value))
    ) {
      errors.push(
        `connector config field ${field.key} is not an allowed option`,
      );
    }
  }
  return errors;
}

function validateConnectorOperations(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    errors.push("connector operations must contain between 1 and 4 items");
    return;
  }
  const seen = new Set<string>();
  for (const operation of value) {
    if (!isConnectorOperation(operation)) {
      errors.push(`unsupported connector operation ${String(operation)}`);
    } else if (seen.has(operation)) {
      errors.push("connector operations must not contain duplicates");
    } else {
      seen.add(operation);
    }
  }
  for (const required of ["validateConfig", "test", "generate"] as const) {
    if (!seen.has(required)) {
      errors.push(`connector operations must include ${required}`);
    }
  }
}

function validateConnectorConfigSchema(value: unknown, errors: string[]): void {
  const schema = strictRecord(
    value,
    ["schemaVersion", "fields"],
    "connector configSchema",
    errors,
  );
  if (!schema) return;
  if (schema.schemaVersion !== ENGINE_CONNECTOR_CONFIG_SCHEMA_VERSION) {
    errors.push("connector config schemaVersion must be 1");
  }
  if (
    !Array.isArray(schema.fields) ||
    schema.fields.length > ENGINE_CONNECTOR_LIMITS.configFields
  ) {
    errors.push("connector config schema has too many fields");
    return;
  }
  const keys = new Set<string>();
  for (const [index, rawField] of schema.fields.entries()) {
    const field = strictRecord(
      rawField,
      [
        "key",
        "label",
        "fieldType",
        "required",
        "description",
        "defaultValue",
        "min",
        "max",
        "options",
      ],
      `connector config field ${index}`,
      errors,
    );
    if (!field) continue;
    validateConfigKey(field.key, `connector config field ${index} key`, errors);
    if (typeof field.key === "string") {
      if (keys.has(field.key))
        errors.push("connector config field keys must be unique");
      keys.add(field.key);
    }
    boundedString(
      field.label,
      1,
      128,
      `connector config field ${index} label`,
      errors,
    );
    if (field.description !== undefined) {
      boundedString(
        field.description,
        1,
        512,
        `connector config field ${index} description`,
        errors,
      );
    }
    if (typeof field.required !== "boolean") {
      errors.push(`connector config field ${index} required must be boolean`);
    }
    if (
      !["text", "boolean", "integer", "select"].includes(
        String(field.fieldType),
      )
    ) {
      errors.push(`connector config field ${index} fieldType is unsupported`);
      continue;
    }
    const defaultValue = field.defaultValue;
    if (defaultValue !== undefined && !isConnectorConfigValue(defaultValue)) {
      errors.push(`connector config field ${index} defaultValue is invalid`);
    }
    if (
      typeof defaultValue === "string" &&
      utf8Bytes(defaultValue) > ENGINE_CONNECTOR_LIMITS.configValueBytes
    ) {
      errors.push(`connector config field ${index} defaultValue is oversized`);
    }
    if (field.fieldType === "integer") {
      if (field.min !== undefined && !Number.isSafeInteger(field.min)) {
        errors.push(`connector config field ${index} min must be an integer`);
      }
      if (field.max !== undefined && !Number.isSafeInteger(field.max)) {
        errors.push(`connector config field ${index} max must be an integer`);
      }
      if (
        typeof field.min === "number" &&
        typeof field.max === "number" &&
        field.min > field.max
      ) {
        errors.push(`connector config field ${index} min must not exceed max`);
      }
      if (defaultValue !== undefined && !Number.isSafeInteger(defaultValue)) {
        errors.push(
          `connector config field ${index} defaultValue must be an integer`,
        );
      } else if (
        typeof defaultValue === "number" &&
        ((typeof field.min === "number" && defaultValue < field.min) ||
          (typeof field.max === "number" && defaultValue > field.max))
      ) {
        errors.push(
          `connector config field ${index} defaultValue is outside bounds`,
        );
      }
      if (field.options !== undefined && !isEmptyArray(field.options)) {
        errors.push(`connector config field ${index} cannot have options`);
      }
    } else {
      if (field.min !== undefined || field.max !== undefined) {
        errors.push(
          `connector config field ${index} cannot have numeric bounds`,
        );
      }
      if (
        (field.fieldType === "text" &&
          defaultValue !== undefined &&
          typeof defaultValue !== "string") ||
        (field.fieldType === "boolean" &&
          defaultValue !== undefined &&
          typeof defaultValue !== "boolean")
      ) {
        errors.push(
          `connector config field ${index} defaultValue has the wrong type`,
        );
      }
      if (field.fieldType === "select") {
        validateConfigOptions(field.options, defaultValue, index, errors);
      } else if (field.options !== undefined && !isEmptyArray(field.options)) {
        errors.push(`connector config field ${index} cannot have options`);
      }
    }
  }
}

function validateConfigOptions(
  rawOptions: unknown,
  defaultValue: unknown,
  fieldIndex: number,
  errors: string[],
): void {
  if (
    !Array.isArray(rawOptions) ||
    rawOptions.length < 1 ||
    rawOptions.length > 128
  ) {
    errors.push(
      `select connector config field ${fieldIndex} needs 1 to 128 options`,
    );
    return;
  }
  const values = new Set<string>();
  for (const [index, rawOption] of rawOptions.entries()) {
    const option = strictRecord(
      rawOption,
      ["value", "label"],
      `connector config option ${index}`,
      errors,
    );
    if (!option) continue;
    boundedString(
      option.value,
      1,
      ENGINE_CONNECTOR_LIMITS.configValueBytes,
      `connector config option ${index} value`,
      errors,
    );
    boundedString(
      option.label,
      1,
      128,
      `connector config option ${index} label`,
      errors,
    );
    if (typeof option.value === "string") {
      if (values.has(option.value))
        errors.push("connector config option values must be unique");
      values.add(option.value);
    }
  }
  if (
    defaultValue !== undefined &&
    (typeof defaultValue !== "string" || !values.has(defaultValue))
  ) {
    errors.push(
      `select connector config field ${fieldIndex} defaultValue must name an option`,
    );
  }
}

function validateConnectorLimits(value: unknown, errors: string[]): void {
  const limits = strictRecord(
    value,
    [
      "maxConfigBytes",
      "maxMessages",
      "maxMessageBytes",
      "maxSourceTextBytes",
      "maxOutputBytes",
      "maxEvents",
      "maxModels",
      "maxModelIdBytes",
      "maxDeadlineMs",
    ],
    "connector limits",
    errors,
  );
  if (!limits) return;
  const maxima: Record<string, number> = {
    maxConfigBytes: ENGINE_CONNECTOR_LIMITS.configBytes,
    maxMessages: ENGINE_CONNECTOR_LIMITS.messages,
    maxMessageBytes: ENGINE_CONNECTOR_LIMITS.messageBytes,
    maxSourceTextBytes: ENGINE_CONNECTOR_LIMITS.sourceTextBytes,
    maxOutputBytes: ENGINE_CONNECTOR_LIMITS.outputBytes,
    maxEvents: ENGINE_CONNECTOR_LIMITS.events,
    maxModels: ENGINE_CONNECTOR_LIMITS.models,
    maxModelIdBytes: ENGINE_CONNECTOR_LIMITS.modelIdBytes,
    maxDeadlineMs: ENGINE_CONNECTOR_LIMITS.deadlineMs,
  };
  for (const [key, maximum] of Object.entries(maxima)) {
    integerRange(limits[key], 1, maximum, key, errors);
  }
}

function validateDeclarativeConnectorDefinition(
  value: unknown,
  errors: string[],
): void {
  const definition = strictRecord(
    value,
    [
      "definitionVersion",
      "endpoint",
      "fixedHeaders",
      "authentication",
      "request",
      "response",
      "failures",
    ],
    "declarative connector definition",
    errors,
  );
  if (!definition) return;
  if (definition.definitionVersion !== ENGINE_CONNECTOR_CONTRACT_VERSION) {
    errors.push("declarative connector definitionVersion must be 1");
  }
  validateDeclarativeEndpoint(definition.endpoint, errors);
  validateDeclarativeHeaders(definition.fixedHeaders ?? [], errors);
  const authentication = strictRecord(
    definition.authentication,
    ["kind", "name"],
    "declarative connector authentication",
    errors,
  );
  if (authentication) {
    if (!["none", "bearer", "header"].includes(String(authentication.kind))) {
      errors.push("declarative connector authentication kind is unsupported");
    }
    if (authentication.kind === "header") {
      validateHeaderName(authentication.name, true, errors);
    } else if (authentication.name !== undefined) {
      errors.push("only header authentication can name a header");
    }
  }
  validateDeclarativeRequestMapping(definition.request, errors);
  validateDeclarativeResponseMapping(definition.response, errors);
  validateDeclarativeFailureMappings(definition.failures ?? [], errors);
}

function validateDeclarativeEndpoint(value: unknown, errors: string[]): void {
  const endpoint = strictRecord(
    value,
    ["destinationOrigin", "urlTemplate", "method"],
    "declarative connector endpoint",
    errors,
  );
  if (!endpoint) return;
  boundedString(
    endpoint.destinationOrigin,
    1,
    ENGINE_CONNECTOR_LIMITS.endpointBytes,
    "destinationOrigin",
    errors,
  );
  boundedString(
    endpoint.urlTemplate,
    1,
    ENGINE_CONNECTOR_LIMITS.endpointBytes,
    "urlTemplate",
    errors,
  );
  if (endpoint.method !== "POST")
    errors.push("connector HTTP method must be POST");
  if (
    typeof endpoint.destinationOrigin === "string" &&
    typeof endpoint.urlTemplate === "string"
  ) {
    const origin = endpoint.destinationOrigin;
    let parsed: URL | undefined;
    try {
      parsed = new URL(origin);
    } catch {
      errors.push("connector destinationOrigin is not a valid URL origin");
    }
    if (
      parsed &&
      (parsed.origin !== origin ||
        (parsed.protocol !== "https:" &&
          !(
            parsed.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname)
          )))
    ) {
      errors.push(
        "connector destinationOrigin must be HTTPS except loopback HTTP",
      );
    }
    if (
      endpoint.urlTemplate !== origin &&
      !endpoint.urlTemplate.startsWith(`${origin}/`)
    ) {
      errors.push("connector urlTemplate must remain under destinationOrigin");
    }
    const placeholders = endpoint.urlTemplate.match(/\{[^{}]*\}/gu) ?? [];
    if (placeholders.some((placeholder) => placeholder !== "{model}")) {
      errors.push("connector urlTemplate has an unsupported placeholder");
    }
    if (/[{}]/u.test(endpoint.urlTemplate.replace(/\{model\}/gu, ""))) {
      errors.push("connector urlTemplate has malformed placeholders");
    }
  }
}

function validateDeclarativeHeaders(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length > ENGINE_CONNECTOR_LIMITS.headers) {
    errors.push("declarative connector has too many fixed headers");
    return;
  }
  const names = new Set<string>();
  for (const [index, rawHeader] of value.entries()) {
    const header = strictRecord(
      rawHeader,
      ["name", "value"],
      `declarative connector header ${index}`,
      errors,
    );
    if (!header) continue;
    validateHeaderName(header.name, false, errors);
    boundedString(
      header.value,
      0,
      ENGINE_CONNECTOR_LIMITS.headerValueBytes,
      `declarative connector header ${index} value`,
      errors,
    );
    if (typeof header.value === "string" && /[\r\n]/u.test(header.value)) {
      errors.push(
        "declarative connector header values cannot contain newlines",
      );
    }
    if (typeof header.name === "string") {
      const normalized = header.name.toLowerCase();
      if (names.has(normalized))
        errors.push("fixed header names must be unique");
      names.add(normalized);
    }
  }
}

function validateDeclarativeRequestMapping(
  value: unknown,
  errors: string[],
): void {
  const mapping = strictRecord(
    value,
    [
      "fixedBody",
      "modelPath",
      "messagesPath",
      "sourceTextPath",
      "sourceLocalePath",
      "targetLocalePath",
      "streamPath",
    ],
    "declarative connector request mapping",
    errors,
  );
  if (!mapping) return;
  if (mapping.fixedBody !== undefined) {
    if (
      !validateSandboxJsonValue(
        mapping.fixedBody,
        ENGINE_CONNECTOR_LIMITS.configBytes,
      )
    ) {
      errors.push("declarative connector fixedBody is not bounded JSON");
    }
  }
  validateJsonPath(mapping.modelPath, "modelPath", errors);
  validateJsonPath(mapping.messagesPath, "messagesPath", errors);
  for (const key of [
    "sourceTextPath",
    "sourceLocalePath",
    "targetLocalePath",
    "streamPath",
  ] as const) {
    if (mapping[key] !== undefined) validateJsonPath(mapping[key], key, errors);
  }
}

function validateDeclarativeResponseMapping(
  value: unknown,
  errors: string[],
): void {
  if (!isPlainRecord(value)) {
    errors.push("declarative connector response mapping must be an object");
    return;
  }
  if (value.kind === "json") {
    rejectUnknownKeys(
      value,
      ["kind", "textPath", "finishReasonPath", "usage"],
      "JSON response mapping",
      errors,
    );
    validateJsonPath(value.textPath, "textPath", errors);
  } else if (value.kind === "serverSentEvents") {
    rejectUnknownKeys(
      value,
      [
        "kind",
        "deltaPath",
        "finishReasonPath",
        "usage",
        "doneMarker",
        "maxLineBytes",
      ],
      "SSE response mapping",
      errors,
    );
    validateJsonPath(value.deltaPath, "deltaPath", errors);
    boundedString(value.doneMarker, 1, 128, "doneMarker", errors);
    integerRange(value.maxLineBytes, 1, 256 * 1024, "maxLineBytes", errors);
  } else {
    errors.push("declarative connector response kind is unsupported");
    return;
  }
  if (value.finishReasonPath !== undefined) {
    validateJsonPath(value.finishReasonPath, "finishReasonPath", errors);
  }
  if (value.usage !== undefined) validateUsageMapping(value.usage, errors);
}

function validateUsageMapping(value: unknown, errors: string[]): void {
  const mapping = strictRecord(
    value,
    ["inputTokensPath", "outputTokensPath", "totalTokensPath"],
    "connector usage mapping",
    errors,
  );
  if (!mapping) return;
  const keys = [
    "inputTokensPath",
    "outputTokensPath",
    "totalTokensPath",
  ] as const;
  if (keys.every((key) => mapping[key] === undefined)) {
    errors.push("connector usage mapping must define at least one path");
  }
  for (const key of keys) {
    if (mapping[key] !== undefined) validateJsonPath(mapping[key], key, errors);
  }
}

function validateDeclarativeFailureMappings(
  value: unknown,
  errors: string[],
): void {
  if (!Array.isArray(value) || value.length > 64) {
    errors.push("declarative connector has too many failure mappings");
    return;
  }
  const statuses = new Set<number>();
  const codes: EngineConnectorFailureCodeV1[] = [
    "invalidConfig",
    "authentication",
    "rateLimit",
    "timeout",
    "unavailable",
    "protocol",
    "responseSize",
    "cancelled",
    "hostCrash",
  ];
  for (const [index, rawMapping] of value.entries()) {
    const mapping = strictRecord(
      rawMapping,
      ["status", "code", "retryable"],
      `connector failure mapping ${index}`,
      errors,
    );
    if (!mapping) continue;
    integerRange(mapping.status, 400, 599, "failure status", errors);
    if (typeof mapping.status === "number") {
      if (statuses.has(mapping.status))
        errors.push("failure statuses must be unique");
      statuses.add(mapping.status);
    }
    if (!codes.includes(mapping.code as EngineConnectorFailureCodeV1)) {
      errors.push("connector failure mapping code is unsupported");
    }
    if (typeof mapping.retryable !== "boolean") {
      errors.push("connector failure mapping retryable must be boolean");
    }
  }
}

function validateConnectorConfig(
  value: unknown,
  maxBytes: number,
  errors: string[],
): void {
  if (!isPlainRecord(value)) {
    errors.push("connector config must be an object");
    return;
  }
  if (Object.keys(value).length > ENGINE_CONNECTOR_LIMITS.configFields) {
    errors.push("connector config has too many fields");
  }
  for (const [key, entry] of Object.entries(value)) {
    validateConfigKey(key, "connector config key", errors);
    if (!isConnectorConfigValue(entry)) {
      errors.push(
        `connector config field ${key} must be string, boolean, or integer`,
      );
    } else if (
      typeof entry === "string" &&
      utf8Bytes(entry) > ENGINE_CONNECTOR_LIMITS.configValueBytes
    ) {
      errors.push(`connector config field ${key} is oversized`);
    }
  }
  if (jsonBytes(value) > maxBytes)
    errors.push("connector config exceeds its byte limit");
}

function validateConnectorUsage(value: unknown, errors: string[]): void {
  const usage = strictRecord(
    value,
    ["inputTokens", "outputTokens", "totalTokens"],
    "connector usage",
    errors,
  );
  if (!usage) return;
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    integerRange(usage[key], 0, Number.MAX_SAFE_INTEGER, key, errors);
  }
  if (
    typeof usage.inputTokens === "number" &&
    typeof usage.outputTokens === "number" &&
    usage.totalTokens !== usage.inputTokens + usage.outputTokens
  ) {
    errors.push("totalTokens must equal inputTokens plus outputTokens");
  }
}

function validateJsonPath(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > ENGINE_CONNECTOR_LIMITS.jsonPathDepth
  ) {
    errors.push(`${label} must contain a bounded JSON path`);
    return;
  }
  for (const segment of value) {
    if (
      typeof segment !== "string" ||
      !/^[A-Za-z0-9_-]+$/u.test(segment) ||
      utf8Bytes(segment) > ENGINE_CONNECTOR_LIMITS.jsonPathSegmentBytes
    ) {
      errors.push(`${label} contains a malformed JSON path segment`);
    }
  }
}

function validateHeaderName(
  value: unknown,
  authenticationHeader: boolean,
  errors: string[],
): void {
  boundedString(
    value,
    1,
    ENGINE_CONNECTOR_LIMITS.headerNameBytes,
    "connector header name",
    errors,
  );
  if (
    typeof value !== "string" ||
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(value)
  ) {
    errors.push("connector header name is malformed");
    return;
  }
  const normalized = value.toLowerCase();
  if (
    ["cookie", "host", "content-length", "transfer-encoding"].includes(
      normalized,
    ) ||
    (!authenticationHeader && normalized === "authorization")
  ) {
    errors.push("connector fixed header is host-owned or sensitive");
  }
}

function validateConfigKey(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._-]+$/u.test(value) ||
    utf8Bytes(value) > ENGINE_CONNECTOR_LIMITS.configKeyBytes
  ) {
    errors.push(`${label} is malformed or oversized`);
  }
}

function validateRequestId(value: unknown, errors: string[]): void {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._-]+$/u.test(value) ||
    utf8Bytes(value) > ENGINE_CONNECTOR_LIMITS.requestIdBytes
  ) {
    errors.push("connector requestId is malformed or oversized");
  }
}

function validateLocale(value: unknown, label: string, errors: string[]): void {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9-]+$/u.test(value) ||
    utf8Bytes(value) > ENGINE_CONNECTOR_LIMITS.localeBytes
  ) {
    errors.push(`${label} is malformed or oversized`);
  }
}

function isConnectorConfigValue(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}

function isConnectorOperation(
  value: unknown,
): value is EngineConnectorOperationV1 {
  return ENGINE_CONNECTOR_OPERATIONS_V1.includes(
    value as EngineConnectorOperationV1,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
  errors: string[],
): Record<string, unknown> | null {
  if (!isPlainRecord(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  rejectUnknownKeys(value, allowedKeys, label, errors);
  return value;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
  errors: string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      errors.push(`${label} contains unknown field ${key}`);
  }
}

function boundedString(
  value: unknown,
  minBytes: number,
  maxBytes: number,
  label: string,
  errors: string[],
): void {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    utf8Bytes(value) < minBytes ||
    utf8Bytes(value) > maxBytes
  ) {
    errors.push(
      `${label} must contain between ${minBytes} and ${maxBytes} UTF-8 bytes`,
    );
  }
}

function integerRange(
  value: unknown,
  min: number,
  max: number,
  label: string,
  errors: string[],
): void {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  ) {
    errors.push(`${label} must be an integer between ${min} and ${max}`);
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function jsonBytes(value: unknown): number {
  try {
    return utf8Bytes(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

export function defineDeclarativeManifest(
  manifest: Omit<PluginManifestV2, "manifestVersion" | "runtime">,
): PluginManifestV2 {
  return {
    manifestVersion: 2,
    runtime: {
      tier: "declarative",
      runtimeVersion: RUNTIME_DESCRIPTOR_VERSION,
      entry: { kind: "manifest" },
    },
    ...manifest,
  };
}

export function defineSandboxManifest(
  manifest: Omit<PluginManifestV2, "manifestVersion" | "runtime"> & {
    entry: { path: string; exportName?: string };
  },
): PluginManifestV2 {
  const { entry, ...rest } = manifest;
  return {
    manifestVersion: 2,
    runtime: {
      tier: "sandbox",
      runtimeVersion: SANDBOX_PROTOCOL_VERSION,
      entry: {
        kind: "javascript",
        path: entry.path,
        ...(entry.exportName === undefined
          ? {}
          : { exportName: entry.exportName }),
      },
    },
    ...rest,
  };
}

export function validateSandboxJsonValue(
  value: unknown,
  maxBytes = SANDBOX_LIMITS.invocationJsonBytes,
): value is JsonValue {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return false;
  const seen = new Set<object>();
  const visit = (candidate: unknown, depth: number): boolean => {
    if (depth > SANDBOX_LIMITS.jsonDepth) return false;
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return true;
    }
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate !== "object" || seen.has(candidate)) return false;
    const prototype = Object.getPrototypeOf(candidate);
    if (!Array.isArray(candidate) && prototype !== Object.prototype) {
      return false;
    }
    seen.add(candidate);
    const valid = Array.isArray(candidate)
      ? candidate.every((item) => visit(item, depth + 1))
      : Object.entries(candidate).every(
          ([key, item]) =>
            key.length <= 256 &&
            !/[\u0000-\u001f\u007f]/u.test(key) &&
            visit(item, depth + 1),
        );
    seen.delete(candidate);
    return valid;
  };
  if (!visit(value, 0)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes;
  } catch {
    return false;
  }
}

export function parsePluginPanelMessageV1(
  value: unknown,
): PluginPanelMessageV1 | null {
  if (!validateSandboxJsonValue(value, SANDBOX_LIMITS.hostCallJsonBytes)) {
    return null;
  }
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const message = value as Record<string, JsonValue>;
  if (message.version !== SANDBOX_BRIDGE_VERSION) return null;
  if (message.type === "ready") {
    return Object.keys(message).length === 3 && isBridgeText(message.nonce, 128)
      ? { version: 1, type: "ready", nonce: message.nonce }
      : null;
  }
  if (message.type === "cancel") {
    return Object.keys(message).length === 3 && isBridgeId(message.id)
      ? { version: 1, type: "cancel", id: message.id }
      : null;
  }
  if (message.type === "request") {
    return Object.keys(message).length === 5 &&
      isBridgeId(message.id) &&
      isBridgeText(message.method, 96) &&
      validateSandboxJsonValue(message.params, SANDBOX_LIMITS.hostCallJsonBytes)
      ? {
          version: 1,
          type: "request",
          id: message.id,
          method: message.method,
          params: message.params,
        }
      : null;
  }
  return null;
}

function isBridgeId(value: JsonValue | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 96 &&
    /^[A-Za-z0-9._:-]+$/u.test(value)
  );
}

function isBridgeText(
  value: JsonValue | undefined,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export interface PluginCompatibility {
  compatible: boolean;
  hostApiSupported: boolean;
  runtimeSupported: boolean;
  contributionsSupported: boolean;
  unsupportedCapabilities: string[];
}

export interface PluginPackageFileDigest {
  path: string;
  size: number;
  sha256: string;
}

export function normalizeManifest(
  manifest: PluginManifest | PluginManifestV2,
): NormalizedPluginManifest {
  if (manifest.manifestVersion === 1) {
    return {
      normalizedVersion: NORMALIZED_MANIFEST_VERSION,
      sourceManifestVersion: 1,
      id: manifest.id,
      displayName: manifest.displayName,
      version: manifest.version,
      hostApi: { min: manifest.apiVersionMin, max: manifest.apiVersion },
      runtime: {
        tier: "process",
        runtimeVersion: RUNTIME_DESCRIPTOR_VERSION,
        protocolVersion: PROCESS_PROTOCOL_VERSION,
        entry: manifest.entry,
      },
      contributions: manifest.contributions.filters.map((filter) => ({
        kind: "filter",
        descriptorVersion: CONTRIBUTION_DESCRIPTOR_VERSION,
        ...filter,
      })),
      requestedPermissions: [...(manifest.permissions ?? [])],
      requestedCapabilities: normalizeCapabilityRequests(
        manifest.permissions ?? [],
        manifest.capabilities ?? [],
      ),
      originalManifestJson: manifest as unknown as Record<string, unknown>,
    };
  }
  return {
    normalizedVersion: NORMALIZED_MANIFEST_VERSION,
    sourceManifestVersion: 2,
    id: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    hostApi: { ...manifest.hostApi },
    runtime: manifest.runtime,
    contributions: [...manifest.contributions],
    requestedPermissions: [...(manifest.permissions ?? [])],
    requestedCapabilities: normalizeCapabilityRequests(
      manifest.permissions ?? [],
      manifest.capabilities ?? [],
    ),
    originalManifestJson: manifest as unknown as Record<string, unknown>,
  };
}

export function validateNormalizedManifest(
  manifest: NormalizedPluginManifest,
): string[] {
  const errors: string[] = [];
  if (manifest.normalizedVersion !== NORMALIZED_MANIFEST_VERSION) {
    errors.push("normalizedVersion must be 1");
  }
  validateId(manifest.id, "id", errors);
  if (manifest.id?.startsWith("builtin.")) {
    errors.push("id must not use builtin. prefix");
  }
  if (!manifest.displayName?.trim()) errors.push("displayName is required");
  if (!manifest.version?.trim()) errors.push("version is required");
  if (
    !Number.isInteger(manifest.hostApi.min) ||
    !Number.isInteger(manifest.hostApi.max)
  ) {
    errors.push("hostApi range must contain integers");
  } else if (manifest.hostApi.min > manifest.hostApi.max) {
    errors.push("hostApi.min must be <= hostApi.max");
  } else if (
    HOST_API_VERSION < manifest.hostApi.min ||
    HOST_API_VERSION > manifest.hostApi.max
  ) {
    errors.push("host API is outside plugin range");
  }
  const runtime = manifest.runtime;
  if (runtime.runtimeVersion !== RUNTIME_DESCRIPTOR_VERSION) {
    errors.push("runtimeVersion must be 1");
  }
  if (
    runtime.tier === "process" &&
    runtime.protocolVersion !== PROCESS_PROTOCOL_VERSION
  ) {
    errors.push("protocolVersion must be 1");
  }
  if (
    runtime.tier !== "declarative" &&
    !isRelativePackagePath(runtime.entry.path)
  ) {
    errors.push("runtime entry must be a relative path");
  }
  if (runtime.tier === "sandbox" && !/\.(?:m?js)$/u.test(runtime.entry.path)) {
    errors.push("sandbox runtime entry must end in .js or .mjs");
  }
  if (manifest.contributions.length === 0) {
    errors.push("at least one contribution is required");
  }
  const seen = new Set<string>();
  for (const contribution of manifest.contributions) {
    if (contribution.descriptorVersion !== CONTRIBUTION_DESCRIPTOR_VERSION) {
      errors.push(`unsupported descriptorVersion for ${contribution.kind}`);
    }
    validateId(contribution.id, `${contribution.kind} id`, errors);
    if (contribution.id.startsWith("builtin.")) {
      errors.push(`${contribution.kind} id must not use builtin. prefix`);
    }
    const key = `${contribution.kind}:${contribution.id}`;
    if (seen.has(key)) errors.push(`duplicate contribution id ${key}`);
    seen.add(key);
    if (!contribution.version.trim() || !contribution.displayName.trim()) {
      errors.push(
        `${contribution.kind} ${contribution.id} needs version and displayName`,
      );
    }
    if (!isContributionAllowed(runtime.tier, contribution.kind)) {
      errors.push(
        `${contribution.kind} is not valid for ${runtime.tier} runtime`,
      );
    }
    if (
      contribution.kind === "filter" &&
      contribution.extensions.length === 0
    ) {
      errors.push(`filter ${contribution.id} needs at least one extension`);
    }
    if (runtime.tier === "declarative") {
      validateDeclarativeContribution(contribution, errors);
    }
    if (
      contribution.kind === "engineConnector" &&
      contribution.contractVersion !== undefined
    ) {
      errors.push(
        ...validateEngineConnectorDescriptor(contribution, runtime.tier),
      );
    }
    if (
      contribution.kind === "qaRule" &&
      contribution.operationProtocolVersion !== undefined
    ) {
      errors.push(...validateQaRuleDescriptor(contribution));
    }
    if (
      contribution.kind === "pipelineStep" &&
      contribution.operationProtocolVersion !== undefined
    ) {
      errors.push(...validatePipelineStepDescriptor(contribution));
    }
    if (contribution.kind === "uiPanel") {
      if (
        contribution.bridgeVersion !== SANDBOX_BRIDGE_VERSION ||
        !isRelativePackagePath(contribution.surface) ||
        !/\.html$/u.test(contribution.surface)
      ) {
        errors.push(
          `UI panel ${contribution.id} needs bridgeVersion 1 and a relative .html surface`,
        );
      }
    }
  }
  for (const permission of manifest.requestedPermissions ?? []) {
    if (!isSupportedPermission(permission)) {
      errors.push(`unsupported permission ${permission}`);
    }
  }
  validateCapabilityRequests(manifest.requestedCapabilities ?? [], errors);
  return errors;
}

export function compatibilityForManifest(
  manifest: NormalizedPluginManifest,
): PluginCompatibility {
  const hostApiSupported =
    HOST_API_VERSION >= manifest.hostApi.min &&
    HOST_API_VERSION <= manifest.hostApi.max;
  const runtimeSupported = true;
  const contributionSupported = (
    contribution: PluginContributionDescriptor,
  ): boolean => {
    if (contribution.kind === "engineConnector") {
      return (
        contribution.contractVersion === ENGINE_CONNECTOR_CONTRACT_VERSION &&
        validateEngineConnectorDescriptor(contribution, manifest.runtime.tier)
          .length === 0
      );
    }
    if (contribution.kind === "qaRule") {
      if (manifest.runtime.tier === "declarative") {
        const errors: string[] = [];
        validateDeclarativeContribution(contribution, errors);
        return errors.length === 0;
      }
      return (
        contribution.operationProtocolVersion === 1 &&
        validateQaRuleDescriptor(contribution).length === 0
      );
    }
    if (contribution.kind === "pipelineStep") {
      if (manifest.runtime.tier === "declarative") {
        const errors: string[] = [];
        validateDeclarativeContribution(contribution, errors);
        return errors.length === 0;
      }
      return (
        contribution.operationProtocolVersion === 1 &&
        validatePipelineStepDescriptor(contribution).length === 0
      );
    }
    if (contribution.kind === "aiAction") {
      return (
        contribution.operationProtocolVersion === 1 &&
        validateAiActionDescriptor(contribution, manifest.runtime.tier)
          .length === 0
      );
    }
    if (contribution.kind === "uiPanel") {
      const strict = contribution as UiPanelContributionDescriptor;
      return strict.contractVersion === undefined
        ? manifest.runtime.tier === "sandbox"
        : validateUiPanelDescriptor(strict, manifest.runtime.tier).length === 0;
    }
    if (manifest.runtime.tier === "process") {
      return contribution.kind === "filter";
    }
    if (manifest.runtime.tier === "sandbox") {
      return contribution.kind === "filter";
    }
    if (manifest.runtime.tier !== "declarative") return false;
    const errors: string[] = [];
    validateDeclarativeContribution(contribution, errors);
    return errors.length === 0;
  };
  const contributionsSupported = manifest.contributions.every(
    contributionSupported,
  );
  const unsupportedCapabilities = [
    ...(runtimeSupported ? [] : [`runtime.${manifest.runtime.tier}`]),
    ...manifest.contributions
      .filter((contribution) => !contributionSupported(contribution))
      .map(
        (contribution) =>
          `contribution.${contribution.kind}:${contribution.id}`,
      ),
  ];
  return {
    compatible: hostApiSupported && runtimeSupported && contributionsSupported,
    hostApiSupported,
    runtimeSupported,
    contributionsSupported,
    unsupportedCapabilities,
  };
}

export function canonicalPackageHash(
  entries: PluginPackageFileDigest[],
): string {
  const sorted = [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const canonical = JSON.stringify({
    algorithm: "sha256",
    version: 1,
    entries: sorted,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function isRelativePackagePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes("\0") &&
    !value.includes("..") &&
    !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)
  );
}

function validateDeclarativeContribution(
  contribution: PluginContributionDescriptor,
  errors: string[],
): void {
  if (contribution.kind === "engineConnector") {
    if (contribution.contractVersion === undefined) {
      errors.push(
        `declarative connector ${contribution.id} needs a strict V1 definition`,
      );
    } else {
      errors.push(
        ...validateEngineConnectorDescriptor(contribution, "declarative"),
      );
    }
    return;
  }
  if (contribution.kind === "filter") {
    const definition = contribution.declarative;
    if (!definition) {
      errors.push(`declarative filter ${contribution.id} needs a definition`);
      return;
    }
    if (definition.definitionVersion !== DECLARATIVE_DEFINITION_VERSION) {
      errors.push(
        `declarative filter ${contribution.id} definitionVersion must be 1`,
      );
    }
    if (!definition.unitPattern.includes("(?<source>")) {
      errors.push(
        `declarative filter ${contribution.id} needs a named source capture`,
      );
    }
    validatePattern(definition.unitPattern, "unitPattern", errors);
    if (definition.probeHeaderPattern !== undefined) {
      validatePattern(
        definition.probeHeaderPattern,
        "probeHeaderPattern",
        errors,
      );
    }
    const limits = definition.limits;
    validateIntegerRange(
      limits.maxSourceBytes,
      1,
      64 * 1024 * 1024,
      "maxSourceBytes",
      errors,
    );
    validateIntegerRange(
      limits.maxOutputBytes,
      1,
      64 * 1024 * 1024,
      "maxOutputBytes",
      errors,
    );
    validateIntegerRange(limits.maxUnits, 1, 100_000, "maxUnits", errors);
    validateIntegerRange(
      limits.maxUnitBytes,
      1,
      1024 * 1024,
      "maxUnitBytes",
      errors,
    );
    validateIntegerRange(
      limits.maxCaptureBytes,
      1,
      4_096,
      "maxCaptureBytes",
      errors,
    );
    validateIntegerRange(
      limits.probeHeaderBytes,
      1,
      64 * 1024,
      "probeHeaderBytes",
      errors,
    );
    if (
      !contribution.capabilities.import ||
      !contribution.capabilities.validate ||
      contribution.capabilities.inlineTags ||
      contribution.capabilities.notes ||
      contribution.capabilities.degradationReport
    ) {
      errors.push(
        `declarative filter ${contribution.id} has unsupported capabilities`,
      );
    }
    return;
  }
  if (contribution.kind === "qaRule") {
    const definition = contribution.declarative;
    if (!definition || contribution.ruleType !== "regexPack") {
      errors.push(
        `declarative QA contribution ${contribution.id} needs a regexPack definition`,
      );
      return;
    }
    if (
      definition.definitionVersion !== DECLARATIVE_DEFINITION_VERSION ||
      definition.rules.length < 1 ||
      definition.rules.length > 100
    ) {
      errors.push(
        `declarative QA contribution ${contribution.id} has invalid bounds`,
      );
    }
    const ids = new Set<string>();
    for (const rule of definition.rules) {
      if (!/^[A-Za-z0-9._:-]{1,96}$/.test(rule.id) || ids.has(rule.id)) {
        errors.push(
          `declarative QA contribution ${contribution.id} has invalid rule ids`,
        );
      }
      ids.add(rule.id);
      validatePattern(rule.pattern, `QA rule ${rule.id}`, errors);
    }
    return;
  }
  if (contribution.kind === "pipelineStep") {
    const definition = contribution.declarative;
    if (!definition) {
      errors.push(`declarative pipeline ${contribution.id} needs a definition`);
      return;
    }
    if (
      definition.definitionVersion !== DECLARATIVE_DEFINITION_VERSION ||
      definition.input === "none" ||
      definition.output === "none" ||
      definition.operations.length < 1 ||
      definition.operations.length > 128 ||
      contribution.input !== definition.input ||
      contribution.output !== definition.output ||
      contribution.configSchemaVersion !== DECLARATIVE_DEFINITION_VERSION ||
      contribution.resumable ||
      !contribution.cancellable
    ) {
      errors.push(
        `declarative pipeline ${contribution.id} has invalid descriptor or bounds`,
      );
    }
    validateIntegerRange(
      definition.maxInputBytes,
      1,
      16 * 1024 * 1024,
      "maxInputBytes",
      errors,
    );
    validateIntegerRange(
      definition.maxOutputBytes,
      1,
      16 * 1024 * 1024,
      "maxOutputBytes",
      errors,
    );
    for (const operation of definition.operations) {
      if (
        operation.path.length < 1 ||
        operation.path.length > 32 ||
        operation.path.some(
          (segment) => segment.length < 1 || segment.length > 128,
        )
      ) {
        errors.push(
          `declarative pipeline ${contribution.id} has an invalid path`,
        );
      }
      if (operation.operation === "regexReplace") {
        validatePattern(operation.pattern, "regexReplace pattern", errors);
        validateIntegerRange(
          operation.maxReplacements,
          1,
          100_000,
          "maxReplacements",
          errors,
        );
      }
    }
    return;
  }
  errors.push(`${contribution.kind} is not executable by the declarative host`);
}

function validatePattern(
  pattern: string,
  label: string,
  errors: string[],
): void {
  if (pattern.length < 1 || new TextEncoder().encode(pattern).length > 4_096) {
    errors.push(`${label} must contain between 1 and 4096 bytes`);
  }
}

function validateIntegerRange(
  value: number,
  min: number,
  max: number,
  label: string,
  errors: string[],
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${label} must be an integer between ${min} and ${max}`);
  }
}

function isContributionAllowed(
  tier: PluginTier,
  kind: PluginContributionDescriptor["kind"],
): boolean {
  if (tier === "sandbox") return true;
  if (tier === "process") return kind !== "uiPanel";
  return (
    kind === "filter" ||
    kind === "qaRule" ||
    kind === "pipelineStep" ||
    kind === "engineConnector"
  );
}

function isSupportedPermission(permission: string): boolean {
  try {
    parseLegacyPermission(permission);
    return true;
  } catch {
    return false;
  }
}

const MAX_CAPABILITY_REQUESTS = 64;
const MAX_SCOPE_ITEMS = 64;
const MAX_SCOPE_TEXT = 512;

export function parseLegacyPermission(
  permission: string,
): PluginCapabilityRequest {
  const scoped = (
    capabilityId: PluginCapabilityId,
    scope: PluginCapabilityScope,
  ): PluginCapabilityRequest => ({ capabilityId, required: true, scope });
  if (permission === "file.read:source") {
    return scoped("file.read", { kind: "file", areas: ["source"] });
  }
  if (permission === "file.write:output") {
    return scoped("file.write", { kind: "file", areas: ["output"] });
  }
  const mappings: Array<
    readonly [string, PluginCapabilityId, PluginCapabilityScope["kind"]]
  > = [
    ["network:", "network.connect", "network"],
    ["asset.read:", "asset.read", "assets"],
    ["asset.write:", "asset.write", "assets"],
    ["project.read:", "project.read", "projects"],
    ["project.write:", "project.write", "projects"],
    ["engine.connector:", "engine.connector", "operations"],
    ["qa.register:", "qa.register", "contributions"],
    ["pipeline.register:", "pipeline.register", "contributions"],
    ["ai.action:", "ai.action", "contributions"],
    ["ui.panel:", "ui.panel", "contributions"],
    ["external.connector:", "external.connector", "operations"],
    ["diagnostics.read:", "diagnostics.read", "diagnostics"],
  ];
  for (const [prefix, capabilityId, kind] of mappings) {
    if (!permission.startsWith(prefix)) continue;
    const value = permission.slice(prefix.length);
    if (!isValidScopeText(value)) break;
    switch (kind) {
      case "network":
        return scoped(capabilityId, { kind, origins: [value] });
      case "assets":
        return scoped(capabilityId, {
          kind,
          projectIds: [],
          assetIds: [value],
        });
      case "projects":
        return scoped(capabilityId, { kind, projectIds: [value] });
      case "operations":
        return scoped(capabilityId, { kind, operations: [value] });
      case "contributions":
        return scoped(capabilityId, { kind, contributionIds: [value] });
      case "diagnostics":
        return scoped(capabilityId, { kind, categories: [value] });
      default:
        break;
    }
  }
  throw new Error(`unsupported permission ${permission}`);
}

export function normalizeCapabilityScope(
  scope: PluginCapabilityScope,
): PluginCapabilityScope {
  const strings = (values: string[], label: string): string[] => {
    if (values.length === 0 || values.length > MAX_SCOPE_ITEMS) {
      throw new Error(`${label} must contain between one and 64 items`);
    }
    if (values.some((value) => !isValidScopeText(value))) {
      throw new Error(`${label} contains an invalid value`);
    }
    return [...new Set(values)].sort();
  };
  switch (scope.kind) {
    case "unscoped":
      return scope;
    case "file": {
      if (scope.areas.length === 0 || scope.areas.length > 2) {
        throw new Error("file scope must name at least one managed area");
      }
      return { kind: "file", areas: [...new Set(scope.areas)].sort() };
    }
    case "network":
      return {
        kind: "network",
        origins: strings(scope.origins, "network origins"),
      };
    case "projects":
      return {
        kind: "projects",
        projectIds: strings(scope.projectIds, "project scope"),
      };
    case "assets":
      if (scope.projectIds.length === 0 && scope.assetIds.length === 0) {
        throw new Error("asset scope must name at least one project or asset");
      }
      return {
        kind: "assets",
        projectIds:
          scope.projectIds.length === 0
            ? []
            : strings(scope.projectIds, "asset project scope"),
        assetIds:
          scope.assetIds.length === 0
            ? []
            : strings(scope.assetIds, "asset scope"),
      };
    case "operations":
      return {
        kind: "operations",
        operations: strings(scope.operations, "operation scope"),
      };
    case "contributions":
      return {
        kind: "contributions",
        contributionIds: strings(scope.contributionIds, "contribution scope"),
      };
    case "diagnostics":
      return {
        kind: "diagnostics",
        categories: strings(scope.categories, "diagnostic scope"),
      };
  }
}

export function normalizeCapabilityRequest(
  request: PluginCapabilityRequest,
): PluginCapabilityRequest {
  const scope = normalizeCapabilityScope(request.scope);
  const required = request.required ?? true;
  if (!isValidCapabilityId(request.capabilityId)) {
    throw new Error("capability id is empty, oversized, or malformed");
  }
  const supported = isKnownPluginCapabilityId(request.capabilityId);
  if (!supported && required) {
    throw new Error(`unsupported capability ${request.capabilityId}`);
  }
  if (supported && !scopeMatchesCapability(request.capabilityId, scope)) {
    throw new Error(
      `scope kind does not match capability ${request.capabilityId}`,
    );
  }
  if (request.contributionId !== undefined) {
    const errors: string[] = [];
    validateId(request.contributionId, "capability contribution id", errors);
    if (errors.length > 0) throw new Error(errors[0]);
  }
  return {
    capabilityId: request.capabilityId,
    required,
    scope,
    ...(request.contributionId === undefined
      ? {}
      : { contributionId: request.contributionId }),
  };
}

export function normalizeCapabilityRequests(
  legacyPermissions: string[],
  typedRequests: PluginCapabilityRequest[],
): PluginCapabilityRequest[] {
  if (
    legacyPermissions.length + typedRequests.length >
    MAX_CAPABILITY_REQUESTS
  ) {
    throw new Error("too many requested capabilities");
  }
  const bySemanticKey = new Map<string, PluginCapabilityRequest>();
  for (const request of [
    ...legacyPermissions.map(parseLegacyPermission),
    ...typedRequests,
  ]) {
    const normalized = normalizeCapabilityRequest(request);
    bySemanticKey.set(JSON.stringify(normalized), normalized);
  }
  return [...bySemanticKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, request]) => request);
}

export function capabilityScopeContains(
  allowed: PluginCapabilityScope,
  candidate: PluginCapabilityScope,
): boolean {
  const contains = (values: string[], requested: string[]): boolean =>
    requested.every((value) => values.includes("*") || values.includes(value));
  if (allowed.kind !== candidate.kind) return false;
  switch (allowed.kind) {
    case "unscoped":
      return true;
    case "file":
      return (
        candidate.kind === "file" && contains(allowed.areas, candidate.areas)
      );
    case "network":
      return (
        candidate.kind === "network" &&
        contains(allowed.origins, candidate.origins)
      );
    case "projects":
      return (
        candidate.kind === "projects" &&
        contains(allowed.projectIds, candidate.projectIds)
      );
    case "assets":
      return (
        candidate.kind === "assets" &&
        contains(allowed.projectIds, candidate.projectIds) &&
        contains(allowed.assetIds, candidate.assetIds)
      );
    case "operations":
      return (
        candidate.kind === "operations" &&
        contains(allowed.operations, candidate.operations)
      );
    case "contributions":
      return (
        candidate.kind === "contributions" &&
        contains(allowed.contributionIds, candidate.contributionIds)
      );
    case "diagnostics":
      return (
        candidate.kind === "diagnostics" &&
        contains(allowed.categories, candidate.categories)
      );
  }
}

function validateCapabilityRequests(
  requests: PluginCapabilityRequest[],
  errors: string[],
): void {
  try {
    normalizeCapabilityRequests([], requests);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function isValidScopeText(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SCOPE_TEXT &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isValidCapabilityId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

export function isKnownPluginCapabilityId(
  capabilityId: string,
): capabilityId is KnownPluginCapabilityId {
  return PLUGIN_CAPABILITY_IDS.some((candidate) => candidate === capabilityId);
}

function scopeMatchesCapability(
  capabilityId: string,
  scope: PluginCapabilityScope,
): boolean {
  if (capabilityId === "file.read" || capabilityId === "file.write") {
    return scope.kind === "file";
  }
  if (capabilityId === "network.connect") return scope.kind === "network";
  if (capabilityId === "asset.read" || capabilityId === "asset.write") {
    return scope.kind === "assets";
  }
  if (capabilityId === "project.read" || capabilityId === "project.write") {
    return scope.kind === "projects";
  }
  if (
    capabilityId === "engine.connector" ||
    capabilityId === "external.connector"
  ) {
    return scope.kind === "operations";
  }
  if (
    capabilityId === "qa.register" ||
    capabilityId === "pipeline.register" ||
    capabilityId === "ai.action" ||
    capabilityId === "ui.panel"
  ) {
    return scope.kind === "contributions";
  }
  return capabilityId === "diagnostics.read" && scope.kind === "diagnostics";
}

export type PluginFilterEvent =
  | {
      type: "startDocument";
      metadata: {
        format: string;
        sourceLocale?: string;
        properties?: Record<string, string>;
      };
    }
  | { type: "startUnit"; ordinal: number; structuralPath: string }
  | { type: "text"; text: string }
  | { type: "targetText"; text: string }
  | { type: "endUnit" }
  | { type: "endDocument" }
  | {
      type: "degradation";
      finding: {
        code: string;
        severity: "info" | "warning" | "error";
        message: string;
        structuralPath?: string;
      };
    };

export interface ProbeResult {
  confidence: number;
  reason: string;
}

export interface ExportReport {
  outputPath: string;
  translatedSegments: number;
  degradation: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    structuralPath?: string;
  }>;
}

export interface ValidationReport {
  valid: boolean;
  findings: ExportReport["degradation"];
}

export interface Segment {
  id: string;
  documentId: string;
  ordinal: number;
  structuralPath: string;
  sourceText: string;
  targetText: string;
  state: string;
  revision: number;
  sourceHash: string;
  contextHash: string;
  updatedAtMs: number;
}

export interface FilterHandlers {
  descriptor(): FilterDescriptor;
  probe(input: { sourcePath: string }): ProbeResult | Promise<ProbeResult>;
  import(input: {
    sourcePath: string;
    documentId?: string | null;
    sourceLocale?: string | null;
    options?: Record<string, string>;
  }): PluginFilterEvent[] | Promise<PluginFilterEvent[]>;
  export(input: {
    sourcePath: string;
    outputPath: string;
    segments: Segment[];
  }): ExportReport | Promise<ExportReport>;
  validate(input: {
    sourcePath: string;
  }): ValidationReport | Promise<ValidationReport>;
}

export function createSandboxEngineConnectorPlugin(
  options: SandboxEngineConnectorOptionsV1,
): SandboxPluginV1 {
  const limits = options.limits ?? defaultEngineConnectorLimits();
  const active = new Map<string, AbortController>();
  const limitErrors: string[] = [];
  validateConnectorLimits(limits, limitErrors);
  throwIfErrors(limitErrors, "invalid connector limits");
  return {
    async invoke(invocation, _host, invocationContext) {
      const credential = parseSandboxInvocationCredential(invocationContext);
      if (invocation.contributionId !== options.contributionId) {
        throw new Error("connector contribution does not match this handler");
      }
      if (invocation.operation === "connector.cancel") {
        if (credential !== undefined) {
          throw new Error(
            "connector cancellation does not accept a credential",
          );
        }
        const request = parseConnectorCancelRequest(invocation.input);
        active.get(request.requestId)?.abort();
        await options.handler.cancel(request);
        return {};
      }
      if (!invocation.operation.startsWith("connector.")) {
        throw new Error("unsupported connector sandbox operation");
      }
      const request = parseConnectorRequest(invocation.input, limits);
      if (`connector.${request.operation}` !== invocation.operation) {
        throw new Error("connector operation does not match request payload");
      }
      const controller = new AbortController();
      if (active.has(request.requestId)) {
        throw new Error("connector requestId is already active");
      }
      active.set(request.requestId, controller);
      const context: { credential?: string; signal: AbortSignal } = {
        ...(credential !== undefined ? { credential } : {}),
        signal: controller.signal,
      };
      try {
        return await dispatchConnectorHandler(
          options.handler,
          request,
          context,
          limits,
        );
      } finally {
        delete context.credential;
        active.delete(request.requestId);
      }
    },
    async deactivate() {
      for (const controller of active.values()) controller.abort();
      active.clear();
      await options.handler.shutdown({ contractVersion: 1 });
    },
  };
}

function parseSandboxInvocationCredential(
  context: SandboxInvocationContextV1 | undefined,
): string | undefined {
  if (context === undefined) return undefined;
  const errors: string[] = [];
  const record = strictRecord(
    context,
    ["credential"],
    "sandbox invocation context",
    errors,
  );
  if (record?.credential !== undefined) {
    boundedString(
      record.credential,
      0,
      MAX_ENGINE_CONNECTOR_CREDENTIAL_BYTES,
      "sandbox invocation credential",
      errors,
    );
  }
  throwIfErrors(errors, "invalid sandbox invocation context");
  return typeof record?.credential === "string" ? record.credential : undefined;
}

export function startProcessEngineConnector(
  options: ProcessEngineConnectorOptionsV1,
): void {
  const normalized = normalizeManifest(options.manifest);
  const manifestErrors = validateNormalizedManifest(normalized);
  if (manifestErrors.length > 0) {
    throw new Error(`invalid plugin manifest: ${manifestErrors.join("; ")}`);
  }
  const contribution = normalized.contributions.find(
    (candidate): candidate is EngineConnectorContributionDescriptorV1 =>
      candidate.kind === "engineConnector" &&
      candidate.id === options.contributionId &&
      candidate.contractVersion === ENGINE_CONNECTOR_CONTRACT_VERSION,
  );
  if (!contribution) {
    throw new Error(
      `strict connector ${options.contributionId} is not in the manifest`,
    );
  }
  const limits = contribution.limits;
  const active = new Map<string, AbortController>();
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    void handleConnectorProcessLine(line, options, contribution, active);
  });
}

async function handleConnectorProcessLine(
  line: string,
  options: ProcessEngineConnectorOptionsV1,
  contribution: EngineConnectorContributionDescriptorV1,
  active: Map<string, AbortController>,
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let rpc: JsonRpcRequest;
  try {
    rpc = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    writeConnectorRpcError(null, safeConnectorFailure("invalid", "protocol"));
    return;
  }
  const id = typeof rpc.id === "number" ? rpc.id : null;
  const method = rpc.method ?? "";
  let currentRequestId = "unknown";
  try {
    if (method === "plugin.handshake") {
      if (id !== null) {
        writeResult(id, {
          apiVersion: HOST_API_VERSION,
          pluginId: options.manifest.id,
          contributions: options.manifest.contributions,
        });
      }
      return;
    }
    if (method === "plugin.shutdown") {
      for (const controller of active.values()) controller.abort();
      active.clear();
      await options.handler.shutdown({ contractVersion: 1 });
      if (id !== null) writeResult(id, {});
      setTimeout(() => process.exit(0), 0).unref?.();
      return;
    }
    if (method === "connector.cancel") {
      const request = parseConnectorCancelRequest(rpc.params);
      active.get(request.requestId)?.abort();
      await options.handler.cancel(request);
      if (id !== null) writeResult(id, {});
      return;
    }
    if (!method.startsWith("connector.")) {
      throw new Error("unsupported connector process method");
    }
    const paramsErrors: string[] = [];
    const params = strictRecord(
      rpc.params,
      ["request", "credential"],
      "connector invocation params",
      paramsErrors,
    );
    throwIfErrors(paramsErrors, "invalid connector invocation params");
    if (!params)
      throw new Error("connector invocation params must be an object");
    const request = parseConnectorRequest(params.request, contribution.limits);
    currentRequestId = request.requestId;
    if (method !== `connector.${request.operation}`) {
      throw new Error(
        "connector process method does not match request payload",
      );
    }
    if (params.credential !== undefined) {
      if (
        typeof params.credential !== "string" ||
        params.credential.includes("\0") ||
        utf8Bytes(params.credential) > MAX_ENGINE_CONNECTOR_CREDENTIAL_BYTES
      ) {
        throw new Error("connector credential is malformed or oversized");
      }
    }
    if (active.has(request.requestId)) {
      throw new Error("connector requestId is already active");
    }
    const controller = new AbortController();
    const context: { credential?: string; signal: AbortSignal } = {
      ...(typeof params.credential === "string"
        ? { credential: params.credential }
        : {}),
      signal: controller.signal,
    };
    active.set(request.requestId, controller);
    try {
      const result = await dispatchConnectorHandler(
        options.handler,
        request,
        context,
        contribution.limits,
        request.operation === "generate"
          ? (event) => {
              output.write(
                `${JSON.stringify({
                  jsonrpc: "2.0",
                  method: "connector.event",
                  params: event,
                })}\n`,
              );
            }
          : undefined,
      );
      if (id !== null) writeResult(id, result);
    } finally {
      delete context.credential;
      active.delete(request.requestId);
    }
  } catch (error) {
    if (id !== null) {
      writeConnectorRpcError(
        id,
        connectorFailureFromError(error, currentRequestId),
      );
    }
  }
}

async function dispatchConnectorHandler(
  handler: EngineConnectorHandlerV1,
  request: EngineConnectorRequestV1,
  context: EngineConnectorInvocationContextV1,
  limits: EngineConnectorLimitsV1,
  emit?: (event: EngineConnectorEventV1) => void,
): Promise<unknown> {
  switch (request.operation) {
    case "validateConfig": {
      const result = await handler.validateConfig(request, context);
      throwIfErrors(
        validateEngineConnectorConfigValidationResult(result),
        "invalid connector config validation result",
      );
      return result;
    }
    case "test": {
      const result = await handler.test(request, context);
      throwIfErrors(
        validateEngineConnectorTestResult(result),
        "invalid connector test result",
      );
      return result;
    }
    case "models.list": {
      if (!handler.listModels)
        throw new Error("connector does not implement models.list");
      const result = await handler.listModels(request, context);
      throwIfErrors(
        validateEngineConnectorModelCatalog(result, limits),
        "invalid connector model catalog",
      );
      return result;
    }
    case "generate": {
      const events: EngineConnectorEventV1[] = [];
      const sequence = new EngineConnectorEventSequenceValidatorV1(
        request.requestId,
        limits,
      );
      for await (const event of handler.generate(request, context)) {
        if (context.signal.aborted)
          throw new Error("connector request was cancelled");
        throwIfErrors(sequence.accept(event), "invalid connector event");
        emit?.(event);
        if (!emit) events.push(event);
      }
      if (!sequence.isCompleted()) {
        throw new Error("connector generation omitted completion");
      }
      return emit ? { completed: true } : { events };
    }
  }
}

function parseConnectorRequest(
  value: unknown,
  limits: EngineConnectorLimitsV1,
): EngineConnectorRequestV1 {
  throwIfErrors(
    validateEngineConnectorRequest(value, limits),
    "invalid connector request",
  );
  return value as EngineConnectorRequestV1;
}

function parseConnectorCancelRequest(
  value: unknown,
): EngineConnectorCancelRequestV1 {
  const errors: string[] = [];
  const request = strictRecord(
    value,
    ["contractVersion", "requestId"],
    "connector cancellation",
    errors,
  );
  if (request?.contractVersion !== ENGINE_CONNECTOR_CONTRACT_VERSION) {
    errors.push("connector cancellation contractVersion must be 1");
  }
  if (request) validateRequestId(request.requestId, errors);
  throwIfErrors(errors, "invalid connector cancellation");
  return value as EngineConnectorCancelRequestV1;
}

function connectorFailureFromError(
  error: unknown,
  requestId: string,
): EngineConnectorFailureV1 {
  if (error instanceof EngineConnectorHandlerError) return error.failure;
  return safeConnectorFailure(requestId, "protocol");
}

function safeConnectorFailure(
  requestId: string,
  code: EngineConnectorFailureCodeV1,
): EngineConnectorFailureV1 {
  return {
    contractVersion: 1,
    requestId,
    code,
    message: "connector invocation failed",
    retryable: false,
  };
}

function writeConnectorRpcError(
  id: number | null,
  failure: EngineConnectorFailureV1,
): void {
  output.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32010,
        message: "connector invocation failed",
        data: failure,
      },
    })}\n`,
  );
}

function throwIfErrors(errors: string[], label: string): void {
  if (errors.length > 0) throw new Error(`${label}: ${errors.join("; ")}`);
}

export interface ProcessPluginOptions {
  manifest: PluginManifest;
  filter: FilterHandlers;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
}

export function validateManifest(manifest: PluginManifest): string[] {
  const errors: string[] = [];
  if (manifest.manifestVersion !== 1) errors.push("manifestVersion must be 1");
  validateId(manifest.id, "id", errors);
  if (manifest.id?.startsWith("builtin.")) {
    errors.push("id must not use builtin. prefix");
  }
  if (!manifest.displayName?.trim()) errors.push("displayName is required");
  if (!manifest.version?.trim()) errors.push("version is required");
  if (
    !Number.isInteger(manifest.apiVersion) ||
    !Number.isInteger(manifest.apiVersionMin) ||
    manifest.apiVersion < 0 ||
    manifest.apiVersionMin < 0
  ) {
    errors.push("apiVersion and apiVersionMin must be non-negative integers");
  } else if (manifest.apiVersionMin > manifest.apiVersion) {
    errors.push("apiVersionMin must be <= apiVersion");
  } else if (
    HOST_API_VERSION < manifest.apiVersionMin ||
    HOST_API_VERSION > manifest.apiVersion
  ) {
    errors.push(
      `host API ${HOST_API_VERSION} is outside plugin range ${manifest.apiVersionMin}..=${manifest.apiVersion}`,
    );
  }
  if (manifest.tier !== "process") errors.push("tier must be process");
  if (
    !manifest.entry ||
    !["node", "executable"].includes(manifest.entry.kind) ||
    !manifest.entry.path?.trim() ||
    manifest.entry.path.includes("..") ||
    /^(?:[A-Za-z]:[\\/]|[\\/])/.test(manifest.entry.path)
  ) {
    errors.push(
      "entry must have a supported kind and a relative path without '..'",
    );
  }

  const filters = manifest.contributions?.filters;
  if (!filters?.length) {
    errors.push("at least one filter contribution is required");
  } else {
    const seen = new Set<string>();
    for (const filter of filters) {
      validateId(filter.id, "filter id", errors);
      if (filter.id?.startsWith("builtin.")) {
        errors.push(`filter id ${filter.id} must not use builtin. prefix`);
      }
      if (seen.has(filter.id)) {
        errors.push(`duplicate filter id ${filter.id}`);
      }
      seen.add(filter.id);
      if (!filter.version?.trim() || !filter.displayName?.trim()) {
        errors.push(`filter ${filter.id} needs version and displayName`);
      }
      if (!filter.extensions?.length) {
        errors.push(`filter ${filter.id} needs at least one extension`);
      }
    }
  }
  for (const permission of manifest.permissions ?? []) {
    if (
      permission !== "file.read:source" &&
      permission !== "file.write:output" &&
      !(
        permission.startsWith("network:") &&
        permission.length > "network:".length
      )
    ) {
      errors.push(`unsupported permission ${permission}`);
    }
  }
  validateCapabilityRequests(manifest.capabilities ?? [], errors);
  return errors;
}

function validateId(
  value: string | undefined,
  label: string,
  errors: string[],
): void {
  if (!value || value.trim() !== value) {
    errors.push(`${label} must be non-empty without surrounding whitespace`);
  } else if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    errors.push(`${label} contains unsupported characters`);
  }
}

export function startProcessPlugin(options: ProcessPluginOptions): void {
  const { manifest, filter } = options;
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`invalid plugin manifest: ${errors.join("; ")}`);
  }

  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    void handleLine(line, manifest, filter);
  });
}

async function handleLine(
  line: string,
  manifest: PluginManifest,
  filter: FilterHandlers,
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(trimmed) as JsonRpcRequest;
  } catch (error) {
    writeError(null, `invalid JSON: ${String(error)}`);
    return;
  }
  const id = typeof request.id === "number" ? request.id : null;
  const method = request.method ?? "";
  try {
    const result = await dispatch(method, request.params, manifest, filter);
    if (id !== null) writeResult(id, result);
  } catch (error) {
    if (id !== null) {
      writeError(id, error instanceof Error ? error.message : String(error));
    }
  }
}

async function dispatch(
  method: string,
  params: unknown,
  manifest: PluginManifest,
  filter: FilterHandlers,
): Promise<unknown> {
  switch (method) {
    case "plugin.handshake":
      return {
        apiVersion: HOST_API_VERSION,
        pluginId: manifest.id,
        contributions: manifest.contributions,
      };
    case "plugin.shutdown":
      setTimeout(() => process.exit(0), 0).unref?.();
      return {};
    case "filter.descriptor":
      return filter.descriptor();
    case "filter.probe":
      return filter.probe(asRecord(params) as { sourcePath: string });
    case "filter.import":
      return filter.import(
        asRecord(params) as {
          sourcePath: string;
          documentId?: string | null;
          sourceLocale?: string | null;
          options?: Record<string, string>;
        },
      );
    case "filter.export":
      return filter.export(
        asRecord(params) as {
          sourcePath: string;
          outputPath: string;
          segments: Segment[];
        },
      );
    case "filter.validate":
      return filter.validate(asRecord(params) as { sourcePath: string });
    default:
      throw new Error(`unknown method ${method}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

function writeResult(id: number, result: unknown): void {
  output.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function writeError(id: number | null, message: string): void {
  output.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    })}\n`,
  );
}
