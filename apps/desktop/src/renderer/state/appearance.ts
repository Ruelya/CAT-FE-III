/**
 * Fixed P0 appearance defaults.
 * Theme/accent are not user-configurable and are never written to storage.
 */

export const APPEARANCE_THEME = "light" as const;
export const APPEARANCE_ACCENT = "advanced-brown" as const;

/** CSS custom properties required by the P0 token contract. */
export const REQUIRED_TOKEN_VARS = [
  "--color-canvas",
  "--color-surface",
  "--color-surface-raised",
  "--color-surface-subtle",
  "--color-border",
  "--color-border-strong",
  "--color-text",
  "--color-text-muted",
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-active",
  "--color-accent-soft",
  "--color-success",
  "--color-warning",
  "--color-error",
  "--color-focus",
] as const;

/** Canonical token values (lowercase hex) for contract tests. AA on surface-subtle. */
export const TOKEN_VALUES = {
  canvas: "#f4f1ec",
  accent: "#765847",
  success: "#1f5c3c",
  warning: "#7a4f0f",
  error: "#a83f3f",
} as const;

export function isLightDefaultTheme(): boolean {
  return APPEARANCE_THEME === "light";
}

export function isAdvancedBrownAccent(): boolean {
  return APPEARANCE_ACCENT === "advanced-brown";
}
