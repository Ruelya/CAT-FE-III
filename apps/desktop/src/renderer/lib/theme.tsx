import { useSyncExternalStore } from "react";

import {
  DEFAULT_THEME_ID,
  defaultFxFor,
  isThemeId,
  THEME_FX_KEYS,
  themeOrDefault,
} from "@translunar/ui";
import type { ThemeDefinition, ThemeFx, ThemeFxKey } from "@translunar/ui";

/**
 * Theme state for the renderer.
 *
 * The theme is application-global rather than tree-scoped, so it lives in a
 * module store instead of a context: any component can read it without a
 * provider above it, and the store is the single writer of the attributes on
 * <html> that the CSS keys on.
 *
 * The reader's choice survives a restart in localStorage. Effect switches are
 * stored per theme — turning phosphor's scanlines off and then visiting
 * atelier must not turn atelier's grain off, and coming back to phosphor must
 * not turn the scanlines back on.
 */

const THEME_KEY = "translunar.theme";
const FX_KEY = "translunar.theme.fx";

type FxStore = Record<string, Partial<ThemeFx>>;

export interface ThemeState {
  theme: ThemeDefinition;
  /** Effects currently on, after the reader's overrides. */
  fx: ThemeFx;
  /** True while the OS asks for reduced motion; cinematic fx are suppressed. */
  reducedMotion: boolean;
}

function readThemeId(): string {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME_ID;
  } catch {
    /* Private mode or a locked-down profile: fall back rather than fail. */
    return DEFAULT_THEME_ID;
  }
}

function readFxStore(): FxStore {
  try {
    const raw = window.localStorage.getItem(FX_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FxStore) : {};
  } catch {
    return {};
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* A theme that cannot be remembered is still a theme worth showing. */
  }
}

/** A theme's defaults, with whatever the reader has since decided on top. */
export function resolveFx(theme: ThemeDefinition, store: FxStore): ThemeFx {
  const base = defaultFxFor(theme);
  const overrides = store[theme.id] ?? {};
  for (const key of THEME_FX_KEYS) {
    const override = overrides[key];
    if (typeof override === "boolean") {
      base[key] = override;
    }
  }
  return base;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

let themeId = readThemeId();
let fxStore = readFxStore();
let reducedMotion = prefersReducedMotion();
let snapshot: ThemeState = build();
const listeners = new Set<() => void>();

function build(): ThemeState {
  const theme = themeOrDefault(themeId);
  return { theme, fx: resolveFx(theme, fxStore), reducedMotion };
}

/*
 * One writer of the document attributes. `ambient` is cinematic by
 * definition, so the OS preference wins over the theme's signature — but only
 * for the attribute, never for the stored choice, or turning motion back on
 * would silently lose what the reader picked.
 */
function apply(state: ThemeState): void {
  const root = document.documentElement;
  root.dataset["theme"] = state.theme.id;
  for (const key of THEME_FX_KEYS) {
    const cinematic = key === "ambient";
    const on = state.fx[key] && !(cinematic && state.reducedMotion);
    root.setAttribute(`data-fx-${key}`, on ? "on" : "off");
  }
  /* The OS frame cannot wear a theme, but it can stop contradicting one. In
     unit tests window.tl is a partial stub, so this stays optional. */
  window.tl?.setNativeScheme?.(state.theme.scheme);
}

function commit(): void {
  snapshot = build();
  apply(snapshot);
  for (const listener of listeners) {
    listener();
  }
}

export function setThemeId(id: string): void {
  if (!isThemeId(id) || id === themeId) {
    return;
  }
  themeId = id;
  write(THEME_KEY, id);
  commit();
}

export function setFx(key: ThemeFxKey, on: boolean): void {
  const id = snapshot.theme.id;
  fxStore = { ...fxStore, [id]: { ...fxStore[id], [key]: on } };
  write(FX_KEY, JSON.stringify(fxStore));
  commit();
}

/** Drops the active theme's overrides and returns it to its signature. */
export function resetFx(): void {
  const next = { ...fxStore };
  delete next[snapshot.theme.id];
  fxStore = next;
  write(FX_KEY, JSON.stringify(fxStore));
  commit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window.matchMedia === "function") {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", () => {
    reducedMotion = query.matches;
    commit();
  });
}
apply(snapshot);

export interface ThemeControls extends ThemeState {
  setThemeId: (id: string) => void;
  setFx: (key: ThemeFxKey, on: boolean) => void;
  resetFx: () => void;
}

export function useTheme(): ThemeControls {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  return { ...state, setThemeId, setFx, resetFx };
}

/**
 * The effect layers.
 *
 * They are siblings of the app rather than children of any panel, so a
 * re-render cannot restart an animation, and they are always mounted — CSS
 * decides which is visible, which keeps the switch instant and the DOM
 * stable. All three are inert to the pointer.
 */
export function FxLayers() {
  return (
    <>
      <div className="fx-layer fx-layer--ambient" aria-hidden="true" />
      <div className="fx-layer fx-layer--grain" aria-hidden="true" />
      <div className="fx-layer fx-layer--scanlines" aria-hidden="true" />
    </>
  );
}
