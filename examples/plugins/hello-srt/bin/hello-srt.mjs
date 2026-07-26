#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

const MANIFEST = {
  id: "example.hello-srt",
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
};

const descriptor = MANIFEST.contributions.filters[0];

const rl = createInterface({ input, crlfDelay: Infinity });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    write({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: `invalid JSON: ${String(error)}` },
    });
    return;
  }
  const id = request.id ?? null;
  try {
    const result = await dispatch(request.method, request.params ?? {});
    if (id !== null && id !== undefined) {
      write({ jsonrpc: "2.0", id, result });
    }
  } catch (error) {
    if (id !== null && id !== undefined) {
      write({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
});

function write(value) {
  output.write(`${JSON.stringify(value)}\n`);
}

async function dispatch(method, params) {
  switch (method) {
    case "plugin.handshake":
      return {
        apiVersion: 1,
        pluginId: MANIFEST.id,
        contributions: MANIFEST.contributions,
      };
    case "plugin.shutdown":
      setTimeout(() => process.exit(0), 0).unref?.();
      return {};
    case "filter.descriptor":
      return descriptor;
    case "filter.probe":
      return probe(params.sourcePath);
    case "filter.import":
      return importSrt(params.sourcePath);
    case "filter.export":
      return exportSrt(
        params.sourcePath,
        params.outputPath,
        params.segments ?? [],
      );
    case "filter.validate": {
      const events = importSrt(params.sourcePath);
      return { valid: events.length > 0, findings: [] };
    }
    default:
      throw new Error(`unknown method ${method}`);
  }
}

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
  const text = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
  const blocks = text
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const events = [
    {
      type: "startDocument",
      metadata: {
        format: "srt",
        properties: { filter: "example.hello-srt" },
      },
    },
  ];
  let ordinal = 0;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;
    let index = 0;
    if (/^\d+$/.test(lines[0] ?? "")) index = 1;
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
  const original = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
  const blocks = original
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const targets = new Map(
    segments.map((segment) => [
      Number(segment.ordinal),
      segment.targetText ?? "",
    ]),
  );
  const outBlocks = [];
  let cueIndex = 0;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;
    let index = 0;
    let numberLine = null;
    if (/^\d+$/.test(lines[0] ?? "")) {
      numberLine = lines[0];
      index = 1;
    }
    const timing = lines[index] ?? "";
    if (!timing.includes("-->")) continue;
    const target = targets.has(cueIndex)
      ? targets.get(cueIndex)
      : lines.slice(index + 1).join("\n");
    const rebuilt = [numberLine ?? String(cueIndex + 1), timing, target]
      .filter((line) => line !== null && line !== undefined)
      .join("\n");
    outBlocks.push(rebuilt);
    cueIndex += 1;
  }
  writeFileSync(outputPath, `${outBlocks.join("\n\n")}\n`, "utf8");
  return {
    outputPath,
    translatedSegments: cueIndex,
    degradation: [],
  };
}
