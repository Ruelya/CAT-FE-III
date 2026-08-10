import type {
  AiBatchStatus,
  AiRunStatus,
  EngineConnectorConfigFieldV1,
  EngineConnectorConfigSchemaV1,
} from "@translunar/contracts";

export type SupportedConfigFieldType = "text" | "boolean" | "integer" | "select";

export interface ProjectedConfigField {
  key: string;
  label: string;
  fieldType: SupportedConfigFieldType;
  required: boolean;
  description: string | null;
  min: number | null;
  max: number | null;
  options: Array<{ label: string; value: string }>;
  defaultValue: string | boolean | number | null;
}

export type SchemaProjection =
  | { ok: true; fields: ProjectedConfigField[] }
  | { ok: false; reason: "missing" | "unsupported"; unsupportedKeys: string[] };

const SUPPORTED = new Set<string>(["text", "boolean", "integer", "select"]);

export function projectConnectorSchema(
  schema: EngineConnectorConfigSchemaV1 | null | undefined,
): SchemaProjection {
  if (!schema || !Array.isArray(schema.fields)) {
    return { ok: false, reason: "missing", unsupportedKeys: [] };
  }
  const unsupportedKeys: string[] = [];
  const fields: ProjectedConfigField[] = [];
  for (const field of schema.fields) {
    if (!SUPPORTED.has(field.fieldType)) {
      unsupportedKeys.push(field.key);
      continue;
    }
    fields.push(projectField(field));
  }
  if (unsupportedKeys.length > 0) {
    return { ok: false, reason: "unsupported", unsupportedKeys };
  }
  return { ok: true, fields };
}

function projectField(field: EngineConnectorConfigFieldV1): ProjectedConfigField {
  return {
    key: field.key,
    label: field.label,
    fieldType: field.fieldType as SupportedConfigFieldType,
    required: field.required,
    description: field.description ?? null,
    min: field.min ?? null,
    max: field.max ?? null,
    options: (field.options ?? []).map((o) => ({
      label: o.label,
      value: o.value,
    })),
    defaultValue:
      field.defaultValue === undefined || field.defaultValue === null
        ? null
        : field.defaultValue,
  };
}

/** Create emits only projected known keys. */
export function buildCreateConfiguration(
  fields: ProjectedConfigField[],
  form: Record<string, string | boolean | number>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(form, field.key)) {
      out[field.key] = form[field.key];
    } else if (field.defaultValue !== null) {
      out[field.key] = field.defaultValue;
    }
  }
  return out;
}

/**
 * Update starts from the fetched configuration object and overlays supported
 * fields so unknown future keys survive.
 */
export function mergeConfiguration(
  existing: Record<string, unknown> | null | undefined,
  fields: ProjectedConfigField[],
  form: Record<string, string | boolean | number>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(form, field.key)) {
      base[field.key] = form[field.key];
    }
  }
  return base;
}

const RUN_TERMINAL: ReadonlySet<AiRunStatus> = new Set([
  "canceled",
  "succeeded",
  "failed",
]);

const BATCH_TERMINAL: ReadonlySet<AiBatchStatus> = new Set([
  "canceled",
  "succeeded",
  "completedWithErrors",
  "failed",
]);

export function isRunTerminal(status: AiRunStatus): boolean {
  return RUN_TERMINAL.has(status);
}

export function isBatchTerminal(status: AiBatchStatus): boolean {
  return BATCH_TERMINAL.has(status);
}

export function canCancelRun(status: AiRunStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "retrying" ||
    status === "interrupted"
  );
}

export function canResumeRun(status: AiRunStatus): boolean {
  return status === "interrupted" || status === "failed";
}

export function canCancelBatch(status: AiBatchStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "interrupted"
  );
}

export function canResumeBatch(status: AiBatchStatus): boolean {
  return status === "interrupted" || status === "failed";
}

export function canApplyRun(
  status: AiRunStatus,
  proposalText: string | null | undefined,
): boolean {
  return status === "succeeded" && typeof proposalText === "string";
}

export function formatProviderSource(
  source:
    | { kind: "builtin"; provider: string }
    | {
        kind: "plugin";
        contributionId: string;
        owner: { pluginId: string; versionId: string };
        contractVersion: number;
      },
): string {
  if (source.kind === "builtin") {
    return `builtin:${source.provider}`;
  }
  return `plugin:${source.owner.pluginId}/${source.contributionId}@${source.owner.versionId}`;
}
