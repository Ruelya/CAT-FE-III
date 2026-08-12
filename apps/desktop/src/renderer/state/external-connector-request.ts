/**
 * Bounded public V1 request shape (mirrors @translunar/plugin-sdk type-only
 * contract without a renderer runtime dependency on the package).
 */
export type ConnectorOperation =
  "validateConfig" | "test" | "pull" | "push" | "poll" | "webhook";

export interface ExternalConnectorRequestHeaderV1 {
  contractVersion: 1;
  requestId: string;
  deadlineMs: number;
  binding: {
    profileId: string;
    contributionId: string;
    pluginId: string;
    versionId: string;
    activationRevision: number;
    contractVersion: 1;
    configSchemaVersion: 1;
    checkpointSchemaVersion: 1;
  };
  idempotencyKey?: string;
  expectedCheckpointRevision?: number;
  attempt?: number;
  config: Record<string, unknown>;
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
      payload: {
        streamId: string;
        items: unknown[];
      };
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

export interface ConnectorBindingInput {
  profileId: string;
  contributionId: string;
  pluginId: string;
  versionId: string;
  activationRevision: number;
  configSchemaVersion: number;
  checkpointSchemaVersion: number;
  configuration: Record<string, unknown>;
}

export interface ConnectorFormInput {
  operation: ConnectorOperation;
  requestId: string;
  deadlineMs: number;
  idempotencyKey?: string;
  expectedCheckpointRevision?: number;
  streamId?: string;
  cursor?: string;
  limit?: number;
  sourceLocale?: string;
  targetLocale?: string;
  itemsJson?: string;
  eventId?: string;
  eventType?: string;
  bodyJson?: string;
  headersJson?: string;
  signature?: string;
}

export type BuildRequestResult =
  | { ok: true; request: ExternalConnectorRequestV1 }
  | { ok: false; error: string };

const MAX_ITEMS = 256;
const MAX_DEADLINE = 120_000;

export function parseBoundedJson(
  raw: string,
  label: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: `${label} is required` };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, error: `${label} is not valid JSON` };
  }
}

export function buildExternalConnectorRequest(
  binding: ConnectorBindingInput,
  form: ConnectorFormInput,
  declaredOperations: readonly string[],
): BuildRequestResult {
  if (!declaredOperations.includes(form.operation)) {
    return { ok: false, error: `Operation ${form.operation} is not declared` };
  }
  if (form.requestId.trim().length === 0) {
    return { ok: false, error: "requestId is required" };
  }
  if (
    !Number.isFinite(form.deadlineMs) ||
    form.deadlineMs <= 0 ||
    form.deadlineMs > MAX_DEADLINE
  ) {
    return { ok: false, error: "deadlineMs is out of range" };
  }

  const header = {
    contractVersion: 1 as const,
    requestId: form.requestId.trim(),
    deadlineMs: form.deadlineMs,
    binding: {
      profileId: binding.profileId,
      contributionId: binding.contributionId,
      pluginId: binding.pluginId,
      versionId: binding.versionId,
      activationRevision: binding.activationRevision,
      contractVersion: 1 as const,
      configSchemaVersion: 1 as const,
      checkpointSchemaVersion: 1 as const,
    },
    ...(form.idempotencyKey ? { idempotencyKey: form.idempotencyKey } : {}),
    ...(typeof form.expectedCheckpointRevision === "number"
      ? { expectedCheckpointRevision: form.expectedCheckpointRevision }
      : {}),
    config: binding.configuration,
  };

  switch (form.operation) {
    case "validateConfig":
      return { ok: true, request: { operation: "validateConfig", ...header } };
    case "test":
      return { ok: true, request: { operation: "test", ...header } };
    case "pull": {
      const streamId = form.streamId?.trim() ?? "";
      if (!streamId) return { ok: false, error: "streamId is required" };
      const limit = form.limit ?? 25;
      if (!Number.isFinite(limit) || limit < 1 || limit > MAX_ITEMS) {
        return { ok: false, error: "limit is out of range" };
      }
      return {
        ok: true,
        request: {
          operation: "pull",
          ...header,
          payload: {
            streamId,
            limit,
            ...(form.cursor ? { cursor: form.cursor } : {}),
            ...(form.sourceLocale ? { sourceLocale: form.sourceLocale } : {}),
            ...(form.targetLocale ? { targetLocale: form.targetLocale } : {}),
          },
        },
      };
    }
    case "poll": {
      const streamId = form.streamId?.trim() ?? "";
      if (!streamId) return { ok: false, error: "streamId is required" };
      const limit = form.limit ?? 25;
      if (!Number.isFinite(limit) || limit < 1 || limit > MAX_ITEMS) {
        return { ok: false, error: "limit is out of range" };
      }
      return {
        ok: true,
        request: {
          operation: "poll",
          ...header,
          payload: {
            streamId,
            limit,
            ...(form.cursor ? { cursor: form.cursor } : {}),
          },
        },
      };
    }
    case "push": {
      const streamId = form.streamId?.trim() ?? "";
      if (!streamId) return { ok: false, error: "streamId is required" };
      const parsed = parseBoundedJson(form.itemsJson ?? "", "items");
      if (!parsed.ok) return parsed;
      if (!Array.isArray(parsed.value)) {
        return { ok: false, error: "items must be a JSON array" };
      }
      if (parsed.value.length > MAX_ITEMS) {
        return { ok: false, error: "items exceed limit" };
      }
      return {
        ok: true,
        request: {
          operation: "push",
          ...header,
          payload: {
            streamId,
            items: parsed.value as unknown[],
          },
        },
      };
    }
    case "webhook": {
      const streamId = form.streamId?.trim() ?? "";
      const eventId = form.eventId?.trim() ?? "";
      const eventType = form.eventType?.trim() ?? "";
      if (!streamId) return { ok: false, error: "streamId is required" };
      if (!eventId) return { ok: false, error: "eventId is required" };
      if (!eventType) return { ok: false, error: "eventType is required" };
      const body = parseBoundedJson(form.bodyJson ?? "null", "body");
      if (!body.ok) return body;
      let headers: Record<string, string> | undefined;
      if (form.headersJson && form.headersJson.trim().length > 0) {
        const headersParsed = parseBoundedJson(form.headersJson, "headers");
        if (!headersParsed.ok) return headersParsed;
        if (
          typeof headersParsed.value !== "object" ||
          headersParsed.value === null ||
          Array.isArray(headersParsed.value)
        ) {
          return { ok: false, error: "headers must be a JSON object" };
        }
        headers = headersParsed.value as Record<string, string>;
      }
      return {
        ok: true,
        request: {
          operation: "webhook",
          ...header,
          payload: {
            streamId,
            eventId,
            eventType,
            body: body.value,
            ...(headers ? { headers } : {}),
            ...(form.signature ? { signature: form.signature } : {}),
          },
        },
      };
    }
    default:
      return { ok: false, error: "Undeclared operation" };
  }
}

/** Preserve unknown config keys; overlay supported field values. */
export function mergeUnknownConfig(
  existing: unknown,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  return { ...base, ...overlay };
}

export function safeJsonPreview(value: unknown, maxLen = 4000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}…`;
  } catch {
    return String(value);
  }
}
