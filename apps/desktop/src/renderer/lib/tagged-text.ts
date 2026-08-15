import type { InlineTag } from "@translunar/contracts";

export interface TaggedPiece {
  kind: "text" | "tag";
  text: string;
  tag?: InlineTag;
}

/**
 * Split a string into text and tag capsules by character offset.
 *
 * Engine tag positions are character counts, not UTF-16 indexes, so this walks
 * the string as characters. Tags at the same position are emitted in the order
 * they arrive (start before end for a collapsed pair).
 */
export function splitTaggedText(
  text: string,
  tags: readonly InlineTag[],
): TaggedPiece[] {
  const characters = [...text];
  const ordered = [...tags].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }
    // Starts before ends at the same offset so a collapsed pair reads <b></b>.
    const rank = (tag: InlineTag) =>
      tag.kind === "start" ? 0 : tag.kind === "standalone" ? 1 : 2;
    return rank(left) - rank(right);
  });

  const pieces: TaggedPiece[] = [];
  let cursor = 0;
  for (const tag of ordered) {
    const at = Math.max(0, Math.min(tag.position, characters.length));
    if (at > cursor) {
      pieces.push({
        kind: "text",
        text: characters.slice(cursor, at).join(""),
      });
      cursor = at;
    }
    pieces.push({
      kind: "tag",
      text: tagLabel(tag),
      tag,
    });
  }
  if (cursor < characters.length) {
    pieces.push({
      kind: "text",
      text: characters.slice(cursor).join(""),
    });
  }
  if (pieces.length === 0 && text.length === 0 && ordered.length === 0) {
    return [];
  }
  return pieces;
}

export function tagLabel(tag: InlineTag): string {
  const base = tag.displayText || "tag";
  if (tag.kind === "start") return base;
  if (tag.kind === "end") return `/${base}`;
  return base;
}
