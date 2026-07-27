#!/usr/bin/env node

// ../../examples/plugins/hello-srt/src/index.ts
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";

// src/index.ts
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
var HOST_API_VERSION = 1;
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
function validateManifest(manifest2) {
  const errors = [];
  if (manifest2.manifestVersion !== 1) errors.push("manifestVersion must be 1");
  validateId(manifest2.id, "id", errors);
  if (manifest2.id?.startsWith("builtin.")) {
    errors.push("id must not use builtin. prefix");
  }
  if (!manifest2.displayName?.trim()) errors.push("displayName is required");
  if (!manifest2.version?.trim()) errors.push("version is required");
  if (
    !Number.isInteger(manifest2.apiVersion) ||
    !Number.isInteger(manifest2.apiVersionMin) ||
    manifest2.apiVersion < 0 ||
    manifest2.apiVersionMin < 0
  ) {
    errors.push("apiVersion and apiVersionMin must be non-negative integers");
  } else if (manifest2.apiVersionMin > manifest2.apiVersion) {
    errors.push("apiVersionMin must be <= apiVersion");
  } else if (
    HOST_API_VERSION < manifest2.apiVersionMin ||
    HOST_API_VERSION > manifest2.apiVersion
  ) {
    errors.push(
      `host API ${HOST_API_VERSION} is outside plugin range ${manifest2.apiVersionMin}..=${manifest2.apiVersion}`,
    );
  }
  if (manifest2.tier !== "process") errors.push("tier must be process");
  if (
    !manifest2.entry ||
    !["node", "executable"].includes(manifest2.entry.kind) ||
    !manifest2.entry.path?.trim() ||
    manifest2.entry.path.includes("..") ||
    /^(?:[A-Za-z]:[\\/]|[\\/])/.test(manifest2.entry.path)
  ) {
    errors.push(
      "entry must have a supported kind and a relative path without '..'",
    );
  }
  const filters = manifest2.contributions?.filters;
  if (!filters?.length) {
    errors.push("at least one filter contribution is required");
  } else {
    const seen = /* @__PURE__ */ new Set();
    for (const filter2 of filters) {
      validateId(filter2.id, "filter id", errors);
      if (filter2.id?.startsWith("builtin.")) {
        errors.push(`filter id ${filter2.id} must not use builtin. prefix`);
      }
      if (seen.has(filter2.id)) {
        errors.push(`duplicate filter id ${filter2.id}`);
      }
      seen.add(filter2.id);
      if (!filter2.version?.trim() || !filter2.displayName?.trim()) {
        errors.push(`filter ${filter2.id} needs version and displayName`);
      }
      if (!filter2.extensions?.length) {
        errors.push(`filter ${filter2.id} needs at least one extension`);
      }
    }
  }
  for (const permission of manifest2.permissions ?? []) {
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
  validateCapabilityRequests(manifest2.capabilities ?? [], errors);
  return errors;
}
function validateId(value, label, errors) {
  if (!value || value.trim() !== value) {
    errors.push(`${label} must be non-empty without surrounding whitespace`);
  } else if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    errors.push(`${label} contains unsupported characters`);
  }
}
function startProcessPlugin(options) {
  const { manifest: manifest2, filter: filter2 } = options;
  const errors = validateManifest(manifest2);
  if (errors.length > 0) {
    throw new Error(`invalid plugin manifest: ${errors.join("; ")}`);
  }
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    void handleLine(line, manifest2, filter2);
  });
}
async function handleLine(line, manifest2, filter2) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    writeError(null, `invalid JSON: ${String(error)}`);
    return;
  }
  const id = typeof request.id === "number" ? request.id : null;
  const method = request.method ?? "";
  try {
    const result = await dispatch(method, request.params, manifest2, filter2);
    if (id !== null) writeResult(id, result);
  } catch (error) {
    if (id !== null) {
      writeError(id, error instanceof Error ? error.message : String(error));
    }
  }
}
async function dispatch(method, params, manifest2, filter2) {
  switch (method) {
    case "plugin.handshake":
      return {
        apiVersion: HOST_API_VERSION,
        pluginId: manifest2.id,
        contributions: manifest2.contributions,
      };
    case "plugin.shutdown":
      setTimeout(() => process.exit(0), 0).unref?.();
      return {};
    case "filter.descriptor":
      return filter2.descriptor();
    case "filter.probe":
      return filter2.probe(asRecord(params));
    case "filter.import":
      return filter2.import(asRecord(params));
    case "filter.export":
      return filter2.export(asRecord(params));
    case "filter.validate":
      return filter2.validate(asRecord(params));
    default:
      throw new Error(`unknown method ${method}`);
  }
}
function asRecord(value) {
  if (typeof value === "object" && value !== null) {
    return value;
  }
  return {};
}
function writeResult(id, result) {
  output.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}
