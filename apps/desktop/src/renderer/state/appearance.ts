/**
 * Versioned renderer-local appearance preference (P4).
 * Never written to ProductShellSettings.
 */

export const APPEARANCE_STORAGE_KEY = "translunar.renderer.appearance.v1";

export type AppearanceTheme = "light" | "dark";

export interface RendererAppearancePreferenceV1 {
  version: 1;
  theme: AppearanceTheme;
  accentSeed: string;
}

export const DEFAULT_APPEARANCE: RendererAppearancePreferenceV1 = {
  version: 1,
  theme: "light",
  accentSeed: "#765847",
};

/** @deprecated P0 fixed name — default seed is advanced brown. */
export const APPEARANCE_THEME = DEFAULT_APPEARANCE.theme;
/** @deprecated P0 fixed name — default seed is advanced brown. */
export const APPEARANCE_ACCENT = "advanced-brown" as const;

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
  "--color-text-on-accent",
] as const;

export const TOKEN_VALUES = {
  canvas: "#f4f1ec",
  accent: "#765847",
  success: "#1f5c3c",
  warning: "#7a4f0f",
  error: "#a83f3f",
  darkCanvas: "#1a1613",
  darkSuccess: "#3d9b6a",
  darkWarning: "#d4a017",
  darkError: "#e07070",
} as const;

const HEX_SEED = /^#([0-9a-fA-F]{6})$/;

export function isLightDefaultTheme(): boolean {
  return DEFAULT_APPEARANCE.theme === "light";
}

export function isAdvancedBrownAccent(): boolean {
  return DEFAULT_APPEARANCE.accentSeed.toLowerCase() === "#765847";
}

export function normalizeAccentSeed(raw: string): string | null {
  const trimmed = raw.trim();
  const match = HEX_SEED.exec(trimmed);
  if (!match) return null;
  return `#${match[1]!.toLowerCase()}`;
}

export function parseAppearancePreference(
  value: unknown,
): RendererAppearancePreferenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_APPEARANCE };
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    return { ...DEFAULT_APPEARANCE };
  }
  const theme = record.theme === "dark" ? "dark" : record.theme === "light" ? "light" : null;
  const seed =
    typeof record.accentSeed === "string"
      ? normalizeAccentSeed(record.accentSeed)
      : null;
  if (!theme || !seed) {
    return { ...DEFAULT_APPEARANCE };
  }
  return { version: 1, theme, accentSeed: seed };
}

