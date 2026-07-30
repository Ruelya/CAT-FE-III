/**
 * Public external-system connector SDK (P-08).
 *
 * Handlers exchange bounded translation objects only. Credentials are never
 * fields on serializable requests. Durable jobs, outbox delivery, webhook HTTP
 * ownership, and CAT application writes belong to later automation work.
 */

import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createHash } from "node:crypto";

import type { EngineConnectorConfigSchemaV1, EngineConnectorConfigV1 } from "./index.js";
import {
  ENGINE_CONNECTOR_CONFIG_SCHEMA_VERSION,
  HOST_API_VERSION,
  normalizeManifest,
  validateNormalizedManifest,
  type PluginManifestV2,
} from "./index.js";

export const EXTERNAL_CONNECTOR_CONTRACT_VERSION = 1;
export const EXTERNAL_CONNECTOR_PROTOCOL_V1 =
  "translunar.externalConnector.v1" as const;
export const EXTERNAL_CONNECTOR_CONFIG_SCHEMA_VERSION = 1;
export const EXTERNAL_CONNECTOR_CHECKPOINT_SCHEMA_VERSION = 1;

export const EXTERNAL_CONNECTOR_OPERATIONS_V1 = [
  "validateConfig",
  "test",
  "pull",
  "push",
  "poll",
  "webhook",
] as const;

export type ExternalConnectorOperationV1 =
  (typeof EXTERNAL_CONNECTOR_OPERATIONS_V1)[number];

export const EXTERNAL_CONNECTOR_LIMITS = Object.freeze({
  configBytes: 64 * 1024,
  items: 256,
  itemTextBytes: 256 * 1024,
  metadataEntries: 32,
  checkpointBytes: 64 * 1024,
  deadlineMs: 120_000,
  requestBytes: 256 * 1024,
  responseBytes: 1024 * 1024,
  requestIdBytes: 128,
  credentialBytes: 16 * 1024,
} as const);

export type ExternalConnectorFailureCodeV1 =
  | "invalidConfig"
  | "authentication"
  | "conflict"
  | "rateLimit"
  | "timeout"
  | "unavailable"
  | "protocol"
  | "payloadSize"
  | "cancelled"
  | "hostCrash"
  | "permissionDenied"
  | "staleGeneration"
  | "idempotencyConflict";

export interface ExternalConnectorCredentialSlotV1 {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  operations: ExternalConnectorOperationV1[];
}

export interface ExternalConnectorLimitsV1 {
  maxConfigBytes: number;
  maxItems: number;
  maxItemTextBytes: number;
  maxMetadataEntries: number;
  maxCheckpointBytes: number;
  maxDeadlineMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
}

export interface ExternalConnectorProfileBindingV1 {
  profileId: string;
  contributionId: string;
  pluginId: string;
  versionId: string;
  activationRevision: number;
  contractVersion: 1;
  configSchemaVersion: 1;
  checkpointSchemaVersion: 1;
}

export interface ExternalConnectorItemV1 {
  externalId: string;
  externalRevision?: string;
  sourceLocale: string;
  targetLocale: string;
  sourceText: string;
  targetText?: string;
  context?: string;
  metadata?: Record<string, string>;
}

export interface ExternalConnectorReceiptV1 {
  externalId: string;
  accepted: boolean;
  remoteRevision?: string;
  message?: string;
}

export interface ExternalConnectorCheckpointCandidateV1 {
  streamId: string;
  schemaVersion: 1;
  payload: unknown;
  cursor?: string;
}

export interface ExternalConnectorRequestHeaderV1 {
  contractVersion: 1;
  requestId: string;
  deadlineMs: number;
  binding: ExternalConnectorProfileBindingV1;
  idempotencyKey?: string;
  expectedCheckpointRevision?: number;
  attempt?: number;
  config: EngineConnectorConfigV1;
}

