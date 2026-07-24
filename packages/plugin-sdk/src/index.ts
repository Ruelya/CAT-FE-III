import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

export const HOST_API_VERSION = 1;

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
}

export type PluginFilterEvent =
  | { type: "startDocument"; metadata: { format: string; sourceLocale?: string; properties?: Record<string, string> } }
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
  if (!manifest.id?.trim()) errors.push("id is required");
  if (manifest.id?.startsWith("builtin.")) errors.push("id must not use builtin. prefix");
  if (!manifest.contributions?.filters?.length) {
    errors.push("at least one filter contribution is required");
  }
  return errors;
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
