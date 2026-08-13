/**
 * Pure model for the command palette.
 *
 * Kept free of React and of the DesktopApi so the matching and grouping rules
 * are unit-testable, and so the palette can never become a second route
 * authority: it only emits intents that the app controller already exposes.
 */

export type CommandGroup = "Navigate" | "Project" | "Editor" | "View";

export interface PaletteCommand {
  id: string;
  label: string;
  group: CommandGroup;
  /** Extra words that should match without appearing in the label. */
  keywords?: string;
  /** Rendered right-aligned, for example a keyboard chord. */
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

export interface PaletteSection {
  group: CommandGroup;
  commands: PaletteCommand[];
}

const GROUP_ORDER: CommandGroup[] = ["Navigate", "Project", "Editor", "View"];

const WORD_BOUNDARY = /[\s./_-]/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Palette matching, ordered by tier so the obvious answer always wins:
 *
 *   1. the label starts with the query
 *   2. a word inside the label starts with the query
 *   3. the query is a subsequence, scored by how many characters land on a
 *      word boundary and how scattered the rest are
 *
 * That ordering is what makes "ss" resolve to "Search segments" rather than
 * "Assets snapshot". Lower is better; null means no match. Length breaks ties
 * so the shorter label wins.
 */
export function fuzzyScore(haystack: string, needle: string): number | null {
  if (needle.length === 0) return 0;
  const source = haystack.toLowerCase();
  const query = needle.toLowerCase();

  if (source.startsWith(query)) return source.length;
  if (new RegExp(`[\\s./_-]${escapeRegExp(query)}`).test(source)) {
    return 1_000 + source.length;
  }

  let penalty = 0;
  let from = 0;
  let previousIndex = -1;

  for (const character of query) {
    const index = source.indexOf(character, from);
    if (index === -1) return null;
    const atBoundary =
      index === 0 || WORD_BOUNDARY.test(source[index - 1] ?? "");
    // A character that does not start a word is the expensive case; a gap
    // between matches is a mild penalty and is capped so one long word cannot
    // dominate the score.
    if (!atBoundary) penalty += 10;
    if (previousIndex !== -1) {
      penalty += Math.min(index - previousIndex - 1, 5);
    }
    previousIndex = index;
    from = index + 1;
  }

  return 10_000 + penalty * 100 + source.length;
}

export function filterCommands(
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return commands.filter((c) => !c.disabled);

  const scored: Array<{ command: PaletteCommand; score: number }> = [];
  for (const command of commands) {
    if (command.disabled) continue;
    const target = command.keywords
      ? `${command.label} ${command.keywords}`
      : command.label;
    const score = fuzzyScore(target, trimmed);
    if (score !== null) scored.push({ command, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((entry) => entry.command);
}

export function groupCommands(
  commands: readonly PaletteCommand[],
): PaletteSection[] {
  const sections: PaletteSection[] = [];
  for (const group of GROUP_ORDER) {
    const matching = commands.filter((command) => command.group === group);
    if (matching.length > 0) sections.push({ group, commands: matching });
  }
  return sections;
}

/** Wrap the active index when the user runs past either end of the list. */
export function nextIndex(
  current: number,
  length: number,
  delta: number,
): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}
