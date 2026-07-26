#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";

import {
  startProcessPlugin,
  type FilterDescriptor,
  type FilterHandlers,
  type PluginFilterEvent,
  type PluginManifest,
  type Segment,
} from "@translunar/plugin-sdk";

import manifestJson from "../manifest.json";

const manifest = manifestJson as PluginManifest;

function requireFilterDescriptor(
  pluginManifest: PluginManifest,
): FilterDescriptor {
  const descriptor = pluginManifest.contributions.filters[0];
  if (!descriptor) {
    throw new Error("hello-srt requires one filter contribution");
  }
  return descriptor;
}

const descriptor = requireFilterDescriptor(manifest);

function probe(sourcePath: string) {
  const extension = extname(sourcePath).toLowerCase();
  if (extension === ".srt") {
    return { confidence: 90, reason: "`.srt` extension" };
  }
  if (basename(sourcePath).toLowerCase().includes("srt")) {
    return { confidence: 40, reason: "filename mentions srt" };
  }
  return { confidence: 0, reason: "not an SRT subtitle file" };
}

function importSrt(sourcePath: string): PluginFilterEvent[] {
  const text = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/u, "");
  const blocks = text
    .split(/\r?\n\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const events: PluginFilterEvent[] = [
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

function exportSrt(
  sourcePath: string,
  outputPath: string,
  segments: Segment[],
) {
  const original = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/u, "");
  const blocks = original
    .split(/\r?\n\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const targets = new Map(
    segments.map((segment) => [segment.ordinal, segment.targetText]),
  );
  const outBlocks: string[] = [];
  let cueIndex = 0;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/u);
    if (lines.length < 2) continue;
    let index = 0;
    let numberLine: string | undefined;
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
  writeFileSync(outputPath, `${outBlocks.join("\n\n")}\n`, "utf8");
  return {
    outputPath,
    translatedSegments: cueIndex,
    degradation: [],
  };
}

const filter: FilterHandlers = {
  descriptor(): FilterDescriptor {
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
