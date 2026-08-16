export const MANAGED_SOURCE_MAX_BYTES = 32 * 1024 * 1024;
export const MANAGED_SOURCES_DIR = "sources";

export interface ManagedSourceRequest {
  documentId: string;
  format: string;
  name?: string;
  relativePath?: string;
}

export interface ManagedSourceBytes {
  extension: string;
  bytes: Uint8Array;
}

const FORMAT_ALIASES: Record<string, readonly string[]> = {
  markdown: ["md", "markdown", "mdown", "mkdn"],
  md: ["md", "markdown"],
  html: ["html", "htm", "xhtml"],
  htm: ["htm", "html"],
  xhtml: ["xhtml", "html"],
  docx: ["docx"],
  txt: ["txt"],
  text: ["txt"],
};

export function parseManagedSourceRequest(
  value: unknown,
): ManagedSourceRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.documentId !== "string" || typeof record.format !== "string") {
    return null;
  }
  const documentId = record.documentId.trim();
  const format = record.format.trim();
  if (!documentId || !format) return null;
  return {
    documentId,
    format,
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.relativePath === "string"
      ? { relativePath: record.relativePath }
      : {}),
  };
}

export function sanitizeDocumentId(id: string): string | null {
  const trimmed = id.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  return trimmed;
}

export function sanitizeExtension(value: string): string | null {
  const extension = value
    .trim()
    .replace(/^\./, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!extension || extension.length > 16) return null;
  return extension;
}

export function extensionFromFileName(value: string): string | null {
  const base = value.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return sanitizeExtension(base.slice(dot + 1));
}

export function extensionCandidates(request: ManagedSourceRequest): string[] {
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const extension = sanitizeExtension(value);
    if (extension) seen.add(extension);
  };

  add(extensionFromFileName(request.relativePath ?? ""));
  add(extensionFromFileName(request.name ?? ""));
  const format = request.format.trim().toLowerCase();
  add(format);
  for (const alias of FORMAT_ALIASES[format] ?? []) {
    add(alias);
  }
  return [...seen];
}
