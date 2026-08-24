import type { SegmentEditorRow } from "@translunar/contracts";

/**
 * The second way an editor gets used: not translating from the top, but
 * pulling the segments that need attention out of a document someone else
 * already worked on. Without it, reviewing a 400-segment file means scrolling
 * it.
 */
export interface DisplayFilter {
  /** Confirmation states to keep. Empty means every state. */
  states: string[];
  /** Only segments that carry at least one comment. */
  withComments: boolean;
  /** Only segments that carry at least one QA finding. */
  withQaIssues: boolean;
  /** Only segments whose source text repeats elsewhere in the document. */
  repeatsOnly: boolean;
  /** Substring or pattern to look for. */
  text: string;
  /** Which side `text` applies to. */
  field: "source" | "target" | "both";
  /** Treat `text` as a regular expression. */
  regex: boolean;
}

export const EMPTY_FILTER: DisplayFilter = {
  states: [],
  withComments: false,
  withQaIssues: false,
  repeatsOnly: false,
  text: "",
  field: "both",
  regex: false,
};

export function isFilterActive(filter: DisplayFilter): boolean {
  return (
    filter.states.length > 0 ||
    filter.withComments ||
    filter.withQaIssues ||
    filter.repeatsOnly ||
    filter.text.trim().length > 0
  );
}

/**
 * Extra per-segment facts the filter needs that a row does not carry.
 *
 * Comment and QA counts come from separate Engine queries, so they are passed
 * in rather than fetched here: a filter that issues network calls while the
 * user types is a filter that stutters.
 */
export interface FilterContext {
  commentCounts: Readonly<Record<string, number>>;
  qaCounts: Readonly<Record<string, number>>;
}

export const EMPTY_FILTER_CONTEXT: FilterContext = {
  commentCounts: {},
  qaCounts: {},
};

/** Source texts that appear more than once, normalised the way the Engine does. */
export function repeatedSources(
  rows: readonly SegmentEditorRow[],
): ReadonlySet<string> {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = row.segment.sourceText.trim();
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const repeats = new Set<string>();
  for (const [key, count] of seen) {
    if (count > 1) repeats.add(key);
  }
  return repeats;
}

function buildMatcher(
  filter: DisplayFilter,
): ((value: string) => boolean) | null {
  const needle = filter.text.trim();
  if (!needle) return null;
  if (!filter.regex) {
    const lower = needle.toLowerCase();
    return (value) => value.toLowerCase().includes(lower);
  }
  try {
    const expression = new RegExp(needle, "iu");
    return (value) => expression.test(value);
  } catch {
    // An unfinished expression is a normal state while typing one. Matching
    // nothing is honest; throwing would blank the grid mid-keystroke.
    return () => false;
  }
}

/** Apply the filter, preserving document order. */
export function applyDisplayFilter(
  rows: readonly SegmentEditorRow[],
  filter: DisplayFilter,
  context: FilterContext = EMPTY_FILTER_CONTEXT,
): SegmentEditorRow[] {
  if (!isFilterActive(filter)) return [...rows];
  const matcher = buildMatcher(filter);
  const repeats = filter.repeatsOnly ? repeatedSources(rows) : null;

  return rows.filter((row) => {
    const segment = row.segment;
    if (filter.states.length > 0 && !filter.states.includes(segment.state)) {
      return false;
    }
    if (filter.withComments && (context.commentCounts[segment.id] ?? 0) === 0) {
      return false;
    }
    if (filter.withQaIssues && (context.qaCounts[segment.id] ?? 0) === 0) {
      return false;
    }
    if (repeats && !repeats.has(segment.sourceText.trim())) {
      return false;
    }
    if (matcher) {
      const source = filter.field !== "target" && matcher(segment.sourceText);
      const target = filter.field !== "source" && matcher(segment.targetText);
      if (!source && !target) return false;
    }
    return true;
  });
}

/**
 * True when jumping to `segmentId` requires dropping the filter to be seen.
 *
 * Go To and find hits target the whole document, not the filtered view. When
 * the target row is excluded, jumping to it while the filter stands turns the
 * command into a silent no-op: the row becomes active but is not on screen.
 * The filter must never lie about what matches, so the resolution is to clear
 * it — visibly, at the filter bar — rather than splice non-matching rows in.
 */
export function jumpNeedsFilterClear(
  filter: DisplayFilter,
  visible: readonly SegmentEditorRow[],
  segmentId: string,
): boolean {
  if (!isFilterActive(filter)) return false;
  return !visible.some((row) => row.segment.id === segmentId);
}

/** One-line description of what is currently being shown. */
export function describeFilter(
  filter: DisplayFilter,
  shown: number,
  total: number,
): string {
  if (!isFilterActive(filter)) return `${total} segments`;
  return `${shown} of ${total} segments`;
}
