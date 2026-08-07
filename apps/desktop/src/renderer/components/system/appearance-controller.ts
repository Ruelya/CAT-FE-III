/**
 * Density + UI scale preferences (renderer-local, no IPC).
 * Orthogonal to workbench editor zoom (--editor-zoom).
 */

export type DensityPreference = "compact" | "standard" | "comfortable";

export const DENSITY_STORAGE_KEY = "translunar.density.v1";
export const UI_SCALE_STORAGE_KEY = "translunar.ui-scale.v1";

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.6;
export const UI_SCALE_DEFAULT = 1;

const DENSITIES: readonly DensityPreference[] = [
  "compact",
  "standard",
  "comfortable",
];

export function isDensityPreference(
  value: unknown,
): value is DensityPreference {
  return (
    value === "compact" || value === "standard" || value === "comfortable"
  );
}

export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return UI_SCALE_DEFAULT;
  const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
  // Round to 2 decimals to avoid float noise on slider
  return Math.round(clamped * 100) / 100;
}

export function readDensityPreference(
  storage: Pick<Storage, "getItem"> = localStorage,
): DensityPreference {
  const stored = storage.getItem(DENSITY_STORAGE_KEY);
  if (isDensityPreference(stored)) return stored;
  return "standard";
}

export function readUiScale(
  storage: Pick<Storage, "getItem"> = localStorage,
): number {
  const raw = storage.getItem(UI_SCALE_STORAGE_KEY);
  if (raw == null) return UI_SCALE_DEFAULT;
  const n = Number.parseFloat(raw);
  return clampUiScale(n);
}

export function applyDensity(
  density: DensityPreference,
  root: HTMLElement = document.documentElement,
): void {
  if (density === "standard") {
    delete root.dataset.density;
  } else {
    root.dataset.density = density;
  }
}

export function applyUiScale(
  scale: number,
  root: HTMLElement = document.documentElement,
): void {
  const next = clampUiScale(scale);
  root.style.setProperty("--ui-scale", String(next));
}

export function setDensityPreference(
  density: DensityPreference,
  options?: {
    storage?: Pick<Storage, "setItem">;
    root?: HTMLElement;
  },
): void {
  const storage = options?.storage ?? localStorage;
  const root = options?.root ?? document.documentElement;
  storage.setItem(DENSITY_STORAGE_KEY, density);
  applyDensity(density, root);
}

export function setUiScale(
  scale: number,
  options?: {
    storage?: Pick<Storage, "setItem">;
    root?: HTMLElement;
  },
): number {
  const storage = options?.storage ?? localStorage;
  const root = options?.root ?? document.documentElement;
  const next = clampUiScale(scale);
  storage.setItem(UI_SCALE_STORAGE_KEY, String(next));
  applyUiScale(next, root);
  return next;
}

export function bootstrapAppearance(options?: {
  storage?: Pick<Storage, "getItem" | "setItem">;
  root?: HTMLElement;
}): { density: DensityPreference; uiScale: number } {
  const storage = options?.storage ?? localStorage;
  const root = options?.root ?? document.documentElement;
  const density = readDensityPreference(storage);
  const uiScale = readUiScale(storage);
  applyDensity(density, root);
  applyUiScale(uiScale, root);
  return { density, uiScale };
}

export function cycleDensity(
  current: DensityPreference,
  direction: 1 | -1 = 1,
): DensityPreference {
  const index = DENSITIES.indexOf(current);
  const next = (index + direction + DENSITIES.length) % DENSITIES.length;
  return DENSITIES[next]!;
}

/** Percent display helper (0.8 → 80). */
export function uiScaleToPercent(scale: number): number {
  return Math.round(clampUiScale(scale) * 100);
}

export function percentToUiScale(percent: number): number {
  return clampUiScale(percent / 100);
}
