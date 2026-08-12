import type {
  PluginContributionDescriptor,
  PluginContributionState,
  PluginStatus,
  PublicConfigFieldTypeV1,
} from "@translunar/contracts";

export type SupportedAiActionFieldType =
  "text" | "boolean" | "integer" | "number" | "select";

export interface ProjectedAiActionField {
  key: string;
  label: string;
  fieldType: SupportedAiActionFieldType;
  required: boolean;
  options: Array<{ label: string; value: string }>;
  defaultValue: string | boolean | number | null;
}

export type AiActionSchemaProjection =
  | { ok: true; fields: ProjectedAiActionField[] }
  | { ok: false; reason: "missing" | "unsupported"; unsupportedKeys: string[] };

const SUPPORTED_ACTION_FIELDS = new Set<string>([
  "text",
  "boolean",
  "integer",
  "number",
  "select",
]);

export function projectAiActionSchema(
  fields:
    | Array<{
        key: string;
        label: string;
        fieldType: PublicConfigFieldTypeV1;
        required?: boolean;
        options?: Array<{ label: string; value: string }>;
        defaultValue?: string | boolean | number | null;
      }>
    | null
    | undefined,
): AiActionSchemaProjection {
  if (!fields) {
    return { ok: false, reason: "missing", unsupportedKeys: [] };
  }
  const unsupportedKeys: string[] = [];
  const projected: ProjectedAiActionField[] = [];
  for (const field of fields) {
    if (!SUPPORTED_ACTION_FIELDS.has(field.fieldType)) {
      unsupportedKeys.push(field.key);
      continue;
    }
    projected.push({
      key: field.key,
      label: field.label,
      fieldType: field.fieldType as SupportedAiActionFieldType,
      required: field.required === true,
      options: field.options ?? [],
      defaultValue: field.defaultValue ?? null,
    });
  }
  if (unsupportedKeys.length > 0) {
    return { ok: false, reason: "unsupported", unsupportedKeys };
  }
  return { ok: true, fields: projected };
}

export function isPluginLifecycleActive(status: PluginStatus): boolean {
  return (
    status === "enabled" || status === "installed" || status === "disabled"
  );
}

export function canEnablePlugin(status: PluginStatus): boolean {
  return (
    status === "installed" || status === "disabled" || status === "degraded"
  );
}

export function canDisablePlugin(status: PluginStatus): boolean {
  return status === "enabled" || status === "degraded";
}

export function canUninstallPlugin(status: PluginStatus): boolean {
  return status !== undefined;
}

export function isContributionOpenable(
  state: PluginContributionState | undefined,
): boolean {
  return state === "active";
}

export function requireActorReason(
  actor: string,
  reason: string,
): { ok: true } | { ok: false; field: "actor" | "reason" } {
  if (actor.trim().length === 0) return { ok: false, field: "actor" };
  if (reason.trim().length === 0) return { ok: false, field: "reason" };
  return { ok: true };
}

export function contributionOwnerKey(owner: {
  pluginId: string;
  contributionId: string;
  versionId: string;
  activationRevision: number;
}): string {
  return `${owner.pluginId}/${owner.contributionId}@${owner.versionId}#${owner.activationRevision}`;
}

export function findContribution(
  contributions: PluginContributionDescriptor[] | undefined,
  contributionId: string,
): PluginContributionDescriptor | null {
  if (!contributions) return null;
  return contributions.find((c) => c.id === contributionId) ?? null;
}

export function isPanelSessionUrl(url: string): boolean {
  return url.startsWith("translunar-plugin:");
}

export function sessionMatchesRevocation(
  session: { pluginId: string } | null,
  revokedPluginId: string | null,
): boolean {
  if (!session) return false;
  if (revokedPluginId === null) return true;
  return session.pluginId === revokedPluginId;
}
