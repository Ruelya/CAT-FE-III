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
  theme: "dark",
  accentSeed: "#e0a458",
};

/** @deprecated P0 fixed name — default theme is the dark console. */
export const APPEARANCE_THEME = DEFAULT_APPEARANCE.theme;
/** @deprecated P0 fixed name — default seed is console amber. */
export const APPEARANCE_ACCENT = "console-amber" as const;

export const REQUIRED_TOKEN_VARS = [
  "--color-sunken",
  "--color-canvas",
  "--color-surface",
  "--color-raised",
  "--color-line",
  "--color-border",
  "--color-border-strong",
  "--color-text",
  "--color-text-muted",
  "--color-text-subtle",
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-active",
  "--color-accent-soft",
  "--color-on-accent",
  "--color-success",
  "--color-warning",
  "--color-error",
  "--color-info",
  "--color-focus",
  "--color-scrim",
  "--font-display",
  "--font-ui",
  "--font-mono",
  "--font-cjk",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--control-h-sm",
  "--z-dialog",
  "--motion-base",
] as const;

/**
 * Canonical surface ladder per theme.
 *
 * This is the single authority for the values that both `tokens.css` and the
 * runtime accent derivation depend on. `appearance.test.ts` reads the CSS text
 * and fails if the two ever disagree, so a colour can only be changed in one
 * place and then mirrored deliberately.
 */
export const THEME_SURFACES = {
  light: {
    sunken: "#d8dce2",
    canvas: "#e7eaef",
    surface: "#f2f4f7",
    raised: "#fcfdff",
    text: "#171c24",
  },
  dark: {
    sunken: "#0c0f14",
    canvas: "#13171e",
    surface: "#1c222b",
    raised: "#272f3a",
    text: "#e9edf4",
  },
} as const;

/** Candidate colours for text drawn on top of the accent fill. */
export const ON_ACCENT_CANDIDATES = {
  paper: "#fcfdff",
  ink: "#171c24",
} as const;

/** Body text on an accent fill must clear this ratio. */
export const MIN_ACCENT_TEXT_CONTRAST = 4.5;
/** Accent used as text, border, or focus ring must clear this ratio. */
export const MIN_ACCENT_SURFACE_CONTRAST = 4.5;
/** Focus indicator floor against every surface it can land on. */
export const MIN_FOCUS_CONTRAST = 3;

export const TOKEN_VALUES = {
  canvas: THEME_SURFACES.light.canvas,
  accent: "#e0a458",
  success: "#186a43",
  warning: "#7d4e0a",
  error: "#a92f39",
  darkCanvas: THEME_SURFACES.dark.canvas,
  darkSuccess: "#5fc493",
  darkWarning: "#dcab4d",
  darkError: "#f08e93",
} as const;

const HEX_SEED = /^#([0-9a-fA-F]{6})$/;

export function isDarkDefaultTheme(): boolean {
  return DEFAULT_APPEARANCE.theme === "dark";
}

export function isConsoleAmberAccent(): boolean {
  return DEFAULT_APPEARANCE.accentSeed.toLowerCase() === "#e0a458";
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
  const theme =
    record.theme === "dark"
      ? "dark"
      : record.theme === "light"
        ? "light"
        : null;
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
  storage:
    Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage,
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
  const seed =
    normalizeAccentSeed(preference.accentSeed) ?? DEFAULT_APPEARANCE.accentSeed;
  return JSON.stringify({
    version: 1,
    theme: preference.theme === "dark" ? "dark" : "light",
    accentSeed: seed,
  });
}

