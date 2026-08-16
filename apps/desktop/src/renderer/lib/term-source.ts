import type { TermMatch, Termbase, TermbaseMount } from "@translunar/contracts";

import { termHighlightRanges } from "../state/segment-intel";

/**
 * A painted span in source text. QuickPlace and term recognition both use
 * this so TaggedText can nest marks instead of fighting over one highlight.
 */
export interface TextHighlight {
  start: number;
  end: number;
  className: string;
  testId?: string;
  title?: string;
  onClick?: () => void;
}

/**
 * The translation Ctrl+Shift+L / a source underline should insert.
 *
 * Forbidden forms are the termbase saying what not to write, so they are
 * never the answer. Preferred wins when the entry has one; otherwise the
 * first allowed form is the one a translator would pick by hand.
 */
export function preferredTranslation(match: TermMatch): string | null {
  const allowed = match.translations.filter((item) => !item.forbidden);
  if (allowed.length === 0) return null;
  return (allowed.find((item) => item.preferred) ?? allowed[0])?.term ?? null;
}

/** Trados Termbase Search treats `*` as a wildcard; we treat it as "contains". */
export function normalizeTermQuery(query: string): string {
  return query.trim().replace(/\*/g, "").toLowerCase();
}

export function filterTermMatches(
  matches: readonly TermMatch[],
  query: string,
): TermMatch[] {
  const needle = normalizeTermQuery(query);
  if (!needle) return [...matches];
  return matches.filter(
    (match) =>
      match.sourceTerm.toLowerCase().includes(needle) ||
      match.translations.some((item) => item.term.toLowerCase().includes(needle)),
  );
}

export function mergeTermMatches(
  primary: readonly TermMatch[],
  extra: readonly TermMatch[],
): TermMatch[] {
  const seen = new Set(primary.map((match) => match.entryId));
  const merged = [...primary];
  for (const match of extra) {
    if (seen.has(match.entryId)) continue;
    seen.add(match.entryId);
    merged.push(match);
  }
  return merged;
}

/**
 * The longest recognised hit covering a painted range.
 *
 * Overlapping entries are merged into one underline so the source does not
 * look broken; a click still has to pick one term, and the longer phrase is
 * the one the translator meant.
 */
export function matchCoveringRange(
  matches: readonly TermMatch[],
  range: { start: number; end: number },
): TermMatch | null {
  const covering = matches.filter(
    (match) =>
      match.end > match.start &&
      match.start < range.end &&
      match.end > range.start,
  );
  if (covering.length === 0) return null;
  return (
    [...covering].sort(
      (left, right) => right.end - right.start - (left.end - left.start),
    )[0] ?? null
  );
}

/**
 * Walk the list the way repeated Ctrl+Shift+L should: insert this one, then
 * stand on the next insertable entry.
 */
export function nextInsertableTerm(
  matches: readonly TermMatch[],
  fromIndex: number,
): { index: number; translation: string } | null {
  if (matches.length === 0) return null;
  const start =
    ((fromIndex % matches.length) + matches.length) % matches.length;
  for (let step = 0; step < matches.length; step += 1) {
    const index = (start + step) % matches.length;
    const translation = preferredTranslation(matches[index]!);
    if (translation) return { index, translation };
  }
  return null;
}

/**
 * Source underlines only make sense for hits whose offsets live in the
 * current segment. A Termbase Search hit is scored against the query string,
 * so its start/end must not be painted onto the source.
 */
export function segmentSpanForTerm(
  term: TermMatch,
  recognized: readonly TermMatch[],
): { start: number; end: number } | null {
  const hit = recognized.find(
    (match) => match.entryId === term.entryId && match.end > match.start,
  );
  return hit ? { start: hit.start, end: hit.end } : null;
}

export function termSourceHighlights(
  matches: readonly TermMatch[],
  onInsert: (translation: string) => void,
): TextHighlight[] {
  return termHighlightRanges(matches).map((range) => {
    const match = matchCoveringRange(matches, range);
    const translation = match ? preferredTranslation(match) : null;
    const title = translation
      ? `${match?.sourceTerm ?? ""} → ${translation}`
      : match?.sourceTerm;
    return {
      start: range.start,
      end: range.end,
      className: "term-source-hit",
      testId: "term-source-hit",
      ...(title ? { title } : {}),
      ...(translation ? { onClick: () => onInsert(translation) } : {}),
    };
  });
}

/**
 * Split a text run so overlapping marks can nest instead of overwriting.
 *
 * Offsets are character counts, matching Engine term spans and the tagged
 * editor. A mark that only grazes this run is clipped to it.
 */
export function highlightSlices(
  text: string,
  baseOffset: number,
  highlights: readonly TextHighlight[],
): Array<{ text: string; highlights: TextHighlight[] }> {
  const characters = [...text];
  const lo = baseOffset;
  const hi = lo + characters.length;
  const local = highlights
    .map((mark) => ({
      ...mark,
      start: Math.max(lo, mark.start),
      end: Math.min(hi, mark.end),
    }))
    .filter((mark) => mark.end > mark.start);
  if (local.length === 0) return [{ text, highlights: [] }];

  const points = new Set<number>([lo, hi]);
  for (const mark of local) {
    points.add(mark.start);
    points.add(mark.end);
  }
  const sorted = [...points].sort((left, right) => left - right);
  const slices: Array<{ text: string; highlights: TextHighlight[] }> = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]!;
    const end = sorted[index + 1]!;
    if (end <= start) continue;
    slices.push({
      text: characters.slice(start - lo, end - lo).join(""),
      highlights: local.filter(
        (mark) => mark.start <= start && mark.end >= end,
      ),
    });
  }
  return slices.filter((slice) => slice.text.length > 0);
}

export function pickWritableTermbase(page: {
  items: readonly Pick<Termbase, "id" | "writable">[];
  mounts: readonly Pick<TermbaseMount, "termbaseId" | "enabled" | "writable">[];
}): { termbaseId: string; needsMount: boolean } | null {
  const writableMount = page.mounts.find(
    (mount) => mount.enabled && mount.writable,
  );
  if (writableMount) {
    return { termbaseId: writableMount.termbaseId, needsMount: false };
  }
  const writableItem = page.items.find((item) => item.writable);
  if (writableItem) {
    const mounted = page.mounts.some(
      (mount) => mount.termbaseId === writableItem.id && mount.enabled,
    );
    return { termbaseId: writableItem.id, needsMount: !mounted };
  }
  return null;
}
