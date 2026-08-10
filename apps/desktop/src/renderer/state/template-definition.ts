/** P1-owned keys on project template definitions (unknown-preserving). */

export interface P1TemplateDefaults {
  sourceLocale: string;
  targetLocale: string;
  domain: string;
}

export type DecodeTemplateDefinitionResult =
  | { ok: true; defaults: P1TemplateDefaults; raw: Record<string, unknown> }
  | { ok: false; reason: "invalid-definition" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/**
 * Decode P1 editable defaults from an Engine template definition.
 * Non-object definitions are invalid for edit merge; use may still override.
 */
export function decodeTemplateDefinition(
  definition: unknown,
): DecodeTemplateDefinitionResult {
  if (!isPlainObject(definition)) {
    return { ok: false, reason: "invalid-definition" };
  }
  return {
    ok: true,
    raw: definition,
    defaults: {
      sourceLocale: readString(definition, "sourceLocale"),
      targetLocale: readString(definition, "targetLocale"),
      domain: readString(definition, "domain"),
    },
  };
}

/** Create a plain definition containing only P1 keys. */
export function createTemplateDefinition(
  defaults: P1TemplateDefaults,
): Record<string, unknown> {
  return {
    sourceLocale: defaults.sourceLocale,
    targetLocale: defaults.targetLocale,
    domain: defaults.domain,
  };
}

/**
 * Shallow-copy a fetched definition and replace only P1 keys.
 * Unknown keys survive unchanged.
 */
export function mergeTemplateDefinition(
  existing: unknown,
  defaults: P1TemplateDefaults,
):
  | { ok: true; definition: Record<string, unknown> }
  | { ok: false; reason: "invalid-definition" } {
  if (!isPlainObject(existing)) {
    return { ok: false, reason: "invalid-definition" };
  }
  return {
    ok: true,
    definition: {
      ...existing,
      sourceLocale: defaults.sourceLocale,
      targetLocale: defaults.targetLocale,
      domain: defaults.domain,
    },
  };
}

export function isBuiltInTemplate(template: { builtIn: boolean }): boolean {
  return template.builtIn === true;
}