export function writeAppearancePreference(
  preference: RendererAppearancePreferenceV1,
  storage:
    Pick<Storage, "setItem"> | null | undefined = globalThis.localStorage,
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

/** Multiplying the channels preserves hue and relative chroma; mixing does not. */
function scaleChannels(rgb: Rgb, factor: number): Rgb {
  return { r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor };
}

/** Round through the 8-bit hex form so a token verified here still passes. */
function quantize(rgb: Rgb): Rgb {
  return hexToRgb(rgbToHex(rgb)) ?? rgb;
}

function surfacesFor(theme: AppearanceTheme): Rgb[] {
  const set = THEME_SURFACES[theme];
  return [set.canvas, set.surface, set.raised]
    .map((hex) => hexToRgb(hex))
    .filter((value): value is Rgb => value !== null);
}

/**
 * Lift or deepen a colour until it clears `minimum` against every surface,
 * keeping the seed hue.
 *
 * Multiplicative scaling is tried first because it preserves the channel
 * ratios, so a brown seed stays brown in dark mode instead of washing out to
 * grey. Scaling cannot rescue pure black in a dark theme or pure white in a
 * light theme, so a paper/ink mix is the bounded fallback.
 */
export function reachContrast(
  seed: Rgb,
  surfaces: readonly Rgb[],
  minimum: number,
  brighten: boolean,
): Rgb {
  const meets = (candidate: Rgb): boolean => {
    const rounded = quantize(candidate);
    return surfaces.every((s) => contrastRatio(rounded, s) >= minimum);
  };

  if (meets(seed)) return quantize(seed);

  let lo = 1;
  let hi = brighten ? 12 : 0;
  let scaled: Rgb | null = null;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = scaleChannels(seed, mid);
    if (meets(candidate)) {
      scaled = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (scaled) {
    // Step just past the boundary so 8-bit rounding cannot drop back under.
    const nudged = scaleChannels(seed, brighten ? hi * 1.02 : hi * 0.98);
    return quantize(meets(nudged) ? nudged : scaled);
  }

  const target = brighten
    ? (hexToRgb(ON_ACCENT_CANDIDATES.paper) ?? { r: 255, g: 255, b: 255 })
    : (hexToRgb(ON_ACCENT_CANDIDATES.ink) ?? { r: 0, g: 0, b: 0 });
  lo = 0;
  hi = 1;
  let mixed: Rgb | null = null;
  for (let i = 0; i < 22; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = mix(seed, target, mid);
    if (meets(candidate)) {
      mixed = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (mixed) {
    const nudged = mix(seed, target, Math.min(1, hi + 0.03));
    return quantize(meets(nudged) ? nudged : mixed);
  }
  return quantize(target);
}

/**
 * @deprecated Focus now reuses the accent, which already clears 4.5:1.
 * Retained so an external caller keeps compiling; prefer `reachContrast`.
 */
export function deriveAccessibleFocus(
  seed: Rgb,
  theme: AppearanceTheme,
  surfaces: readonly Rgb[],
): Rgb {
  return reachContrast(seed, surfaces, MIN_FOCUS_CONTRAST, theme === "dark");
}

export interface DerivedAccentPalette {
  accent: string;
  accentHover: string;
  accentActive: string;
  accentSoft: string;
  focus: string;
  textOnAccent: string;
}

/**
 * Theme-aware accent family.
 *
 * The accent itself is adjusted per theme, not only its hover and active
 * steps. The amber default already reads on the dark console, but a bright
 * seed is unreadable on light paper, so the light theme deepens it until it
 * clears 4.5:1 against canvas, surface, and raised, and dark mode lifts a
 * dark seed the same way. Hover and active then move away from the on-accent
 * text colour, which increases label contrast in both themes.
 */
export function deriveAccentPalette(
  seedHex: string,
  theme: AppearanceTheme,
): DerivedAccentPalette {
  const seed = hexToRgb(seedHex) ??
    hexToRgb(DEFAULT_APPEARANCE.accentSeed) ?? { r: 118, g: 88, b: 71 };
  const brighten = theme === "dark";
  const surfaces = surfacesFor(theme);
  const paper = hexToRgb(ON_ACCENT_CANDIDATES.paper)!;
  const ink = hexToRgb(ON_ACCENT_CANDIDATES.ink)!;

  const accent = reachContrast(
    seed,
    surfaces,
    MIN_ACCENT_SURFACE_CONTRAST,
    brighten,
  );
  const onAccent =
    contrastRatio(accent, paper) >= contrastRatio(accent, ink) ? paper : ink;
  const away = onAccent === paper ? ink : paper;
  const surface = hexToRgb(THEME_SURFACES[theme].surface)!;

  return {
    accent: rgbToHex(accent),
    accentHover: rgbToHex(quantize(mix(accent, away, 0.14))),
    accentActive: rgbToHex(quantize(mix(accent, away, 0.26))),
    accentSoft: rgbToHex(
      quantize(mix(surface, accent, brighten ? 0.22 : 0.14)),
    ),
    focus: rgbToHex(
      reachContrast(accent, surfaces, MIN_FOCUS_CONTRAST, brighten),
    ),
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
  root.style.setProperty("--color-on-accent", palette.textOnAccent);
  root.style.setProperty("--color-scheme", theme);
  return palette;
}

export function resetAppearance(
  storage:
    | Pick<Storage, "setItem" | "removeItem">
    | null
    | undefined = globalThis.localStorage,
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
