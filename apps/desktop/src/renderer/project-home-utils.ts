export interface SearchSnippetPart {
  text: string;
  highlighted: boolean;
}

export interface ProjectTemplateDefinitionFields {
  sourceLocale: string;
  targetLocale: string;
  domain: string;
  qaProfileId: string;
  pipelineId: string;
  aiProfileIds: string[];
  analysisProfileId: string;
  reviewRequired: boolean;
}

const HIGHLIGHT_START = "<mark>";
const HIGHLIGHT_END = "</mark>";
const SECRET_KEY_PARTS = [
  "credential",
  "apikey",
  "secret",
  "token",
  "password",
] as const;
const SOURCE_PAYLOAD_KEYS = new Set([
  "managedsourcepath",
  "originalsourcepath",
  "privatecontent",
  "privatesource",
  "rawsource",
  "sourcebody",
  "sourcebytes",
  "sourcecontent",
  "sourcedocument",
  "sourcepath",
  "sourcetext",
]);

export function parseSearchSnippet(snippet: string): SearchSnippetPart[] {
  const parts: SearchSnippetPart[] = [];
  let cursor = 0;

  while (cursor < snippet.length) {
    const start = snippet.indexOf(HIGHLIGHT_START, cursor);
    if (start < 0) {
      parts.push({ text: snippet.slice(cursor), highlighted: false });
      break;
    }
    const contentStart = start + HIGHLIGHT_START.length;
    const end = snippet.indexOf(HIGHLIGHT_END, contentStart);
    if (end < 0) {
      parts.push({ text: snippet.slice(cursor), highlighted: false });
      break;
    }
    if (start > cursor) {
      parts.push({ text: snippet.slice(cursor, start), highlighted: false });
    }
    parts.push({
      text: snippet.slice(contentStart, end),
      highlighted: true,
    });
    cursor = end + HIGHLIGHT_END.length;
  }

  return parts;
}

export function readTemplateDefinition(
  value: unknown,
): ProjectTemplateDefinitionFields {
  const object = isRecord(value) ? value : {};
  const aiProfileIds = Array.isArray(object.aiProfileIds)
    ? object.aiProfileIds.filter(
        (profileId): profileId is string => typeof profileId === "string",
      )
    : [];
  return {
    sourceLocale:
      typeof object.sourceLocale === "string" ? object.sourceLocale : "en-US",
    targetLocale:
      typeof object.targetLocale === "string" ? object.targetLocale : "zh-CN",
    domain: typeof object.domain === "string" ? object.domain : "",
    qaProfileId:
      typeof object.qaProfileId === "string" ? object.qaProfileId : "",
    pipelineId: typeof object.pipelineId === "string" ? object.pipelineId : "",
    aiProfileIds,
    analysisProfileId:
      typeof object.analysisProfileId === "string"
        ? object.analysisProfileId
        : "builtin.analysis.standard",
    reviewRequired:
      typeof object.reviewRequired === "boolean" ? object.reviewRequired : true,
  };
}

export function cloneTemplateDefinition(
  value: unknown,
): Record<string, unknown> {
  return isRecord(value) ? sanitizeTemplateRecord(value) : {};
}

function sanitizeTemplateRecord(
  value: Record<string, unknown>,
  parentKey = "",
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveTemplateKey(key, parentKey)) continue;
    sanitized[key] = sanitizeTemplateValue(child, normalizeKey(key));
  }
  return sanitized;
}

function sanitizeTemplateValue(value: unknown, parentKey: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      isRecord(item)
        ? sanitizeTemplateRecord(item, parentKey)
        : sanitizeTemplateValue(item, parentKey),
    );
  }
  return isRecord(value) ? sanitizeTemplateRecord(value, parentKey) : value;
}

function isSensitiveTemplateKey(key: string, parentKey: string): boolean {
  const normalized = normalizeKey(key);
  if (SECRET_KEY_PARTS.some((part) => normalized.includes(part))) return true;
  if (normalized.includes("privatesource")) return true;
  if (SOURCE_PAYLOAD_KEYS.has(normalized)) return true;
  return (
    parentKey.includes("source") &&
    ["body", "bytes", "content", "document", "path", "text"].includes(
      normalized,
    )
  );
}

function normalizeKey(value: string): string {
  return value.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
