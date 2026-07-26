import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createHash } from "node:crypto";

export const HOST_API_VERSION = 1;
export const NORMALIZED_MANIFEST_VERSION = 1;
export const RUNTIME_DESCRIPTOR_VERSION = 1;
export const CONTRIBUTION_DESCRIPTOR_VERSION = 1;
export const PROCESS_PROTOCOL_VERSION = 1;

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
  config?: Record<string, unknown>;
}

export interface PipelineStepContributionDescriptor {
  kind: "pipelineStep";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  configSchemaVersion: number;
  resumable: boolean;
  cancellable: boolean;
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
  const runtimeSupported = manifest.runtime.tier === "process";
  const contributionsSupported = manifest.contributions.every(
    (contribution) => contribution.kind === "filter",
  );
  const unsupportedCapabilities = [
    ...(runtimeSupported ? [] : [`runtime.${manifest.runtime.tier}`]),
    ...manifest.contributions
      .filter((contribution) => contribution.kind !== "filter")
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
