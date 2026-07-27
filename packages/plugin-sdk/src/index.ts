import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createHash } from "node:crypto";

export const HOST_API_VERSION = 1;
export const NORMALIZED_MANIFEST_VERSION = 1;
export const RUNTIME_DESCRIPTOR_VERSION = 1;
export const CONTRIBUTION_DESCRIPTOR_VERSION = 1;
export const PROCESS_PROTOCOL_VERSION = 1;
export const DECLARATIVE_DEFINITION_VERSION = 1;
export const SANDBOX_PROTOCOL_VERSION = 1;
export const SANDBOX_BRIDGE_VERSION = 1;

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

export interface EngineConnectorContributionDescriptor {
  kind: "engineConnector";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  protocol: string;
  operations: string[];
  configSchemaVersion: number;
}

export interface QaRuleContributionDescriptor {
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
}

export interface PipelineStepContributionDescriptor {
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
}

export interface AiActionContributionDescriptor {
  kind: "aiAction";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  label: string;
  placement: string;
  input: Record<string, unknown>;
  promptTemplate?: string;
}

export interface UiPanelContributionDescriptor {
  kind: "uiPanel";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  label: string;
  placement: string;
  surface: string;
  bridgeVersion: number;
}

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
    QaRuleContributionDescriptor,
    "kind" | "descriptorVersion" | "ruleType"
  > & { declarative: DeclarativeQaPackDefinitionV1 },
): QaRuleContributionDescriptor {
  return {
    kind: "qaRule",
    descriptorVersion: CONTRIBUTION_DESCRIPTOR_VERSION,
    ruleType: "regexPack",
    ...contribution,
  };
}

export function defineDeclarativePipelineStep(
  contribution: Omit<
    PipelineStepContributionDescriptor,
    | "kind"
    | "descriptorVersion"
    | "input"
    | "output"
    | "configSchemaVersion"
    | "resumable"
    | "cancellable"
  > & { declarative: DeclarativePipelineDefinitionV1 },
): PipelineStepContributionDescriptor {
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
    if (manifest.runtime.tier === "process") {
      return contribution.kind === "filter";
    }
    if (manifest.runtime.tier === "sandbox") {
      return contribution.kind === "filter" || contribution.kind === "uiPanel";
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
  return kind === "filter" || kind === "qaRule" || kind === "pipelineStep";
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
