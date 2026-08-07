import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyResolvedTheme,
  bootstrapTheme,
  cycleThemePreference,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  THEME_STORAGE_KEY,
  toggleLightDark,
} from "./theme-controller";

function mockStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    _map: map,
  };
}

function mockMatchMedia(dark: boolean) {
  return (query: string): MediaQueryList =>
    ({
      matches: query.includes("dark") ? dark : !dark,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as MediaQueryList;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("theme-controller", () => {
  it("validates preference union", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
  });

  it("reads stored preference including system", () => {
    const storage = mockStorage({ [THEME_STORAGE_KEY]: "system" });
    expect(readThemePreference(storage, mockMatchMedia(true))).toBe("system");
  });

  it("defaults missing key to system", () => {
    const storage = mockStorage();
    expect(readThemePreference(storage, mockMatchMedia(false))).toBe("system");
  });

  it("resolves system via matchMedia", () => {
    expect(resolveTheme("system", mockMatchMedia(true))).toBe("dark");
    expect(resolveTheme("system", mockMatchMedia(false))).toBe("light");
    expect(resolveTheme("dark", mockMatchMedia(false))).toBe("dark");
    expect(resolveTheme("light", mockMatchMedia(true))).toBe("light");
  });

  it("applies resolved theme to documentElement", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyResolvedTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("setThemePreference persists and applies", () => {
    const storage = mockStorage();
    const resolved = setThemePreference("dark", {
      storage,
      matchMedia: mockMatchMedia(false),
    });
    expect(resolved).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("bootstrapTheme returns preference + resolved", () => {
    const storage = mockStorage({ [THEME_STORAGE_KEY]: "system" });
    const result = bootstrapTheme({
      storage,
      matchMedia: mockMatchMedia(true),
    });
    expect(result.preference).toBe("system");
    expect(result.resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("cycles light → dark → system", () => {
    expect(cycleThemePreference("light")).toBe("dark");
    expect(cycleThemePreference("dark")).toBe("system");
    expect(cycleThemePreference("system")).toBe("light");
  });

  it("toggleLightDark flips binary", () => {
    expect(toggleLightDark("dark")).toBe("light");
    expect(toggleLightDark("light")).toBe("dark");
  });
});
