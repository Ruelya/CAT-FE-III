/**
 * Active Axis — singleton residence marker for the Workbench surface.
 *
 * Exactly one `[data-axis="active"]` may appear under Workbench in normal
 * focused states. Parent owns residence precedence (row > chip > hidden).
 * Decorative only: does not own focus or keyboard behavior.
 *
 * Source: docs/design-ii/screens/workbench.md · Phase 2 design.md
 */

export type ActiveAxisVariant = "row" | "chip";

export interface ActiveAxisProps {
  /** Visual residence: left edge of row, or under-edge of filter chip. */
  variant: ActiveAxisVariant;
}

export function ActiveAxis({ variant }: ActiveAxisProps) {
  return (
    <span
      className={
        variant === "chip" ? "active-axis active-axis--chip" : "active-axis"
      }
      data-axis="active"
      data-axis-variant={variant}
      aria-hidden="true"
    />
  );
}
