import type { InlineTag } from "@translunar/contracts";

import { formatRunClass, formatTokens } from "./preview-markup";
import { tagFingerprint, tagLabel } from "./tagged-text";

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
  /** Trados shows formatting samples (bold/italic) instead of raw tag names. */
  formatClass?: string;
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
 * Trados lists opening and closing tags separately, then the tokens it
 * treats as placeables: dates, URLs, mail, numbers. Already-placed tags
 * drop out of the list. "All tags" is Auto-Insert Tags.
 */
export function extractPlaceables(
  sourceText: string,
  sourceTags: readonly InlineTag[],
  targetTags: readonly InlineTag[] = [],
): Placeable[] {
  const items: Placeable[] = [];
  const unmatched = unmatchedSourceTags(sourceTags, targetTags);
  const { pairs } = pairSourceTags(sourceTags);
  if (unmatched.length > 0) {
    items.push({
      id: "all-tags",
      kind: "all-tags",
      label: "All tags",
      tags: [...sourceTags],
    });
  }
  for (const tag of unmatched) {
    const pair = pairs.find(
      (entry) => entry.start.id === tag.id || entry.end.id === tag.id,
    );
    const formatClass = formatRunClass(formatTokens(tag.displayText));
    let label = tagLabel(tag);
    if (tag.kind === "start" && pair) {
      const span = [...sourceText]
        .slice(pair.start.position, pair.end.position)
        .join("")
        .trim();
      if (span) label = span;
    }
    items.push({
      id: `tag:${tag.id}`,
      kind: "tag",
      label,
      tags: [tag],
      ...(formatClass ? { formatClass } : {}),
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

/** Source tags the target has not yet carried. */
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

/**
 * Ghosts for an incomplete pair already on the target (Trados).
 *
 * Opening placed, closer missing → ghost closer follows the caret past the
 * opening. Closer placed, opening missing (deleted half) → ghost opening
 * sits at the caret, clamped in front of the closer. Neither placed → no
 * overlay; those tags stay in the QuickPlace list.
 */
export function pendingCloseGhosts(
  sourceTags: readonly InlineTag[],
  targetTags: readonly InlineTag[],
  caret: number,
  remembered: ReadonlyMap<string, number> = new Map(),
  textLength = Number.POSITIVE_INFINITY,
): InlineTag[] {
  const unmatched = new Set(
    unmatchedSourceTags(sourceTags, targetTags).map((tag) => tag.id),
  );
  const ghosts: InlineTag[] = [];
  for (const pair of pairSourceTags(sourceTags).pairs) {
    const startMissing = unmatched.has(pair.start.id);
    const endMissing = unmatched.has(pair.end.id);
    if (startMissing === endMissing) continue;
    if (endMissing) {
      const placed = targetTags.find(
        (tag) => tagFingerprint(tag) === tagFingerprint(pair.start),
      );
      const floor = placed?.position ?? 0;
      const held = remembered.get(pair.end.id) ?? floor;
      const follows = caret >= floor ? Math.max(held, caret) : held;
      const at = Math.min(Math.max(follows, floor), textLength);
      ghosts.push({ ...pair.end, position: at });
      continue;
    }
    const placed = targetTags.find(
      (tag) => tagFingerprint(tag) === tagFingerprint(pair.end),
    );
    const ceiling = Math.min(placed?.position ?? 0, textLength);
    const held = remembered.get(pair.start.id) ?? ceiling;
    const follows = caret <= ceiling ? caret : held;
    const at = Math.min(Math.max(follows, 0), ceiling);
    ghosts.push({ ...pair.start, position: at });
  }
  return ghosts;
}

const SHORTCUT_TOKENS: Record<string, string[]> = {
  b: ["b", "strong"],
  i: ["i", "em"],
  u: ["u"],
};

/** Source pair that Ctrl+B / Ctrl+I / Ctrl+U should apply (QuickInsert). */
export function formatPairForKey(
  sourceTags: readonly InlineTag[],
  key: string,
): TagPair | null {
  const tokens = SHORTCUT_TOKENS[key.toLowerCase()];
  if (!tokens) return null;
  return (
    pairSourceTags(sourceTags).pairs.find((pair) =>
      formatTokens(pair.start.displayText).some((token) => tokens.includes(token)),
    ) ?? null
  );
}
