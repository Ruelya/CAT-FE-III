/**
 * F6 hops focus between the segment grid and the intel dock.
 *
 * The dock's actions all have chords of their own (Ctrl+1..9 applies a match,
 * Ctrl+Shift+L inserts a term), but reading the dock with the keyboard -
 * arrowing through term hits, expanding an entry - needs focus to actually be
 * there, and reaching it through a dozen Tab stops teaches people to grab the
 * mouse. F6 is the pane-cycling key every IDE and Trados itself binds.
 */

/** What the hop did, so callers and tests can assert intent, not DOM detail. */
export type DockFocusMove = "editor" | "dock" | "expanded" | "none";

export function toggleDockFocus(input: {
  activeSegmentId: string | null;
  /** Dock is collapsed; first F6 expands it, the next one enters it. */
  collapsed: boolean;
  expand: () => void;
  root?: Document;
}): DockFocusMove {
  const doc = input.root ?? document;
  const dock = doc.querySelector<HTMLElement>('[data-testid="intel-dock"]');
  if (!dock) return "none";

  const active = doc.activeElement;
  if (active instanceof HTMLElement && dock.contains(active)) {
    const surface = input.activeSegmentId
      ? doc.querySelector<HTMLElement>(
          `[data-testid="target-surface-${input.activeSegmentId}"]`,
        )
      : null;
    if (!surface) return "none";
    surface.focus();
    return "editor";
  }

  if (input.collapsed) {
    input.expand();
    return "expanded";
  }

  // Prefer the term list: it is the one dock region whose keyboard story
  // (arrows, Insert, Enter) needs focus inside it. Fall back to the first
  // enabled control so F6 still lands somewhere useful on empty segments.
  const target =
    dock.querySelector<HTMLElement>('[data-testid="term-list"]') ??
    dock.querySelector<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), [tabindex='0']",
    );
  if (!target) return "none";
  target.focus();
  return "dock";
}
