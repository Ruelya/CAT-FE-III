#!/usr/bin/env node

// ../../examples/plugins/hello-srt/src/index.ts
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";

// src/index.ts
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
var HOST_API_VERSION = 1;
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
