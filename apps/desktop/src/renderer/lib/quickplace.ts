import type { InlineTag } from "@translunar/contracts";

import { tagFingerprint } from "./tagged-text";

export type PlaceableKind =
  | "all-tags"
  | "tag-pair"
  | "tag"
  | "number"
  | "date"
  | "email"
  | "url";

export interface Placeable {
  id: string;
  kind: PlaceableKind;
  label: string;
  text?: string;
  tags?: InlineTag[];
}

export interface TagPair {
  start: InlineTag;
  end: InlineTag;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /https?:\/\/[^\s]+/gi;
const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g;
const NUMBER = /\d+(?:[.,]\d+)?/g;

function lastMatchingStart(
  stack: InlineTag[],
  displayText: string,
): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]?.displayText === displayText) return index;
  }
  return -1;
}

export function pairSourceTags(tags: readonly InlineTag[]): {
  pairs: TagPair[];
  rest: InlineTag[];
} {
  const used = new Set<string>();
  const pairs: TagPair[] = [];
  const byPair = new Map<string, InlineTag[]>();
  for (const tag of tags) {
    if (!tag.pairId) continue;
    const group = byPair.get(tag.pairId) ?? [];
    group.push(tag);
    byPair.set(tag.pairId, group);
  }
  for (const group of byPair.values()) {
    const start = group.find((tag) => tag.kind === "start");
    const end = group.find((tag) => tag.kind === "end");
    if (!start || !end) continue;
    pairs.push({ start, end });
    used.add(start.id);
    used.add(end.id);
  }

  const stack: InlineTag[] = [];
  const rest: InlineTag[] = [];
  for (const tag of tags) {
    if (used.has(tag.id)) continue;
    if (tag.kind === "start") {
      stack.push(tag);
      continue;
    }
    if (tag.kind === "end") {
      const index = lastMatchingStart(stack, tag.displayText);
      if (index >= 0) {
        const start = stack.splice(index, 1)[0];
        if (start) pairs.push({ start, end: tag });
        continue;
      }
    }
    rest.push(tag);
  }
  rest.push(...stack);
  return { pairs, rest };
}

function collectSpans(
  source: string,
  pattern: RegExp,
): Array<{ text: string; start: number; end: number }> {
  const spans: Array<{ text: string; start: number; end: number }> = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match = re.exec(source);
  while (match) {
    const text = match[0];
    if (text) {
      spans.push({
        text,
        start: match.index,
        end: match.index + text.length,
      });
    }
    match = re.exec(source);
  }
  return spans;
}

function overlaps(
  start: number,
  end: number,
  taken: Array<{ start: number; end: number }>,
): boolean {
  return taken.some((span) => start < span.end && end > span.start);
}

/**
 * What Ctrl+, / the QuickPlace list can drop into the current target.
 *
 * Tags come first (the formatting the file will lose if they are skipped),
 * then the tokens Trados treats as placeables: dates, URLs, mail, numbers.
 */
export function extractPlaceables(
  sourceText: string,
  sourceTags: readonly InlineTag[],
): Placeable[] {
  const items: Placeable[] = [];
  if (sourceTags.length > 0) {
    items.push({
      id: "all-tags",
      kind: "all-tags",
      label: "All tags",
      tags: [...sourceTags],
    });
  }
  const { pairs, rest } = pairSourceTags(sourceTags);
  for (const pair of pairs) {
    items.push({
      id: `pair:${pair.start.id}:${pair.end.id}`,
      kind: "tag-pair",
      label: pair.start.displayText || "tag",
      tags: [pair.start, pair.end],
    });
  }
  for (const tag of rest) {
    items.push({
      id: `tag:${tag.id}`,
      kind: "tag",
      label: tag.displayText || tag.payload || "tag",
      tags: [tag],
    });
  }

  const taken: Array<{ start: number; end: number }> = [];
  const pushTokens = (
    kind: PlaceableKind,
    spans: Array<{ text: string; start: number; end: number }>,
  ) => {
    for (const span of spans) {
      if (overlaps(span.start, span.end, taken)) continue;
      taken.push(span);
      items.push({
        id: `${kind}:${span.start}:${span.text}`,
        kind,
        label: span.text,
        text: span.text,
      });
    }
  };
  pushTokens("date", collectSpans(sourceText, DATE));
  pushTokens("url", collectSpans(sourceText, URL));
  pushTokens("email", collectSpans(sourceText, EMAIL));
  pushTokens("number", collectSpans(sourceText, NUMBER));
  return items;
}

/** Source tags the target has not yet carried. Shown as ghost capsules. */
export function unmatchedSourceTags(
  sourceTags: readonly InlineTag[],
  targetTags: readonly InlineTag[],
): InlineTag[] {
  const remaining = new Map<string, number>();
  for (const tag of targetTags) {
    const key = tagFingerprint(tag);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const ghosts: InlineTag[] = [];
  for (const tag of sourceTags) {
    const key = tagFingerprint(tag);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      ghosts.push(tag);
    }
  }
  return ghosts;
}