`);
}
function writeError(id, message) {
  output.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32e3, message },
    })}
`,
  );
}

// ../../examples/plugins/hello-srt/manifest.json
var manifest_default = {
  manifestVersion: 1,
  id: "example.hello-srt",
  displayName: "Hello SRT",
  version: "0.1.0",
  apiVersion: 1,
  apiVersionMin: 1,
  tier: "process",
  entry: {
    kind: "node",
    path: "bin/hello-srt.mjs",
  },
  contributions: {
    filters: [
      {
        id: "example.hello-srt",
        version: "0.1.0",
        displayName: "Hello SRT",
        extensions: ["srt"],
        capabilities: {
          import: true,
          export: true,
          validate: true,
          inlineTags: false,
          notes: false,
          degradationReport: true,
        },
      },
    ],
  },
  permissions: ["file.read:source", "file.write:output"],
};

// ../../examples/plugins/hello-srt/src/index.ts
var manifest = manifest_default;
function requireFilterDescriptor(pluginManifest) {
  const descriptor2 = pluginManifest.contributions.filters[0];
  if (!descriptor2) {
    throw new Error("hello-srt requires one filter contribution");
  }
  return descriptor2;
}
var descriptor = requireFilterDescriptor(manifest);
function probe(sourcePath) {
  const extension = extname(sourcePath).toLowerCase();
  if (extension === ".srt") {
    return { confidence: 90, reason: "`.srt` extension" };
  }
  if (basename(sourcePath).toLowerCase().includes("srt")) {
    return { confidence: 40, reason: "filename mentions srt" };
  }
  return { confidence: 0, reason: "not an SRT subtitle file" };
}
function importSrt(sourcePath) {
  const text = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/u, "");
  const blocks = text
    .split(/\r?\n\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const events = [
    {
      type: "startDocument",
      metadata: {
        format: "srt",
        properties: { filter: descriptor.id },
      },
    },
  ];
  let ordinal = 0;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/u);
    if (lines.length < 2) continue;
    let index = 0;
    if (/^\d+$/u.test(lines[0] ?? "")) index = 1;
    const timing = lines[index] ?? "";
    if (!timing.includes("-->")) continue;
    const body = lines
      .slice(index + 1)
      .join("\n")
      .trim();
    if (!body) continue;
    events.push({
      type: "startUnit",
      ordinal,
      structuralPath: `/cue[${ordinal}]`,
    });
    events.push({ type: "text", text: body });
    events.push({ type: "endUnit" });
    ordinal += 1;
  }
  if (ordinal === 0) {
    events.push({
      type: "degradation",
      finding: {
        code: "srt.empty",
        severity: "warning",
        message: "SRT contained no importable cues",
      },
    });
  }
  events.push({ type: "endDocument" });
  return events;
}
function exportSrt(sourcePath, outputPath, segments) {
  const original = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/u, "");
  const blocks = original
    .split(/\r?\n\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const targets = new Map(
    segments.map((segment) => [segment.ordinal, segment.targetText]),
  );
  const outBlocks = [];
  let cueIndex = 0;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/u);
    if (lines.length < 2) continue;
    let index = 0;
    let numberLine;
    if (/^\d+$/u.test(lines[0] ?? "")) {
      numberLine = lines[0];
      index = 1;
    }
    const timing = lines[index] ?? "";
    if (!timing.includes("-->")) continue;
    const target = targets.get(cueIndex) ?? lines.slice(index + 1).join("\n");
    outBlocks.push(
      [numberLine ?? String(cueIndex + 1), timing, target].join("\n"),
    );
    cueIndex += 1;
  }
  writeFileSync(
    outputPath,
    `${outBlocks.join("\n\n")}
`,
    "utf8",
  );
  return {
    outputPath,
    translatedSegments: cueIndex,
    degradation: [],
  };
}
var filter = {
  descriptor() {
    return descriptor;
  },
  probe({ sourcePath }) {
    return probe(sourcePath);
  },
  import({ sourcePath }) {
    return importSrt(sourcePath);
  },
  export({ sourcePath, outputPath, segments }) {
    return exportSrt(sourcePath, outputPath, segments);
  },
  validate({ sourcePath }) {
    const events = importSrt(sourcePath);
    return {
      valid: events.some((event) => event.type === "startUnit"),
      findings: [],
    };
  },
};
startProcessPlugin({ manifest, filter });
