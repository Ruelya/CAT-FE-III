import type { InlineTag } from "@translunar/contracts";
import DOMPurify from "dompurify";
import { marked } from "marked";

import { previewInnerHtml } from "./preview-markup";
import { reconstructWithPayloads } from "./preview-reconstruct";

export type PreviewKind = "markdown" | "html" | "docx" | "text";

const PURIFY: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["data-fmt"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta"],
};

export function previewKind(filterId = "", format = ""): PreviewKind {
  const hay = `${filterId} ${format}`.toLowerCase();
  if (hay.includes("markdown") || hay.includes("mdown") || hay.includes("mkdn")) {
    return "markdown";
  }
  if (/(?:^|[^a-z])md(?:[^a-z]|$)/.test(hay)) return "markdown";
  if (hay.includes("html") || hay.includes("xhtml")) return "html";
  if (hay.includes("docx")) return "docx";
  return "text";
}

export function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY);
}

export function renderMarkdownPreview(source: string): string {
  const parsed = marked.parse(source, { async: false, gfm: true });
  return sanitizePreviewHtml(parsed);
}

/**
 * Render one segment for the live preview page.
 *
 * Markdown and HTML go through their native markup (tag payloads) plus a
 * mature parser/sanitizer. Other filters keep tag-to-typography HTML, then
 * the same sanitizer. This does not invent headings or tables the engine
 * did not encode in text or tag payloads.
 */
export function renderPreviewHtml(
  text: string,
  tags: readonly InlineTag[],
  filterId = "",
  format = "",
): string {
  const kind = previewKind(filterId, format);
  if (kind === "markdown") {
    const source = reconstructWithPayloads(text, tags, false);
    return renderMarkdownPreview(source || text);
  }
  if (kind === "html") {
    const html = reconstructWithPayloads(text, tags, true);
    return sanitizePreviewHtml(html || previewInnerHtml(text, tags));
  }
  return sanitizePreviewHtml(previewInnerHtml(text, tags));
}

export function previewRendererHint(
  kind: PreviewKind,
  hasOriginalLayout: boolean,
): string {
  if (hasOriginalLayout && kind === "docx") {
    return "docx-preview original file · DOMPurify live blocks · click a block to jump";
  }
  if (kind === "markdown") {
    return "Live reconstruction · marked · DOMPurify · click a block to jump";
  }
  if (kind === "html") {
    return "Live reconstruction · DOMPurify · click a block to jump";
  }
  return "Live reconstruction · DOMPurify · click a block to jump";
}
