import type { InlineTag } from "@translunar/contracts";

import { escapeHtml } from "./preview-markup";

function tagsAtPositions(
  tags: readonly InlineTag[],
  length: number,
): Map<number, InlineTag[]> {
  const at = new Map<number, InlineTag[]>();
  for (const tag of tags) {
    const position = Math.max(0, Math.min(tag.position, length));
    const list = at.get(position) ?? [];
    list.push(tag);
    at.set(position, list);
  }
  return at;
}

/**
 * Rebuild the original markup by inserting tag payloads at their positions.
 *
 * Markdown filters store `# `, list markers, and emphasis in standalone
 * `<md>` payloads. HTML filters store the real start/end tags in payloads.
 */
export function reconstructWithPayloads(
  text: string,
  tags: readonly InlineTag[],
  escapeText: boolean,
): string {
  const characters = [...text];
  const at = tagsAtPositions(tags, characters.length);
  let out = "";
  for (let index = 0; index <= characters.length; index += 1) {
    for (const tag of at.get(index) ?? []) {
      out += tag.payload ?? "";
    }
    if (index < characters.length) {
      const character = characters[index] ?? "";
      out += escapeText ? escapeHtml(character) : character;
    }
  }
  return out;
}
