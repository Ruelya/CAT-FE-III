#!/usr/bin/env node

// src/qa-pipeline.ts
var PUBLIC_CONTRIBUTION_LIMITS = Object.freeze({
  descriptorBytes: 64 * 1024,
  configBytes: 64 * 1024,
  checkpointBytes: 1024 * 1024,
  invocationBytes: 4 * 1024 * 1024,
  resultBytes: 8 * 1024 * 1024,
  jsonDepth: 16,
  jsonNodes: 65536,
  collectionItems: 4096,
  textBytes: 1024 * 1024,
  qaFindings: 1024,
  qaMessageBytes: 2048,
  qaEvidenceItems: 128,
  qaEvidenceTextBytes: 4096,
  qaRelatedSegments: 128,
  usageUnits: 1e9,
  deadlineMs: 12e4,
});
var qaCategories = /* @__PURE__ */ new Set([
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
var qaSeverities = /* @__PURE__ */ new Set(["error", "warning", "info"]);
var artifactKinds = /* @__PURE__ */ new Set([
  "none",
  "project",
  "document",
  "segments",
  "qaFindings",
  "json",
]);
function utf8Bytes(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 127) {
      bytes += 1;
    } else if (codeUnit <= 2047) {
      bytes += 2;
    } else if (
      codeUnit >= 55296 &&
      codeUnit <= 56319 &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 56320 && next <= 57343) {
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
function jsonBytes(value) {
  try {
    return utf8Bytes(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function strictObject(value, keys, label, errors) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    errors.push(`${label} must be a plain object`);
    return void 0;
  }
  const record = value;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key))
      errors.push(`${label} contains unknown field ${key}`);
  }
  return record;
}
function boundaryString(value, label, maxBytes, errors) {
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
function boundaryId(value, label, errors) {
  if (!boundaryString(value, label, 128, errors)) return false;
  if (!/^[A-Za-z0-9._:-]+$/u.test(value)) {
    errors.push(`${label} contains unsupported characters`);
    return false;
  }
  return true;
}
function boundedInteger(value, min, max, label, errors) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${label} must be an integer between ${min} and ${max}`);
    return false;
  }
  return true;
}
function validatePublicJson(
  value,
  maxBytes = PUBLIC_CONTRIBUTION_LIMITS.resultBytes,
) {
  let nodes = 0;
  const stack = /* @__PURE__ */ new Set();
  const walk = (candidate, depth) => {
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
      const valid2 =
        candidate.length <= PUBLIC_CONTRIBUTION_LIMITS.collectionItems &&
        candidate.every((item) => walk(item, depth + 1));
      stack.delete(candidate);
      return valid2;
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
function validatePublicConfigSchema(value) {
  const errors = [];
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
  const keys = /* @__PURE__ */ new Set();
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
    if (field.min !== void 0 && !Number.isSafeInteger(field.min))
      errors.push(`config field ${index} min must be an integer`);
    if (field.max !== void 0 && !Number.isSafeInteger(field.max))
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
      const optionValues = /* @__PURE__ */ new Set();
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
      field.defaultValue !== void 0 &&
      !validatePublicJson(
        field.defaultValue,
        PUBLIC_CONTRIBUTION_LIMITS.configBytes,
      )
    ) {
      errors.push(`config field ${index} defaultValue is invalid`);
    } else if (
      field.defaultValue !== void 0 &&
      !configFieldAccepts(field, field.defaultValue)
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
function configFieldAccepts(field, value) {
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
        (field.min === void 0 || value >= field.min) &&
        (field.max === void 0 || value <= field.max)
      );
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === void 0 || value >= field.min) &&
        (field.max === void 0 || value <= field.max)
      );
    case "json":
      return validatePublicJson(value, PUBLIC_CONTRIBUTION_LIMITS.configBytes);
  }
}
function validatePublicConfig(value, schema) {
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
    if (candidate === void 0) {
      if (field.required && field.defaultValue === void 0)
        errors.push(`config is missing required field ${field.key}`);
    } else if (!configFieldAccepts(field, candidate)) {
      errors.push(`config field ${field.key} has an invalid value`);
    }
  }
  return errors;
}
function validateQaRuleDescriptor(value) {
  const errors = [];
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
  if (descriptor.config !== void 0 && descriptor.configSchema)
    errors.push(
      ...validatePublicConfig(descriptor.config, descriptor.configSchema),
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
function validatePipelineStepDescriptor(value) {
  const errors = [];
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
      : descriptor.checkpointSchemaVersion !== void 0
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

// src/ai-ui.ts
var AI_ACTION_LIMITS = Object.freeze({
  inputBytes: 1024 * 1024,
  outputBytes: 1024 * 1024,
  tags: 1024,
  deadlineMs: 12e4,
  methods: 16,
});

// src/external-connector.ts
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createHash } from "node:crypto";
var EXTERNAL_CONNECTOR_LIMITS = Object.freeze({
  configBytes: 64 * 1024,
  items: 256,
  itemTextBytes: 256 * 1024,
  metadataEntries: 32,
  checkpointBytes: 64 * 1024,
  deadlineMs: 12e4,
  requestBytes: 256 * 1024,
  responseBytes: 1024 * 1024,
  requestIdBytes: 128,
  credentialBytes: 16 * 1024,
});
var ExternalConnectorHandlerError = class extends Error {
  failure;
  constructor(failure) {
    super(failure.message);
    this.name = "ExternalConnectorHandlerError";
    this.failure = failure;
  }
};
function verifyHmacSha256WebhookSignature(options) {
  const expected = hmacSha256Hex(options.secret, options.body);
  const provided = options.prefix
    ? options.signature.startsWith(options.prefix)
      ? options.signature.slice(options.prefix.length)
      : options.signature
    : options.signature;
  return constantTimeEqualHex(expected, provided);
}
function hmacSha256Hex(secret, body) {
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
    oKey[index] = block[index] ^ 92;
    iKey[index] = block[index] ^ 54;
  }
  const inner = createHash("sha256").update(iKey).update(body).digest();
  return createHash("sha256").update(oKey).update(inner).digest("hex");
}
function constantTimeEqualHex(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
function startProcessExternalConnector(options) {
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
  const active = /* @__PURE__ */ new Map();
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    void handleExternalConnectorProcessLine(line, options, active);
  });
}
async function handleExternalConnectorProcessLine(line, options, active) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let rpc;
  try {
    rpc = JSON.parse(trimmed);
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
      for (const controller2 of active.values()) controller2.abort();
      active.clear();
      await options.handler.shutdown({ contractVersion: 1 });
      if (id !== null) writeJson({ jsonrpc: "2.0", id, result: {} });
      setTimeout(() => process.exit(0), 0).unref?.();
      return;
    }
    if (rpc.method === "externalConnector.cancel") {
      const params2 = rpc.params;
      active.get(params2.requestId)?.abort();
      await options.handler.cancel({
        contractVersion: 1,
        requestId: params2.requestId,
      });
      if (id !== null) writeJson({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (!rpc.method?.startsWith("externalConnector.")) {
      throw new Error("unsupported external connector process method");
    }
    const params = rpc.params;
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
            code: -32e3,
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
          code: -32e3,
          message: error instanceof Error ? error.message : "host failure",
        },
      });
    }
  }
}
async function dispatchExternalConnectorHandler(handler2, request, context) {
  switch (request.operation) {
    case "validateConfig":
      return handler2.validateConfig(request, context);
    case "test":
      return handler2.test(request, context);
    case "pull":
      if (!handler2.pull) throw new Error("pull is not implemented");
      return handler2.pull(request, context);
    case "push":
      if (!handler2.push) throw new Error("push is not implemented");
      return handler2.push(request, context);
    case "poll":
      if (!handler2.poll) throw new Error("poll is not implemented");
      return handler2.poll(request, context);
    case "webhook":
      if (!handler2.webhook) throw new Error("webhook is not implemented");
      return handler2.webhook(request, context);
    default:
      throw new Error("unsupported external connector operation");
  }
}
function writeJson(value) {
  output.write(`${JSON.stringify(value)}
`);
}

// src/index.ts
var HOST_API_VERSION = 1;
var NORMALIZED_MANIFEST_VERSION = 1;
var RUNTIME_DESCRIPTOR_VERSION = 1;
var CONTRIBUTION_DESCRIPTOR_VERSION = 1;
var PROCESS_PROTOCOL_VERSION = 1;
var DECLARATIVE_DEFINITION_VERSION = 1;
var SANDBOX_BRIDGE_VERSION = 1;
var ENGINE_CONNECTOR_CONTRACT_VERSION = 1;
var ENGINE_CONNECTOR_PROTOCOL_V1 = "translunar.engineConnector.v1";
var ENGINE_CONNECTOR_CONFIG_SCHEMA_VERSION2 = 1;
var MAX_ENGINE_CONNECTOR_CREDENTIAL_BYTES = 16 * 1024;
var ENGINE_CONNECTOR_LIMITS = Object.freeze({
  configBytes: 64 * 1024,
  configFields: 64,
  configKeyBytes: 64,
  configValueBytes: 4 * 1024,
  messages: 128,
  messageBytes: 64 * 1024,
  sourceTextBytes: 1024 * 1024,
  outputBytes: 4 * 1024 * 1024,
  events: 8192,
  models: 256,
  modelIdBytes: 256,
  deadlineMs: 12e4,
  requestIdBytes: 128,
  localeBytes: 64,
  errorMessageBytes: 1024,
  endpointBytes: 2048,
  headers: 32,
  headerNameBytes: 128,
  headerValueBytes: 1024,
  jsonPathDepth: 16,
  jsonPathSegmentBytes: 128,
});
var SANDBOX_LIMITS = Object.freeze({
  heapBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  initializationMs: 1e3,
  invocationMs: 2e3,
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
});
var PLUGIN_CAPABILITY_IDS = [
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
];
var ENGINE_CONNECTOR_OPERATIONS_V1 = [
  "validateConfig",
  "test",
  "models.list",
  "generate",
];
function validateEngineConnectorDescriptor(value, tier) {
  const errors = [];
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
    typeof descriptor.id === "string" ? descriptor.id : void 0,
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
    descriptor.configSchemaVersion < 1
  ) {
    errors.push("connector configSchemaVersion must be a positive integer");
  }
  validateConnectorOperations(descriptor.operations, errors);
  validateConnectorConfigSchema(descriptor.configSchema, errors);
  validateConnectorLimits(descriptor.limits, errors);
  if (descriptor.declarative !== void 0) {
    validateDeclarativeConnectorDefinition(descriptor.declarative, errors);
  }
  if (tier === "declarative" && descriptor.declarative === void 0) {
    errors.push("declarative connector requires a typed definition");
  }
  if (tier !== void 0 && tier !== "declarative" && descriptor.declarative) {
    errors.push(
      "executable connector tiers cannot include a declarative definition",
    );
  }
  return errors;
}
function validateConnectorOperations(value, errors) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    errors.push("connector operations must contain between 1 and 4 items");
    return;
  }
  const seen = /* @__PURE__ */ new Set();
  for (const operation of value) {
    if (!isConnectorOperation(operation)) {
      errors.push(`unsupported connector operation ${String(operation)}`);
    } else if (seen.has(operation)) {
      errors.push("connector operations must not contain duplicates");
    } else {
      seen.add(operation);
    }
  }
  for (const required of ["validateConfig", "test", "generate"]) {
    if (!seen.has(required)) {
      errors.push(`connector operations must include ${required}`);
    }
  }
}
function validateConnectorConfigSchema(value, errors) {
  const schema = strictRecord(
    value,
    ["schemaVersion", "fields"],
    "connector configSchema",
    errors,
  );
  if (!schema) return;
  if (schema.schemaVersion !== ENGINE_CONNECTOR_CONFIG_SCHEMA_VERSION2) {
    errors.push("connector config schemaVersion must be 1");
  }
  if (
    !Array.isArray(schema.fields) ||
    schema.fields.length > ENGINE_CONNECTOR_LIMITS.configFields
  ) {
    errors.push("connector config schema has too many fields");
    return;
  }
  const keys = /* @__PURE__ */ new Set();
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
    if (field.description !== void 0) {
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
    if (defaultValue !== void 0 && !isConnectorConfigValue(defaultValue)) {
      errors.push(`connector config field ${index} defaultValue is invalid`);
    }
    if (
      typeof defaultValue === "string" &&
      utf8Bytes2(defaultValue) > ENGINE_CONNECTOR_LIMITS.configValueBytes
    ) {
      errors.push(`connector config field ${index} defaultValue is oversized`);
    }
    if (field.fieldType === "integer") {
      if (field.min !== void 0 && !Number.isSafeInteger(field.min)) {
        errors.push(`connector config field ${index} min must be an integer`);
      }
      if (field.max !== void 0 && !Number.isSafeInteger(field.max)) {
        errors.push(`connector config field ${index} max must be an integer`);
      }
      if (
        typeof field.min === "number" &&
        typeof field.max === "number" &&
        field.min > field.max
      ) {
        errors.push(`connector config field ${index} min must not exceed max`);
      }
      if (defaultValue !== void 0 && !Number.isSafeInteger(defaultValue)) {
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
      if (field.options !== void 0 && !isEmptyArray(field.options)) {
        errors.push(`connector config field ${index} cannot have options`);
      }
    } else {
      if (field.min !== void 0 || field.max !== void 0) {
        errors.push(
          `connector config field ${index} cannot have numeric bounds`,
        );
      }
      if (
        (field.fieldType === "text" &&
          defaultValue !== void 0 &&
          typeof defaultValue !== "string") ||
        (field.fieldType === "boolean" &&
          defaultValue !== void 0 &&
          typeof defaultValue !== "boolean")
      ) {
        errors.push(
          `connector config field ${index} defaultValue has the wrong type`,
        );
      }
      if (field.fieldType === "select") {
        validateConfigOptions(field.options, defaultValue, index, errors);
      } else if (field.options !== void 0 && !isEmptyArray(field.options)) {
        errors.push(`connector config field ${index} cannot have options`);
      }
    }
  }
}
function validateConfigOptions(rawOptions, defaultValue, fieldIndex, errors) {
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
  const values = /* @__PURE__ */ new Set();
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
    defaultValue !== void 0 &&
    (typeof defaultValue !== "string" || !values.has(defaultValue))
  ) {
    errors.push(
      `select connector config field ${fieldIndex} defaultValue must name an option`,
    );
  }
}
function validateConnectorLimits(value, errors) {
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
  const maxima = {
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
function validateDeclarativeConnectorDefinition(value, errors) {
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
    } else if (authentication.name !== void 0) {
      errors.push("only header authentication can name a header");
    }
  }
  validateDeclarativeRequestMapping(definition.request, errors);
  validateDeclarativeResponseMapping(definition.response, errors);
  validateDeclarativeFailureMappings(definition.failures ?? [], errors);
}
function validateDeclarativeEndpoint(value, errors) {
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
    let parsed;
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
function validateDeclarativeHeaders(value, errors) {
  if (!Array.isArray(value) || value.length > ENGINE_CONNECTOR_LIMITS.headers) {
    errors.push("declarative connector has too many fixed headers");
    return;
  }
  const names = /* @__PURE__ */ new Set();
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
function validateDeclarativeRequestMapping(value, errors) {
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
  if (mapping.fixedBody !== void 0) {
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
  ]) {
    if (mapping[key] !== void 0) validateJsonPath(mapping[key], key, errors);
  }
}
function validateDeclarativeResponseMapping(value, errors) {
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
  if (value.finishReasonPath !== void 0) {
    validateJsonPath(value.finishReasonPath, "finishReasonPath", errors);
  }
  if (value.usage !== void 0) validateUsageMapping(value.usage, errors);
}
function validateUsageMapping(value, errors) {
  const mapping = strictRecord(
    value,
    ["inputTokensPath", "outputTokensPath", "totalTokensPath"],
    "connector usage mapping",
    errors,
  );
  if (!mapping) return;
  const keys = ["inputTokensPath", "outputTokensPath", "totalTokensPath"];
  if (keys.every((key) => mapping[key] === void 0)) {
    errors.push("connector usage mapping must define at least one path");
  }
  for (const key of keys) {
    if (mapping[key] !== void 0) validateJsonPath(mapping[key], key, errors);
  }
}
function validateDeclarativeFailureMappings(value, errors) {
  if (!Array.isArray(value) || value.length > 64) {
    errors.push("declarative connector has too many failure mappings");
    return;
  }
  const statuses = /* @__PURE__ */ new Set();
  const codes = [
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
    if (!codes.includes(mapping.code)) {
      errors.push("connector failure mapping code is unsupported");
    }
    if (typeof mapping.retryable !== "boolean") {
      errors.push("connector failure mapping retryable must be boolean");
    }
  }
}
function validateJsonPath(value, label, errors) {
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
      utf8Bytes2(segment) > ENGINE_CONNECTOR_LIMITS.jsonPathSegmentBytes
    ) {
      errors.push(`${label} contains a malformed JSON path segment`);
    }
  }
}
function validateHeaderName(value, authenticationHeader, errors) {
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
function validateConfigKey(value, label, errors) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._-]+$/u.test(value) ||
    utf8Bytes2(value) > ENGINE_CONNECTOR_LIMITS.configKeyBytes
  ) {
    errors.push(`${label} is malformed or oversized`);
  }
}
function isConnectorConfigValue(value) {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}
function isConnectorOperation(value) {
  return ENGINE_CONNECTOR_OPERATIONS_V1.includes(value);
}
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function strictRecord(value, allowedKeys, label, errors) {
  if (!isPlainRecord(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  rejectUnknownKeys(value, allowedKeys, label, errors);
  return value;
}
function rejectUnknownKeys(value, allowedKeys, label, errors) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      errors.push(`${label} contains unknown field ${key}`);
  }
}
function boundedString(value, minBytes, maxBytes, label, errors) {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    utf8Bytes2(value) < minBytes ||
    utf8Bytes2(value) > maxBytes
  ) {
    errors.push(
      `${label} must contain between ${minBytes} and ${maxBytes} UTF-8 bytes`,
    );
  }
}
function integerRange(value, min, max, label, errors) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${label} must be an integer between ${min} and ${max}`);
  }
}
function utf8Bytes2(value) {
  return new TextEncoder().encode(value).length;
}
function isEmptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}
function validateSandboxJsonValue(
  value,
  maxBytes = SANDBOX_LIMITS.invocationJsonBytes,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return false;
  const seen = /* @__PURE__ */ new Set();
  const visit = (candidate, depth) => {
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
function normalizeManifest(manifest2) {
  if (manifest2.manifestVersion === 1) {
    return {
      normalizedVersion: NORMALIZED_MANIFEST_VERSION,
      sourceManifestVersion: 1,
      id: manifest2.id,
      displayName: manifest2.displayName,
      version: manifest2.version,
      hostApi: { min: manifest2.apiVersionMin, max: manifest2.apiVersion },
      runtime: {
        tier: "process",
        runtimeVersion: RUNTIME_DESCRIPTOR_VERSION,
        protocolVersion: PROCESS_PROTOCOL_VERSION,
        entry: manifest2.entry,
      },
      contributions: manifest2.contributions.filters.map((filter) => ({
        kind: "filter",
        descriptorVersion: CONTRIBUTION_DESCRIPTOR_VERSION,
        ...filter,
      })),
      requestedPermissions: [...(manifest2.permissions ?? [])],
      requestedCapabilities: normalizeCapabilityRequests(
        manifest2.permissions ?? [],
        manifest2.capabilities ?? [],
      ),
      originalManifestJson: manifest2,
    };
  }
  return {
    normalizedVersion: NORMALIZED_MANIFEST_VERSION,
    sourceManifestVersion: 2,
    id: manifest2.id,
    displayName: manifest2.displayName,
    version: manifest2.version,
    hostApi: { ...manifest2.hostApi },
    runtime: manifest2.runtime,
    contributions: [...manifest2.contributions],
    requestedPermissions: [...(manifest2.permissions ?? [])],
    requestedCapabilities: normalizeCapabilityRequests(
      manifest2.permissions ?? [],
      manifest2.capabilities ?? [],
    ),
    originalManifestJson: manifest2,
  };
}
function validateNormalizedManifest(manifest2) {
  const errors = [];
  if (manifest2.normalizedVersion !== NORMALIZED_MANIFEST_VERSION) {
    errors.push("normalizedVersion must be 1");
  }
  validateId(manifest2.id, "id", errors);
  if (manifest2.id?.startsWith("builtin.")) {
    errors.push("id must not use builtin. prefix");
  }
  if (!manifest2.displayName?.trim()) errors.push("displayName is required");
  if (!manifest2.version?.trim()) errors.push("version is required");
  if (
    !Number.isInteger(manifest2.hostApi.min) ||
    !Number.isInteger(manifest2.hostApi.max)
  ) {
    errors.push("hostApi range must contain integers");
  } else if (manifest2.hostApi.min > manifest2.hostApi.max) {
    errors.push("hostApi.min must be <= hostApi.max");
  } else if (
    HOST_API_VERSION < manifest2.hostApi.min ||
    HOST_API_VERSION > manifest2.hostApi.max
  ) {
    errors.push("host API is outside plugin range");
  }
  const runtime = manifest2.runtime;
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
  if (manifest2.contributions.length === 0) {
    errors.push("at least one contribution is required");
  }
  const seen = /* @__PURE__ */ new Set();
  for (const contribution of manifest2.contributions) {
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
      contribution.contractVersion !== void 0
    ) {
      errors.push(
        ...validateEngineConnectorDescriptor(contribution, runtime.tier),
      );
    }
    if (
      contribution.kind === "qaRule" &&
      contribution.operationProtocolVersion !== void 0
    ) {
      errors.push(...validateQaRuleDescriptor(contribution));
    }
    if (
      contribution.kind === "pipelineStep" &&
      contribution.operationProtocolVersion !== void 0
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
  for (const permission of manifest2.requestedPermissions ?? []) {
    if (!isSupportedPermission(permission)) {
      errors.push(`unsupported permission ${permission}`);
    }
  }
  validateCapabilityRequests(manifest2.requestedCapabilities ?? [], errors);
  return errors;
}
function isRelativePackagePath(value) {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes("\0") &&
    !value.includes("..") &&
    !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)
  );
}
function validateDeclarativeContribution(contribution, errors) {
  if (contribution.kind === "engineConnector") {
    if (contribution.contractVersion === void 0) {
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
    if (definition.probeHeaderPattern !== void 0) {
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
    validateIntegerRange(limits.maxUnits, 1, 1e5, "maxUnits", errors);
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
      4096,
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
    const ids = /* @__PURE__ */ new Set();
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
          1e5,
          "maxReplacements",
          errors,
        );
      }
    }
    return;
  }
  errors.push(`${contribution.kind} is not executable by the declarative host`);
}
function validatePattern(pattern, label, errors) {
  if (pattern.length < 1 || new TextEncoder().encode(pattern).length > 4096) {
    errors.push(`${label} must contain between 1 and 4096 bytes`);
  }
}
function validateIntegerRange(value, min, max, label, errors) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${label} must be an integer between ${min} and ${max}`);
  }
}
function isContributionAllowed(tier, kind) {
  if (tier === "sandbox") return true;
  if (tier === "process") return kind !== "uiPanel";
  return (
    kind === "filter" ||
    kind === "qaRule" ||
    kind === "pipelineStep" ||
    kind === "engineConnector"
  );
}
function isSupportedPermission(permission) {
  try {
    parseLegacyPermission(permission);
    return true;
  } catch {
    return false;
  }
}
var MAX_CAPABILITY_REQUESTS = 64;
var MAX_SCOPE_ITEMS = 64;
var MAX_SCOPE_TEXT = 512;
function parseLegacyPermission(permission) {
  const scoped = (capabilityId, scope) => ({
    capabilityId,
    required: true,
    scope,
  });
  if (permission === "file.read:source") {
    return scoped("file.read", { kind: "file", areas: ["source"] });
  }
  if (permission === "file.write:output") {
    return scoped("file.write", { kind: "file", areas: ["output"] });
  }
  const mappings = [
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
function normalizeCapabilityScope(scope) {
  const strings = (values, label) => {
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
function normalizeCapabilityRequest(request) {
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
  if (request.contributionId !== void 0) {
    const errors = [];
    validateId(request.contributionId, "capability contribution id", errors);
    if (errors.length > 0) throw new Error(errors[0]);
  }
  return {
    capabilityId: request.capabilityId,
    required,
    scope,
    ...(request.contributionId === void 0
      ? {}
      : { contributionId: request.contributionId }),
  };
}
function normalizeCapabilityRequests(legacyPermissions, typedRequests) {
  if (
    legacyPermissions.length + typedRequests.length >
    MAX_CAPABILITY_REQUESTS
  ) {
    throw new Error("too many requested capabilities");
  }
  const bySemanticKey = /* @__PURE__ */ new Map();
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
function validateCapabilityRequests(requests, errors) {
  try {
    normalizeCapabilityRequests([], requests);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}
function isValidScopeText(value) {
  return (
    value.length > 0 &&
    value.length <= MAX_SCOPE_TEXT &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function isValidCapabilityId(value) {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}
function isKnownPluginCapabilityId(capabilityId) {
  return PLUGIN_CAPABILITY_IDS.some((candidate) => candidate === capabilityId);
}
function scopeMatchesCapability(capabilityId, scope) {
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
function validateId(value, label, errors) {
  if (!value || value.trim() !== value) {
    errors.push(`${label} must be non-empty without surrounding whitespace`);
  } else if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    errors.push(`${label} contains unsupported characters`);
  }
}

// ../../examples/plugins/external-connector-fixture/manifest.json
var manifest_default = {
  manifestVersion: 2,
  id: "example.external-connector-fixture",
  displayName: "External connector fixture",
  version: "1.0.0",
  hostApi: { min: 1, max: 1 },
  runtime: {
    tier: "process",
    runtimeVersion: 1,
    protocolVersion: 1,
    entry: { kind: "node", path: "bin/external-connector-fixture.mjs" },
  },
  contributions: [
    {
      kind: "externalConnector",
      descriptorVersion: 1,
      id: "example.external-connector-fixture.system",
      version: "1.0.0",
      displayName: "Fixture external system",
      transports: ["http"],
      checkpointVersion: 1,
      capabilities: {
        pull: true,
        push: true,
        poll: true,
        webhook: true,
      },
      protocol: "translunar.externalConnector.v1",
      contractVersion: 1,
      configSchemaVersion: 1,
      checkpointSchemaVersion: 1,
      operations: ["validateConfig", "test", "pull", "push", "poll", "webhook"],
      origins: ["http://127.0.0.1:43124"],
      credentialSlots: [
        {
          id: "apiToken",
          label: "API token",
          required: true,
          operations: ["test", "pull", "push", "poll", "webhook"],
        },
      ],
      configSchema: {
        schemaVersion: 1,
        fields: [
          {
            key: "scenario",
            label: "Scenario",
            fieldType: "text",
            required: false,
            defaultValue: "success",
          },
        ],
      },
      limits: {
        maxConfigBytes: 65536,
        maxItems: 256,
        maxItemTextBytes: 262144,
        maxMetadataEntries: 32,
        maxCheckpointBytes: 65536,
        maxDeadlineMs: 12e4,
        maxRequestBytes: 262144,
        maxResponseBytes: 1048576,
      },
    },
  ],
  permissions: [],
  capabilities: [
    {
      capabilityId: "external.connector",
      required: true,
      contributionId: "example.external-connector-fixture.system",
      scope: {
        kind: "operations",
        operations: [
          "validateConfig",
          "test",
          "pull",
          "push",
          "poll",
          "webhook",
        ],
      },
    },
    {
      capabilityId: "network.connect",
      required: true,
      contributionId: "example.external-connector-fixture.system",
      scope: {
        kind: "network",
        origins: ["http://127.0.0.1:43124"],
      },
    },
  ],
};

// ../../examples/plugins/external-connector-fixture/src/index.ts
var CONTRIBUTION_ID = "example.external-connector-fixture.system";
var FIXTURE_SECRET = "fixture-token-not-for-production";
var manifest = manifest_default;
function scenarioOf(request) {
  const value = request.config.scenario;
  return typeof value === "string" ? value : "success";
}
function requireToken(context) {
  const token = context.credentials.apiToken;
  if (!token || token !== FIXTURE_SECRET) {
    throw new ExternalConnectorHandlerError({
      contractVersion: 1,
      requestId: "unknown",
      code: "authentication",
      message: "authentication failed",
      retryable: false,
    });
  }
}
function requireWebhookSignature(request, context) {
  const secret = context.credentials.apiToken;
  const signature = request.payload.signature;
  if (
    !secret ||
    !signature ||
    !verifyHmacSha256WebhookSignature({
      body: JSON.stringify(request.payload.body),
      signature,
      secret,
      prefix: "sha256=",
    })
  ) {
    throw new ExternalConnectorHandlerError({
      contractVersion: 1,
      requestId: request.requestId,
      code: "authentication",
      message: "webhook signature verification failed",
      retryable: false,
    });
  }
}
var handler = {
  async validateConfig(request) {
    return {
      operation: "validateConfig",
      valid: true,
      issues: [],
    };
  },
  async test(request, context) {
    const scenario = scenarioOf(request);
    if (scenario === "auth") {
      throw new ExternalConnectorHandlerError({
        contractVersion: 1,
        requestId: request.requestId,
        code: "authentication",
        message: "authentication failed",
        retryable: false,
      });
    }
    requireToken(context);
    return {
      operation: "test",
      ok: true,
      latencyMs: 1,
      message: "ok",
    };
  },
  async pull(request, context) {
    requireToken(context);
    const scenario = scenarioOf(request);
    if (scenario === "rate") {
      throw new ExternalConnectorHandlerError({
        contractVersion: 1,
        requestId: request.requestId,
        code: "rateLimit",
        message: "rate limited",
        retryable: true,
        retryAfterMs: 1e3,
      });
    }
    const items =
      scenario === "empty"
        ? []
        : [
            {
              externalId: "item-1",
              externalRevision: "1",
              sourceLocale: "en",
              targetLocale: "zh",
              sourceText: "hello",
              targetText: "\u4F60\u597D",
            },
          ];
    return {
      operation: "pull",
      items,
      hasMore: scenario === "page",
      nextCursor: scenario === "page" ? "cursor-2" : void 0,
      checkpoint: {
        streamId: request.payload.streamId,
        schemaVersion: 1,
        payload: { cursor: request.payload.cursor ?? "c1" },
        cursor: request.payload.cursor ?? "c1",
      },
    };
  },
  async push(request, context) {
    requireToken(context);
    return {
      operation: "push",
      receipts: request.payload.items.map((item) => ({
        externalId: item.externalId,
        accepted: true,
        remoteRevision: "r1",
      })),
      checkpoint: {
        streamId: request.payload.streamId,
        schemaVersion: 1,
        payload: { pushed: request.payload.items.length },
      },
    };
  },
  async poll(request, context) {
    requireToken(context);
    return {
      operation: "poll",
      items:
        scenarioOf(request) === "empty"
          ? []
          : [
              {
                externalId: "poll-1",
                sourceLocale: "en",
                targetLocale: "zh",
                sourceText: "polled",
              },
            ],
      hasMore: false,
      checkpoint: {
        streamId: request.payload.streamId,
        schemaVersion: 1,
        payload: { polled: true },
        cursor: "poll-c1",
      },
    };
  },
  async webhook(request, context) {
    requireToken(context);
    requireWebhookSignature(request, context);
    return {
      operation: "webhook",
      items: [
        {
          externalId: request.payload.eventId,
          sourceLocale: "en",
          targetLocale: "zh",
          sourceText: "webhook",
        },
      ],
      hasMore: false,
      checkpoint: {
        streamId: request.payload.streamId,
        schemaVersion: 1,
        payload: { eventId: request.payload.eventId },
      },
    };
  },
  async cancel() {},
  async shutdown() {},
};
startProcessExternalConnector({
  manifest,
  contributionId: CONTRIBUTION_ID,
  handler,
});