export type ExternalConnectorRequestV1 =
  | ({ operation: "validateConfig" } & ExternalConnectorRequestHeaderV1)
  | ({ operation: "test" } & ExternalConnectorRequestHeaderV1)
  | ({
      operation: "pull";
      payload: {
        streamId: string;
        cursor?: string;
        limit: number;
        sourceLocale?: string;
        targetLocale?: string;
      };
    } & ExternalConnectorRequestHeaderV1)
  | ({
      operation: "push";
      payload: { streamId: string; items: ExternalConnectorItemV1[] };
    } & ExternalConnectorRequestHeaderV1)
  | ({
      operation: "poll";
      payload: { streamId: string; cursor?: string; limit: number };
    } & ExternalConnectorRequestHeaderV1)
  | ({
      operation: "webhook";
      payload: {
        streamId: string;
        eventId: string;
        eventType: string;
        body: unknown;
        headers?: Record<string, string>;
        signature?: string;
      };
    } & ExternalConnectorRequestHeaderV1);

export type ExternalConnectorResultV1 =
  | {
      operation: "validateConfig";
      valid: boolean;
      issues: Array<{ field: string; code: string; message: string }>;
    }
  | {
      operation: "test";
      ok: boolean;
      latencyMs: number;
      message?: string;
    }
  | {
      operation: "pull" | "poll" | "webhook";
      items: ExternalConnectorItemV1[];
      hasMore: boolean;
      nextCursor?: string;
      checkpoint?: ExternalConnectorCheckpointCandidateV1;
    }
  | {
      operation: "push";
      receipts: ExternalConnectorReceiptV1[];
      checkpoint?: ExternalConnectorCheckpointCandidateV1;
    };

export interface ExternalConnectorFailureV1 {
  contractVersion: 1;
  requestId: string;
  code: ExternalConnectorFailureCodeV1;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface ExternalConnectorInvocationContextV1 {
  credentials: Record<string, string>;
  signal: AbortSignal;
}

export interface ExternalConnectorHandlerV1 {
  validateConfig(
    request: Extract<ExternalConnectorRequestV1, { operation: "validateConfig" }>,
    context: ExternalConnectorInvocationContextV1,
  ): Promise<Extract<ExternalConnectorResultV1, { operation: "validateConfig" }>>;
  test(
    request: Extract<ExternalConnectorRequestV1, { operation: "test" }>,
    context: ExternalConnectorInvocationContextV1,
  ): Promise<Extract<ExternalConnectorResultV1, { operation: "test" }>>;
  pull?(
    request: Extract<ExternalConnectorRequestV1, { operation: "pull" }>,
    context: ExternalConnectorInvocationContextV1,
  ): Promise<Extract<ExternalConnectorResultV1, { operation: "pull" }>>;
  push?(
    request: Extract<ExternalConnectorRequestV1, { operation: "push" }>,
    context: ExternalConnectorInvocationContextV1,
  ): Promise<Extract<ExternalConnectorResultV1, { operation: "push" }>>;
  poll?(
    request: Extract<ExternalConnectorRequestV1, { operation: "poll" }>,
    context: ExternalConnectorInvocationContextV1,
  ): Promise<Extract<ExternalConnectorResultV1, { operation: "poll" }>>;
  webhook?(
    request: Extract<ExternalConnectorRequestV1, { operation: "webhook" }>,
    context: ExternalConnectorInvocationContextV1,
  ): Promise<Extract<ExternalConnectorResultV1, { operation: "webhook" }>>;
  cancel(request: { contractVersion: 1; requestId: string }): Promise<void>;
  shutdown(request: { contractVersion: 1 }): Promise<void>;
}

export interface ExternalConnectorContributionDescriptorV1 {
  kind: "externalConnector";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  transports: string[];
  checkpointVersion: number;
  capabilities: Record<string, boolean>;
  protocol: typeof EXTERNAL_CONNECTOR_PROTOCOL_V1;
  contractVersion: 1;
  configSchemaVersion: 1;
  checkpointSchemaVersion: 1;
  operations: ExternalConnectorOperationV1[];
  origins: string[];
  credentialSlots: ExternalConnectorCredentialSlotV1[];
  configSchema: EngineConnectorConfigSchemaV1;
  limits: ExternalConnectorLimitsV1;
  declarative?: DeclarativeExternalConnectorDefinitionV1;
}

export interface DeclarativeExternalConnectorDefinitionV1 {
  definitionVersion: 1;
  test?: ExternalConnectorEndpointMappingV1;
  pull?: ExternalConnectorEndpointMappingV1;
  push?: ExternalConnectorEndpointMappingV1;
  poll?: ExternalConnectorEndpointMappingV1;
  webhook?: ExternalConnectorEndpointMappingV1;
  webhookSignature?:
    | { kind: "none" }
    | { kind: "hmacSha256"; header: string; slot: string; prefix?: string };
  failures?: Array<{
    status: number;
    code: ExternalConnectorFailureCodeV1;
    retryable: boolean;
  }>;
}

export interface ExternalConnectorEndpointMappingV1 {
  destinationOrigin: string;
  urlTemplate: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  fixedHeaders?: Array<{ name: string; value: string }>;
  authentication:
    | { kind: "none" }
    | { kind: "bearer"; slot: string }
    | { kind: "header"; name: string; slot: string }
    | { kind: "query"; name: string; slot: string };
  fixedQuery?: Record<string, string>;
  fixedBody?: Record<string, unknown>;
  itemsPath?: string[];
  hasMorePath?: string[];
  checkpointPath?: string[];
  receiptsPath?: string[];
}

export class ExternalConnectorHandlerError extends Error {
  readonly failure: ExternalConnectorFailureV1;

