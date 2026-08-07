/**
 * Single source of truth for app color theme.
 * Preference: light | dark | system → resolved data-theme on <html>.
 * Persists under translunar.theme.v1 (extends prior light|dark domain with system).
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "translunar.theme.v1";

const PREFS: readonly ThemePreference[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(
  storage: Pick<Storage, "getItem"> = localStorage,
  matchMedia: (query: string) => MediaQueryList = (q) =>
    window.matchMedia(q),
): ThemePreference {
  const stored = storage.getItem(THEME_STORAGE_KEY);
  if (isThemePreference(stored)) return stored;
  // Legacy: missing key → treat as system (matches OS at resolve time)
  if (stored === null) return "system";
  // Unknown garbage → system
  return "system";
}

export function resolveTheme(
  preference: ThemePreference,
  matchMedia: (query: string) => MediaQueryList = (q) =>
    window.matchMedia(q),
): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyResolvedTheme(
  resolved: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.theme = resolved;
}

export function persistThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(THEME_STORAGE_KEY, preference);
}

/** Apply preference: persist + resolve + set data-theme. */
export function setThemePreference(
  preference: ThemePreference,
  options?: {
    storage?: Pick<Storage, "getItem" | "setItem">;
    matchMedia?: (query: string) => MediaQueryList;
    root?: HTMLElement;
  },
): ResolvedTheme {
  const storage = options?.storage ?? localStorage;
  const matchMedia =
    options?.matchMedia ?? ((q: string) => window.matchMedia(q));
  const root = options?.root ?? document.documentElement;
  persistThemePreference(preference, storage);
  const resolved = resolveTheme(preference, matchMedia);
  applyResolvedTheme(resolved, root);
  return resolved;
}

/** Bootstrap from storage (call once at app start). */
export function bootstrapTheme(options?: {
  storage?: Pick<Storage, "getItem" | "setItem">;
  matchMedia?: (query: string) => MediaQueryList;
  root?: HTMLElement;
}): { preference: ThemePreference; resolved: ResolvedTheme } {
  const storage = options?.storage ?? localStorage;
  const matchMedia =
    options?.matchMedia ?? ((q: string) => window.matchMedia(q));
  const root = options?.root ?? document.documentElement;
  const preference = readThemePreference(storage, matchMedia);
  const resolved = resolveTheme(preference, matchMedia);
  applyResolvedTheme(resolved, root);
  return { preference, resolved };
}

/** Cycle light → dark → system → light (command palette / toolbar). */
export function cycleThemePreference(
  current: ThemePreference,
): ThemePreference {
  const index = PREFS.indexOf(current);
  return PREFS[(index + 1) % PREFS.length]!;
}

/** Toggle between light and dark only (legacy toolbar binary). */
export function toggleLightDark(current: ThemePreference): ThemePreference {
  const resolved =
    current === "system"
      ? resolveTheme("system")
      : current;
  return resolved === "dark" ? "light" : "dark";
}

export function subscribeSystemTheme(
  onChange: (resolved: ResolvedTheme) => void,
  matchMedia: (query: string) => MediaQueryList = (q) =>
    window.matchMedia(q),
): () => void {
  const mql = matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    onChange(mql.matches ? "dark" : "light");
  };
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