export function readAppearancePreference(
  storage: Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage,
): RendererAppearancePreferenceV1 {
  if (!storage) return { ...DEFAULT_APPEARANCE };
  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_KEY);
    if (raw === null || raw === undefined) return { ...DEFAULT_APPEARANCE };
    return parseAppearancePreference(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function serializeAppearancePreference(
  preference: RendererAppearancePreferenceV1,
): string {
  const seed = normalizeAccentSeed(preference.accentSeed) ?? DEFAULT_APPEARANCE.accentSeed;
  return JSON.stringify({
    version: 1,
    theme: preference.theme === "dark" ? "dark" : "light",
    accentSeed: seed,
  });
}

export function writeAppearancePreference(
  preference: RendererAppearancePreferenceV1,
  storage: Pick<Storage, "setItem"> | null | undefined = globalThis.localStorage,
): { ok: true } | { ok: false; error: string } {
  if (!storage) {
    return { ok: false, error: "Storage unavailable" };
  }
  try {
    storage.setItem(
      APPEARANCE_STORAGE_KEY,
      serializeAppearancePreference(preference),
    );
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to persist appearance" };
  }
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb | null {
  const seed = normalizeAccentSeed(hex);
  if (!seed) return null;
  const n = Number.parseInt(seed.slice(1), 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function shiftToward(rgb: Rgb, target: Rgb, amount: number): Rgb {
  return mix(rgb, target, amount);
}

/** Theme-solid focus tokens used when seed search cannot reach 3:1. */
export const FALLBACK_FOCUS: Record<AppearanceTheme, string> = {
  light: "#1d4ed8",
  dark: "#60a5fa",
};

const MIN_FOCUS_CONTRAST = 3;

function meetsFocusContrast(
  focus: Rgb,
  surfaces: readonly Rgb[],
): boolean {
  return surfaces.every((surface) => contrastRatio(focus, surface) >= MIN_FOCUS_CONTRAST);
}

/**
 * Bounded binary lightness search for a focus color that keeps seed hue/chroma
 * where possible while reaching ≥3:1 against every required solid surface.
 * Candidates are verified after 8-bit hex rounding so CSS tokens still pass.
 */
export function deriveAccessibleFocus(
  seed: Rgb,
  theme: AppearanceTheme,
  surfaces: readonly Rgb[],
): Rgb {
  const meetsAfterRound = (rgb: Rgb): boolean => {
    const rounded = hexToRgb(rgbToHex(rgb));
    return rounded !== null && meetsFocusContrast(rounded, surfaces);
  };

  if (meetsAfterRound(seed)) return seed;

  const lightTarget: Rgb = { r: 255, g: 255, b: 255 };
  const darkTarget: Rgb = { r: 0, g: 0, b: 0 };
  const directions: Rgb[] =
    theme === "dark" ? [lightTarget, darkTarget] : [darkTarget, lightTarget];

  let best: Rgb | null = null;
  let bestMin = 0;

  for (const target of directions) {
    let lo = 0;
    let hi = 1;
    let candidate: Rgb | null = null;
    for (let i = 0; i < 18; i += 1) {
      const mid = (lo + hi) / 2;
      const mixed = mix(seed, target, mid);
      if (meetsAfterRound(mixed)) {
        candidate = mixed;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    // Nudge past the boundary so 8-bit rounding cannot drop below 3:1.
    if (candidate) {
      const t = Math.min(1, Math.max(hi, lo) + 0.04);
      const nudged = mix(seed, target, t);
      if (meetsAfterRound(nudged)) candidate = nudged;
      else if (!meetsAfterRound(candidate)) candidate = null;
    }
    if (candidate && meetsAfterRound(candidate)) {
      const rounded = hexToRgb(rgbToHex(candidate))!;
      const minRatio = Math.min(
        ...surfaces.map((surface) => contrastRatio(rounded, surface)),
      );
      if (minRatio >= bestMin) {
        best = rounded;
        bestMin = minRatio;
      }
    }
  }

  if (best) return best;

  const fallback = hexToRgb(FALLBACK_FOCUS[theme]);
  if (fallback && meetsAfterRound(fallback)) return fallback;
  // Last resort: pure black/white for the theme.
  return theme === "dark" ? lightTarget : darkTarget;
}

export interface DerivedAccentPalette {
  accent: string;
  accentHover: string;
  accentActive: string;
  accentSoft: string;
  focus: string;
  textOnAccent: string;
}

export function deriveAccentPalette(
  seedHex: string,
  theme: AppearanceTheme,
): DerivedAccentPalette {
  const seed =
    hexToRgb(seedHex) ?? hexToRgb(DEFAULT_APPEARANCE.accentSeed) ?? {
      r: 118,
      g: 88,
      b: 71,
    };
  const white: Rgb = { r: 255, g: 253, b: 249 };
  const black: Rgb = { r: 38, g: 31, b: 26 };
  const onAccent =
    contrastRatio(seed, white) >= contrastRatio(seed, black) ? white : black;
  const towardText = onAccent === white ? black : white;
  const hover = shiftToward(seed, towardText, 0.12);
  const active = shiftToward(seed, towardText, 0.22);
  const surface: Rgb =
    theme === "dark"
      ? { r: 36, g: 30, b: 26 }
      : { r: 251, g: 250, b: 247 };
  const raised: Rgb =
    theme === "dark"
      ? { r: 44, g: 37, b: 32 }
      : { r: 255, g: 253, b: 249 };
  const soft = mix(surface, seed, theme === "dark" ? 0.28 : 0.18);
  const canvas: Rgb =
    theme === "dark"
      ? { r: 26, g: 22, b: 19 }
      : { r: 244, g: 241, b: 236 };
  const focus = deriveAccessibleFocus(seed, theme, [canvas, surface, raised]);
  return {
    accent: rgbToHex(seed),
    accentHover: rgbToHex(hover),
    accentActive: rgbToHex(active),
    accentSoft: rgbToHex(soft),
    focus: rgbToHex(focus),
    textOnAccent: rgbToHex(onAccent),
  };
}

export function applyAppearance(
  preference: RendererAppearancePreferenceV1,
  root: HTMLElement = document.documentElement,
): DerivedAccentPalette {
  const theme = preference.theme === "dark" ? "dark" : "light";
  const seed =
    normalizeAccentSeed(preference.accentSeed) ?? DEFAULT_APPEARANCE.accentSeed;
  const palette = deriveAccentPalette(seed, theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.setProperty("--color-accent-seed", seed);
  root.style.setProperty("--color-accent", palette.accent);
  root.style.setProperty("--color-accent-hover", palette.accentHover);
  root.style.setProperty("--color-accent-active", palette.accentActive);
  root.style.setProperty("--color-accent-soft", palette.accentSoft);
  root.style.setProperty("--color-focus", palette.focus);
  root.style.setProperty("--color-text-on-accent", palette.textOnAccent);
  root.style.setProperty("--color-scheme", theme);
  return palette;
}

export function resetAppearance(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined = globalThis.localStorage,
): RendererAppearancePreferenceV1 {
  const preference = { ...DEFAULT_APPEARANCE };
  if (storage) {
    try {
      storage.setItem(
        APPEARANCE_STORAGE_KEY,
        serializeAppearancePreference(preference),
      );
    } catch {
      /* keep in-memory default */
    }
  }
  return preference;
}