  constructor(failure: ExternalConnectorFailureV1) {
    super(failure.message);
    this.name = "ExternalConnectorHandlerError";
    this.failure = failure;
  }
}

export function defaultExternalConnectorLimits(): ExternalConnectorLimitsV1 {
  return {
    maxConfigBytes: EXTERNAL_CONNECTOR_LIMITS.configBytes,
    maxItems: EXTERNAL_CONNECTOR_LIMITS.items,
    maxItemTextBytes: EXTERNAL_CONNECTOR_LIMITS.itemTextBytes,
    maxMetadataEntries: EXTERNAL_CONNECTOR_LIMITS.metadataEntries,
    maxCheckpointBytes: EXTERNAL_CONNECTOR_LIMITS.checkpointBytes,
    maxDeadlineMs: EXTERNAL_CONNECTOR_LIMITS.deadlineMs,
    maxRequestBytes: EXTERNAL_CONNECTOR_LIMITS.requestBytes,
    maxResponseBytes: EXTERNAL_CONNECTOR_LIMITS.responseBytes,
  };
}

export function defineExternalConnector(
  contribution: Omit<
    ExternalConnectorContributionDescriptorV1,
    | "kind"
    | "descriptorVersion"
    | "protocol"
    | "contractVersion"
    | "configSchemaVersion"
    | "checkpointSchemaVersion"
    | "limits"
  > & {
    limits?: Partial<ExternalConnectorLimitsV1>;
  },
): ExternalConnectorContributionDescriptorV1 {
  const operations = contribution.operations;
  if (!operations.includes("validateConfig") || !operations.includes("test")) {
    throw new Error("external connector must declare validateConfig and test");
  }
  if (!operations.some((op) => ["pull", "push", "poll", "webhook"].includes(op))) {
    throw new Error("external connector must declare at least one exchange operation");
  }
  return {
    kind: "externalConnector",
    descriptorVersion: 1,
    protocol: EXTERNAL_CONNECTOR_PROTOCOL_V1,
    contractVersion: 1,
    configSchemaVersion: EXTERNAL_CONNECTOR_CONFIG_SCHEMA_VERSION,
    checkpointSchemaVersion: EXTERNAL_CONNECTOR_CHECKPOINT_SCHEMA_VERSION,
    limits: { ...defaultExternalConnectorLimits(), ...contribution.limits },
    ...contribution,
  };
}

export function defineDeclarativeExternalConnector(
  contribution: Parameters<typeof defineExternalConnector>[0] & {
    declarative: DeclarativeExternalConnectorDefinitionV1;
  },
): ExternalConnectorContributionDescriptorV1 {
  return defineExternalConnector(contribution);
}

export function validateExternalConnectorDescriptor(
  descriptor: ExternalConnectorContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  if (descriptor.protocol !== EXTERNAL_CONNECTOR_PROTOCOL_V1) {
    errors.push(`protocol must be ${EXTERNAL_CONNECTOR_PROTOCOL_V1}`);
  }
  if (descriptor.contractVersion !== 1) {
    errors.push("contractVersion must be 1");
  }
  if (!descriptor.operations.includes("validateConfig")) {
    errors.push("validateConfig is required");
  }
  if (!descriptor.operations.includes("test")) {
    errors.push("test is required");
  }
  if (
    !descriptor.operations.some((op) =>
      ["pull", "push", "poll", "webhook"].includes(op),
    )
  ) {
    errors.push("at least one exchange operation is required");
  }
  if (!descriptor.origins?.length) errors.push("origins are required");
  for (const origin of descriptor.origins ?? []) {
    if (
      !origin.startsWith("https://") &&
      !origin.startsWith("http://127.0.0.1") &&
      !origin.startsWith("http://localhost")
    ) {
      errors.push(`origin ${origin} is not allowed`);
    }
  }
  return errors;
}

export function verifyHmacSha256WebhookSignature(options: {
  body: string | Buffer;
  signature: string;
  secret: string;
  prefix?: string;
}): boolean {
  // Use only createHash so the public SDK remains bundlable for the Tier 2
  // sandbox example build (restricted crypto surface).
  const expected = hmacSha256Hex(options.secret, options.body);
  const provided = options.prefix
    ? options.signature.startsWith(options.prefix)
      ? options.signature.slice(options.prefix.length)
      : options.signature
    : options.signature;
  return constantTimeEqualHex(expected, provided);
}

function hmacSha256Hex(secret: string, body: string | Buffer): string {
  const key = Buffer.from(secret, "utf8");
  const block = Buffer.alloc(64);
  if (key.length > 64) {
    createHash("sha256").update(key).digest().copy(block);
  } else {
    key.copy(block);
  }
  const oKey = Buffer.alloc(64);
  const iKey = Buffer.alloc(64);
  for (let index = 0; index < 64; index += 1) {
    oKey[index] = block[index]! ^ 0x5c;
    iKey[index] = block[index]! ^ 0x36;
  }
  const inner = createHash("sha256").update(iKey).update(body).digest();
  return createHash("sha256").update(oKey).update(inner).digest("hex");
}

function constantTimeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function createSandboxExternalConnectorPlugin(options: {
  contributionId: string;
  handler: ExternalConnectorHandlerV1;
  limits?: ExternalConnectorLimitsV1;
}): {
  invoke: (
    invocation: { contributionId: string; operation: string; input: unknown },
    _host: unknown,
    context?: { credentials?: Record<string, string> },
  ) => Promise<unknown>;
  deactivate: () => Promise<void>;
} {
  const active = new Map<string, AbortController>();
  return {
    async invoke(invocation, _host, context) {
      if (invocation.contributionId !== options.contributionId) {
        throw new Error("contribution does not match external connector handler");
      }
      if (invocation.operation === "externalConnector.cancel") {
        const request = invocation.input as { requestId: string };
        active.get(request.requestId)?.abort();
        await options.handler.cancel({
          contractVersion: 1,
          requestId: request.requestId,
        });
        return {};
      }
      if (!invocation.operation.startsWith("externalConnector.")) {
        throw new Error("unsupported external connector sandbox operation");
      }
      const request = invocation.input as ExternalConnectorRequestV1;
      const controller = new AbortController();
      active.set(request.requestId, controller);
      const credentials = { ...(context?.credentials ?? {}) };
      try {
        return await dispatchExternalConnectorHandler(options.handler, request, {
          credentials,
          signal: controller.signal,
        });
      } finally {
        for (const key of Object.keys(credentials)) delete credentials[key];
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

export function startProcessExternalConnector(options: {
  manifest: PluginManifestV2;
  contributionId: string;
  handler: ExternalConnectorHandlerV1;
}): void {
  const normalized = normalizeManifest(options.manifest);
  const errors = validateNormalizedManifest(normalized);
  if (errors.length > 0) {
    throw new Error(`invalid plugin manifest: ${errors.join("; ")}`);
  }
  const contribution = normalized.contributions.find(
    (candidate) =>
      candidate.kind === "externalConnector" &&
      candidate.id === options.contributionId &&
      "contractVersion" in candidate &&
      candidate.contractVersion === 1,
  );
  if (!contribution) {
    throw new Error(
      `strict external connector ${options.contributionId} is not in the manifest`,
    );
  }
  const active = new Map<string, AbortController>();
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    void handleExternalConnectorProcessLine(line, options, active);
  });
}

async function handleExternalConnectorProcessLine(
  line: string,
  options: {
    manifest: PluginManifestV2;
    contributionId: string;
    handler: ExternalConnectorHandlerV1;
  },
  active: Map<string, AbortController>,
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let rpc: { id?: number | null; method?: string; params?: unknown };
  try {
    rpc = JSON.parse(trimmed) as {
      id?: number | null;
      method?: string;
      params?: unknown;
    };
  } catch {
    writeJson({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "parse error" },
    });
    return;
  }
  const id = typeof rpc.id === "number" ? rpc.id : null;
  try {
    if (rpc.method === "plugin.handshake") {
      if (id !== null) {
        writeJson({
          jsonrpc: "2.0",
          id,
          result: {
            apiVersion: HOST_API_VERSION,
            pluginId: options.manifest.id,
            contributions: options.manifest.contributions,
          },
        });
      }
      return;
    }
    if (rpc.method === "plugin.shutdown") {
      for (const controller of active.values()) controller.abort();
      active.clear();
      await options.handler.shutdown({ contractVersion: 1 });
      if (id !== null) writeJson({ jsonrpc: "2.0", id, result: {} });
      setTimeout(() => process.exit(0), 0).unref?.();
      return;
    }
    if (rpc.method === "externalConnector.cancel") {
      const params = rpc.params as { requestId: string };
      active.get(params.requestId)?.abort();
      await options.handler.cancel({
        contractVersion: 1,
        requestId: params.requestId,
      });
      if (id !== null) writeJson({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (!rpc.method?.startsWith("externalConnector.")) {
      throw new Error("unsupported external connector process method");
    }
    const params = rpc.params as {
      request: ExternalConnectorRequestV1;
      credentials?: Record<string, string>;
    };
    const request = params.request;
    const controller = new AbortController();
    active.set(request.requestId, controller);
    const credentials = { ...(params.credentials ?? {}) };
    try {
      const result = await dispatchExternalConnectorHandler(
        options.handler,
        request,
        { credentials, signal: controller.signal },
      );
      if (id !== null) writeJson({ jsonrpc: "2.0", id, result });
    } finally {
      for (const key of Object.keys(credentials)) delete credentials[key];
      active.delete(request.requestId);
    }
  } catch (error) {
    if (error instanceof ExternalConnectorHandlerError) {
      if (id !== null) {
        writeJson({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: error.failure.message,
            data: error.failure,
          },
        });
      }
      return;
    }
    if (id !== null) {
      writeJson({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "host failure",
        },
      });
    }
  }
}

async function dispatchExternalConnectorHandler(
  handler: ExternalConnectorHandlerV1,
  request: ExternalConnectorRequestV1,
  context: ExternalConnectorInvocationContextV1,
): Promise<ExternalConnectorResultV1> {
  switch (request.operation) {
    case "validateConfig":
      return handler.validateConfig(request, context);
    case "test":
      return handler.test(request, context);
    case "pull":
      if (!handler.pull) throw new Error("pull is not implemented");
      return handler.pull(request, context);
    case "push":
      if (!handler.push) throw new Error("push is not implemented");
      return handler.push(request, context);
    case "poll":
      if (!handler.poll) throw new Error("poll is not implemented");
      return handler.poll(request, context);
    case "webhook":
      if (!handler.webhook) throw new Error("webhook is not implemented");
      return handler.webhook(request, context);
    default:
      throw new Error("unsupported external connector operation");
  }
}

function writeJson(value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`);
}
