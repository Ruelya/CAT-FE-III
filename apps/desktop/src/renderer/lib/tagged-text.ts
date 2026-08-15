import type { InlineTag } from "@translunar/contracts";

import { formatRunClass, formatTokens } from "./preview-markup";

export interface TaggedPiece {
  kind: "text" | "tag" | "ghost";
  text: string;
  tag?: InlineTag;
}

export interface SerializedTaggedText {
  text: string;
  tags: InlineTag[];
}

/**
 * Split a string into text and tag capsules by character offset.
 *
 * Engine tag positions are character counts, not UTF-16 indexes, so this walks
 * the string as characters. Tags at the same position are emitted in the order
 * they arrive (start before end for a collapsed pair).
 */
function tagRank(tag: InlineTag): number {
  return tag.kind === "start" ? 0 : tag.kind === "standalone" ? 1 : 2;
}

export function splitTaggedText(
  text: string,
  tags: readonly InlineTag[],
  ghosts: readonly InlineTag[] = [],
): TaggedPiece[] {
  const characters = [...text];
  const markers = [
    ...tags.map((tag) => ({ tag, ghost: false })),
    ...ghosts.map((tag) => ({ tag, ghost: true })),
  ].sort((left, right) => {
    if (left.tag.position !== right.tag.position) {
      return left.tag.position - right.tag.position;
    }
    // Rank first so a ghost opening still sits before a real closer at the
    // same offset (Trados: delete the start, the ghost start remains).
    const rank = tagRank(left.tag) - tagRank(right.tag);
    if (rank !== 0) return rank;
    return left.ghost === right.ghost ? 0 : left.ghost ? 1 : -1;
  });

  const pieces: TaggedPiece[] = [];
  let cursor = 0;
  for (const marker of markers) {
    const at = Math.max(0, Math.min(marker.tag.position, characters.length));
    if (at > cursor) {
      pieces.push({
        kind: "text",
        text: characters.slice(cursor, at).join(""),
      });
      cursor = at;
    }
    pieces.push({
      kind: marker.ghost ? "ghost" : "tag",
      text: tagLabel(marker.tag),
      tag: marker.tag,
    });
  }
  if (cursor < characters.length) {
    pieces.push({
      kind: "text",
      text: characters.slice(cursor).join(""),
    });
  }
  if (pieces.length === 0 && text.length === 0 && markers.length === 0) {
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

export function tagsEqual(
  left: readonly InlineTag[],
  right: readonly InlineTag[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((tag, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      tag.id === other.id &&
      tag.kind === other.kind &&
      tag.position === other.position &&
      tag.displayText === other.displayText &&
      tag.payload === other.payload
    );
  });
}

/** Map source tag offsets onto a target of a different length. Keeps ids. */
export function mapTagsToTargetPositions(
  tags: readonly InlineTag[],
  sourceLength: number,
  targetLength: number,
): InlineTag[] {
  const span = Math.max(sourceLength, 1);
  return tags.map((tag) => ({
    ...tag,
    position: Math.min(
      targetLength,
      Math.round((tag.position * targetLength) / span),
    ),
  }));
}

function characterIndexOf(haystack: string, needle: string): number {
  if (!needle) return -1;
  const at = haystack.indexOf(needle);
  if (at < 0) return -1;
  return [...haystack.slice(0, at)].length;
}

/** Locate a source span (or a distinctive token from it) inside the target. */
export function findAlignedSpan(
  sourceSpan: string,
  targetText: string,
): { start: number; end: number } | null {
  const span = sourceSpan.trim();
  if (!span) return null;
  const exact = characterIndexOf(targetText, span);
  if (exact >= 0) {
    return { start: exact, end: exact + [...span].length };
  }
  const tokens = span.match(/[A-Z]+-\d+|\d+(?:[.,]\d+)?|[A-Za-z]{3,}/g) ?? [];
  for (const token of tokens) {
    const at = characterIndexOf(targetText, token);
    if (at >= 0) {
      return { start: at, end: at + [...token].length };
    }
  }
  return null;
}

/**
 * Prefer a target span that still contains the source phrase (or a token
 * from it). Fall back to proportional offsets when the translation reordered
 * the sentence.
 */
export function alignGhostPositions(
  sourceText: string,
  targetText: string,
  unmatched: readonly InlineTag[],
): InlineTag[] {
  const proportional = mapTagsToTargetPositions(
    unmatched,
    [...sourceText].length,
    [...targetText].length,
  );
  const byId = new Map(proportional.map((tag) => [tag.id, tag]));
  const used = new Set<string>();
  const aligned: InlineTag[] = [];

  for (const start of unmatched) {
    if (start.kind !== "start" || used.has(start.id)) continue;
    const end = unmatched.find((tag) => {
      if (tag.kind !== "end" || used.has(tag.id)) return false;
      if (start.pairId && tag.pairId) return tag.pairId === start.pairId;
      return tagFingerprint(start) === tagFingerprint(tag);
    });
    if (!end) continue;
    const span = [...sourceText]
      .slice(start.position, Math.max(start.position, end.position))
      .join("");
    const hit = findAlignedSpan(span, targetText);
    if (!hit) continue;
    aligned.push({ ...start, position: hit.start });
    aligned.push({ ...end, position: hit.end });
    used.add(start.id);
    used.add(end.id);
  }

  for (const tag of unmatched) {
    if (used.has(tag.id)) continue;
    aligned.push(byId.get(tag.id) ?? tag);
  }
  return aligned;
}

export function placeSourceTagsProportional(
  sourceTags: readonly InlineTag[],
  sourceLength: number,
  targetLength: number,
): InlineTag[] {
  return mapTagsToTargetPositions(sourceTags, sourceLength, targetLength).map(
    (tag, index) => ({
      ...tag,
      id: `placed-${index}:${tag.id}`,
      side: "target" as const,
      protected: true,
    }),
  );
}

/**
 * QuickPlace: drop the source's protected tags at the caret, in source order.
 * A collapsed pair stays collapsed at that offset.
 */
export function placeSourceTagsAtCaret(
  sourceTags: readonly InlineTag[],
  caret: number,
): InlineTag[] {
  const at = Math.max(0, caret);
  return sourceTags.map((tag, index) => ({
    ...tag,
    id: `placed-${index}:${tag.id}`,
    side: "target" as const,
    position: at,
    protected: true,
  }));
}

export function tagFingerprint(tag: InlineTag): string {
  return `${tag.kind}\0${tag.displayText}\0${tag.payload}`;
}

/** Put a start/end pair around the current target selection. */
export function wrapSelectionWithTagPair(
  startTag: InlineTag,
  endTag: InlineTag,
  from: number,
  to: number,
): InlineTag[] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.max(from, to);
  return [
    {
      ...startTag,
      id: `placed-s:${startTag.id}`,
      side: "target",
      position: lo,
      protected: true,
    },
    {
      ...endTag,
      id: `placed-e:${endTag.id}`,
      side: "target",
      position: hi,
      protected: true,
    },
  ];
}

export function mergeTargetTags(
  existing: readonly InlineTag[],
  incoming: readonly InlineTag[],
): InlineTag[] {
  const incomingKeys = new Set(incoming.map(tagFingerprint));
  return [...existing.filter((tag) => !incomingKeys.has(tagFingerprint(tag))), ...incoming].sort(
    (left, right) => {
      if (left.position !== right.position) return left.position - right.position;
      const rank = (tag: InlineTag) =>
        tag.kind === "start" ? 0 : tag.kind === "standalone" ? 1 : 2;
      return rank(left) - rank(right);
    },
  );
}

export function insertTextIntoTagged(
  text: string,
  tags: readonly InlineTag[],
  caret: number,
  insert: string,
): SerializedTaggedText {
  const characters = [...text];
  const at = Math.max(0, Math.min(caret, characters.length));
  const next = `${characters.slice(0, at).join("")}${insert}${characters.slice(at).join("")}`;
  const shift = [...insert].length;
  return {
    text: next,
    tags: tags.map((tag) => {
      // A start sits before the caret: typing at its offset goes inside the
      // pair. An end or placeholder at the same offset is pushed forward.
      const moves = tag.kind === "start" ? tag.position > at : tag.position >= at;
      return moves ? { ...tag, position: tag.position + shift } : tag;
    }),
  };
}

/** Drop the selected character range. Tags strictly inside the range go away. */
export function deleteRangeFromTagged(
  text: string,
  tags: readonly InlineTag[],
  from: number,
  to: number,
): SerializedTaggedText {
  const characters = [...text];
  const lo = Math.max(0, Math.min(from, to, characters.length));
  const hi = Math.max(0, Math.min(Math.max(from, to), characters.length));
  const next = `${characters.slice(0, lo).join("")}${characters.slice(hi).join("")}`;
  const removed = hi - lo;
  return {
    text: next,
    tags: tags
      .filter((tag) => tag.position <= lo || tag.position >= hi)
      .map((tag) =>
        tag.position >= hi ? { ...tag, position: tag.position - removed } : tag,
      ),
  };
}

/** Replace the current selection (or insert at a collapsed caret). */
export function replaceSelectionInTagged(
  text: string,
  tags: readonly InlineTag[],
  from: number,
  to: number,
  insert: string,
): SerializedTaggedText {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  if (lo === hi) return insertTextIntoTagged(text, tags, lo, insert);
  // A closer sitting on the selection start belongs to the run before it.
  // insertTextIntoTagged would otherwise pull the new text inside that pair.
  const closersAtStart = new Set(
    tags
      .filter((tag) => tag.kind === "end" && tag.position === lo)
      .map((tag) => tag.id),
  );
  const deleted = deleteRangeFromTagged(text, tags, lo, hi);
  const inserted = insertTextIntoTagged(deleted.text, deleted.tags, lo, insert);
  if (closersAtStart.size === 0) return inserted;
  return {
    text: inserted.text,
    tags: inserted.tags.map((tag) =>
      closersAtStart.has(tag.id) ? { ...tag, position: lo } : tag,
    ),
  };
}

/** Copy Source to Target: same offsets, target-side ids. */
export function copySourceTagsToTarget(
  sourceTags: readonly InlineTag[],
): InlineTag[] {
  return sourceTags.map((tag, index) => ({
    ...tag,
    id: `placed-copy:${index}:${tag.id}`,
    side: "target" as const,
    protected: true,
  }));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function encodeTag(tag: InlineTag): string {
  return encodeURIComponent(JSON.stringify(tag));
}

function decodeTag(value: string | null): InlineTag | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as InlineTag;
    if (!parsed.id || !parsed.kind) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isAtomSpan(element: HTMLElement): boolean {
  return Boolean(element.dataset.tag || element.dataset.ghost);
}

function capsuleHtml(tag: InlineTag, label: string, ghost: boolean): string {
  if (ghost) {
    const id = escapeHtml(tag.id);
    return `<span class="inline-tag inline-tag--ghost inline-tag--${tag.kind}" contenteditable="false" data-ghost="${id}" data-testid="ghost-tag-${id}" title="Place ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
  }
  return `<span class="inline-tag inline-tag--${tag.kind}" contenteditable="false" data-tag="${encodeTag(tag)}" title="${escapeHtml(tag.payload || label)}">${escapeHtml(label)}</span>`;
}

function wrapFormatted(textHtml: string, stack: string[]): string {
  if (!textHtml || stack.length === 0) return textHtml;
  const cls = formatRunClass(stack);
  return cls ? `<span class="${cls}">${textHtml}</span>` : textHtml;
}

/** HTML for a contenteditable target that treats tags as protected atoms. */
export function buildTaggedEditorHtml(
  text: string,
  tags: readonly InlineTag[],
  ghosts: readonly InlineTag[] = [],
): string {
  const pieces = splitTaggedText(text, tags, ghosts);
  if (pieces.length === 0) return "<br>";
  const stack: string[] = [];
  let html = "";
  for (const piece of pieces) {
    if (piece.kind === "text") {
      html += wrapFormatted(
        escapeHtml(piece.text).replaceAll("\n", "<br>"),
        stack,
      );
      continue;
    }
    const tag = piece.tag;
    if (!tag) continue;
    const tokens = formatTokens(tag.displayText);
    if (tag.kind === "end") {
      html += capsuleHtml(tag, piece.text, piece.kind === "ghost");
      for (const token of tokens) {
        const index = stack.lastIndexOf(token);
        if (index >= 0) stack.splice(index, 1);
      }
      continue;
    }
    html += capsuleHtml(tag, piece.text, piece.kind === "ghost");
    if (tag.kind === "start") stack.push(...tokens);
  }
  return text.length === 0 ? `${html}<br>` : html;
}

export function placeTagAtCaret(tag: InlineTag, caret: number): InlineTag {
  return {
    ...tag,
    id: `placed-g:${tag.id}`,
    side: "target",
    position: Math.max(0, caret),
    protected: true,
  };
}

function characterLength(value: string): number {
  return [...value].length;
}

/**
 * Walk a contenteditable root and recover engine text + tag offsets.
 * Tag atoms are `data-tag` spans and do not contribute to the text.
 */
export function serializeTaggedEditor(root: HTMLElement): SerializedTaggedText {
  const tags: InlineTag[] = [];
  let text = "";

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (isAtomSpan(element)) {
      if (element.dataset.tag) {
        const tag = decodeTag(element.dataset.tag);
        if (tag) {
          tags.push({ ...tag, position: characterLength(text), side: "target" });
        }
      }
      return;
    }
    if (element.tagName === "BR") {
      text += "\n";
      return;
    }
    for (const child of Array.from(element.childNodes)) {
      walk(child);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    walk(child);
  }

  if (text.endsWith("\n") && root.childNodes.length > 0) {
    const last = root.lastChild;
    if (last instanceof HTMLElement && last.tagName === "BR") {
      text = text.slice(0, -1);
    }
  }

  return { text, tags };
}

function textOffsetInNode(node: Node, offset: number): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return characterLength((node.textContent ?? "").slice(0, offset));
  }
  let count = 0;
  const children = Array.from(node.childNodes);
  for (let index = 0; index < Math.min(offset, children.length); index += 1) {
    const child = children[index];
    if (!child) continue;
    count += characterLength(child.textContent ?? "");
  }
  return count;
}

function precedingTextLength(root: HTMLElement, node: Node): number {
  let length = 0;
  const walk = (current: Node): boolean => {
    if (current === node) return true;
    if (current.nodeType === Node.TEXT_NODE) {
      length += characterLength(current.textContent ?? "");
      return false;
    }
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (isAtomSpan(element)) return false;
      if (element.tagName === "BR") {
        length += 1;
        return false;
      }
    }
    for (const child of Array.from(current.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };
  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) break;
  }
  return length;
}

/** Character offsets of the current selection inside a tagged editor. */
export function caretOffsetsInTaggedEditor(
  root: HTMLElement,
  selection: Selection | null,
): { start: number; end: number } {
  if (!selection || selection.rangeCount === 0) {
    const end = characterLength(serializeTaggedEditor(root).text);
    return { start: end, end };
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    const end = characterLength(serializeTaggedEditor(root).text);
    return { start: end, end };
  }
  const start =
    precedingTextLength(root, range.startContainer) +
    textOffsetInNode(range.startContainer, range.startOffset);
  const end = selection.isCollapsed
    ? start
    : precedingTextLength(root, range.endContainer) +
      textOffsetInNode(range.endContainer, range.endOffset);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function setCaretInTaggedEditor(
  root: HTMLElement,
  offset: number,
): void {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection) return;
  const target = Math.max(0, offset);
  let remaining = target;
  const range = root.ownerDocument.createRange();
  const place = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const chars = [...(node.textContent ?? "")];
      if (remaining <= chars.length) {
        range.setStart(node, [...chars.slice(0, remaining)].join("").length);
        range.collapse(true);
        return true;
      }
      remaining -= chars.length;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (isAtomSpan(element)) return false;
      if (element.tagName === "BR") {
        if (remaining === 0) {
          range.setStartBefore(element);
          range.collapse(true);
          return true;
        }
        remaining -= 1;
        return false;
      }
    }
    for (const child of Array.from(node.childNodes)) {
      if (place(child)) return true;
    }
    return false;
  };
  if (!place(root)) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}
