import type { InlineTag } from "@translunar/contracts";

const TOKEN_TO_TAG: Record<string, string> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  u: "u",
  s: "s",
  strike: "s",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatRunClass(tokens: readonly string[]): string {
  const classes = tokens
    .map((token) => {
      if (token === "b" || token === "strong") return "tagged-run--b";
      if (token === "i" || token === "em") return "tagged-run--i";
      if (token === "u") return "tagged-run--u";
      if (token === "s" || token === "strike") return "tagged-run--s";
      return "";
    })
    .filter(Boolean);
  return classes.length > 0 ? `tagged-run ${classes.join(" ")}` : "";
}

/** Tokens a translator-facing tag label can carry (`b`, `<b>`, `b i`). */
export function formatTokens(displayText: string): string[] {
  return displayText
    .replaceAll(/[<>/]/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0 && token !== "md");
}

function openMarkup(tokens: readonly string[]): string {
  return tokens
    .map((token) => {
      const tag = TOKEN_TO_TAG[token];
      return tag
        ? `<${tag}>`
        : `<span class="preview-fmt" data-fmt="${escapeHtml(token)}">`;
    })
    .join("");
}

function closeMarkup(tokens: readonly string[]): string {
  return [...tokens]
    .reverse()
    .map((token) => {
      const tag = TOKEN_TO_TAG[token];
      return tag ? `</${tag}>` : "</span>";
    })
    .join("");
}

/**
 * Render segment text with its tags as real HTML formatting.
 *
 * Start/end pairs become strong/em/u (or a generic span). Standalone tags
 * are omitted — they are placeables, not typography. Text is escaped.
 */
export function previewInnerHtml(
  text: string,
  tags: readonly InlineTag[],
): string {
  const characters = [...text];
  const starts = new Map<number, InlineTag[]>();
  const ends = new Map<number, InlineTag[]>();
  for (const tag of tags) {
    const at = Math.max(0, Math.min(tag.position, characters.length));
    if (tag.kind === "start") {
      const list = starts.get(at) ?? [];
      list.push(tag);
      starts.set(at, list);
    } else if (tag.kind === "end") {
      const list = ends.get(at) ?? [];
      list.push(tag);
      ends.set(at, list);
    }
  }

  const tokenByPair = new Map<string, string[]>();
  const tokenById = new Map<string, string[]>();
  for (const tag of tags) {
    if (tag.kind !== "start") continue;
    const tokens = formatTokens(tag.displayText);
    tokenById.set(tag.id, tokens);
    if (tag.pairId) tokenByPair.set(tag.pairId, tokens);
  }

  const tokensForEnd = (tag: InlineTag): string[] => {
    if (tag.pairId && tokenByPair.has(tag.pairId)) {
      return tokenByPair.get(tag.pairId) ?? [];
    }
    const byDisplay = formatTokens(tag.displayText);
    if (byDisplay.length > 0) return byDisplay;
    return tokenById.get(tag.id) ?? [];
  };

  let html = "";
  for (let index = 0; index <= characters.length; index += 1) {
    for (const tag of ends.get(index) ?? []) {
      html += closeMarkup(tokensForEnd(tag));
    }
    for (const tag of starts.get(index) ?? []) {
      html += openMarkup(formatTokens(tag.displayText));
    }
    if (index < characters.length) {
      html += escapeHtml(characters[index] ?? "");
    }
  }
  return html;
}
