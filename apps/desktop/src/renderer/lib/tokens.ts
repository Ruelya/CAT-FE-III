/**
 * Placeholder token lexer for source/target text. The pattern mirrors the
 * engine's `PLACEHOLDER_RE` (crates/tl-domain) verbatim — the same token
 * shapes drive the `qa.tag-placeholder_*` rules and the AI `tagCheck`
 * gate, so what the grid highlights is exactly what QA counts. Renderer
 * highlighting only; the QA result stays the source of truth.
 */

const PLACEHOLDER_PATTERN = [
  String.raw`\{\{[^{}]*\}\}`, // {{handlebars}}
  String.raw`\{[^{}\s][^{}]*\}`, // {brace} placeholders
  // printf-style. NB: the engine's Rust pattern is written in (?x) verbose
  // mode where whitespace inside a class is ignored, so its flag class is
  // effectively [-+0#] — a space flag would be a renderer-only invention.
  String.raw`%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?[sdifucxXeg@]`,
  String.raw`</?[A-Za-z][A-Za-z0-9:._-]*(?:\s[^<>]*)?/?>`, // markup tags
  String.raw`&#?[A-Za-z0-9]+;`, // character entities
].join("|");

export interface TokenRun {
  text: string;
  /** True when the run is a placeholder token, false for plain text. */
  token: boolean;
}

/** Splits text into plain runs and placeholder-token runs, in order. */
export function lexPlaceholderTokens(text: string): TokenRun[] {
  if (text.length === 0) {
    return [];
  }
  // A fresh regex per call: the global flag carries lastIndex state.
  const pattern = new RegExp(PLACEHOLDER_PATTERN, "g");
  const runs: TokenRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) {
      runs.push({ text: text.slice(cursor, index), token: false });
    }
    runs.push({ text: match[0], token: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    runs.push({ text: text.slice(cursor), token: false });
  }
  return runs;
}

/** The distinct placeholder tokens contained in the text. */
export function placeholderTokens(text: string): string[] {
  return lexPlaceholderTokens(text)
    .filter((run) => run.token)
    .map((run) => run.text);
}
