import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  contrastRatio,
  deriveAccentPalette,
  hexToRgb,
  isAdvancedBrownAccent,
  isLightDefaultTheme,
  parseAppearancePreference,
  readAppearancePreference,
  REQUIRED_TOKEN_VARS,
  serializeAppearancePreference,
  TOKEN_VALUES,
  writeAppearancePreference,
} from "./appearance";

const rendererRoot = join(process.cwd(), "src/renderer");
const tokensCss = readFileSync(join(rendererRoot, "tokens.css"), "utf8");
const stylesCss = readFileSync(join(rendererRoot, "styles.css"), "utf8");
const indexHtml = readFileSync(join(rendererRoot, "index.html"), "utf8");

describe("appearance-v1", () => {
  it("defaults to light + advanced brown", () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      version: 1,
      theme: "light",
      accentSeed: "#765847",
    });
    expect(isLightDefaultTheme()).toBe(true);
    expect(isAdvancedBrownAccent()).toBe(true);
  });

  it("parses valid preferences and falls back for malformed", () => {
    expect(
      parseAppearancePreference({
        version: 1,
        theme: "dark",
        accentSeed: "#112233",
      }),
    ).toEqual({ version: 1, theme: "dark", accentSeed: "#112233" });
    expect(parseAppearancePreference({ version: 2, theme: "dark" })).toEqual(
      DEFAULT_APPEARANCE,
    );
    expect(parseAppearancePreference({ version: 1, theme: "neon" })).toEqual(
      DEFAULT_APPEARANCE,
    );
    expect(
      parseAppearancePreference({
        version: 1,
        theme: "light",
        accentSeed: "nope",
      }),
    ).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearancePreference(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it("reads storage and recovers from exceptions", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    expect(readAppearancePreference(storage)).toEqual(DEFAULT_APPEARANCE);
    writeAppearancePreference(
      { version: 1, theme: "dark", accentSeed: "#ABCDEF" },
      storage,
    );
    expect(readAppearancePreference(storage)).toEqual({
      version: 1,
      theme: "dark",
      accentSeed: "#abcdef",
    });
    store.set(APPEARANCE_STORAGE_KEY, "{not-json");
    expect(readAppearancePreference(storage)).toEqual(DEFAULT_APPEARANCE);

    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readAppearancePreference(throwing)).toEqual(DEFAULT_APPEARANCE);
  });

  it("derives readable accent and keeps semantic independence", () => {
    const light = deriveAccentPalette("#765847", "light");
    const dark = deriveAccentPalette("#88ccff", "dark");
    const seed = hexToRgb("#765847")!;
    const onAccent = hexToRgb(light.textOnAccent)!;
    expect(contrastRatio(seed, onAccent)).toBeGreaterThanOrEqual(3);
    expect(light.accent).toBe("#765847");
    expect(dark.accent).toBe("#88ccff");
    expect(TOKEN_VALUES.success).not.toBe(TOKEN_VALUES.accent);
    expect(TOKEN_VALUES.warning).not.toBe(TOKEN_VALUES.accent);
    expect(TOKEN_VALUES.error).not.toBe(TOKEN_VALUES.accent);
  });

  it("enforces focus ≥3:1 on canvas/raised for extreme seeds", () => {
    const lightCanvas = hexToRgb(TOKEN_VALUES.canvas)!;
    const lightSurface = { r: 251, g: 250, b: 247 };
    const lightRaised = { r: 255, g: 253, b: 249 };
    const darkCanvas = hexToRgb(TOKEN_VALUES.darkCanvas)!;
    const darkSurface = { r: 36, g: 30, b: 26 };
    const darkRaised = { r: 44, g: 37, b: 32 };

    const seeds = [
      "#000000",
      "#ffffff",
      "#99ffee",
      "#330000",
      "#ff00ff",
      "#765847",
    ] as const;

    for (const seed of seeds) {
      for (const theme of ["light", "dark"] as const) {
        const palette = deriveAccentPalette(seed, theme);
        const focus = hexToRgb(palette.focus)!;
        const onAccent = hexToRgb(palette.textOnAccent)!;
        const accent = hexToRgb(palette.accent)!;
        const surfaces =
          theme === "light"
            ? [lightCanvas, lightSurface, lightRaised]
            : [darkCanvas, darkSurface, darkRaised];
        for (const surface of surfaces) {
          expect(
            contrastRatio(focus, surface),
            `focus ${palette.focus} vs surface for ${seed}/${theme}`,
          ).toBeGreaterThanOrEqual(3);
        }
        expect(
          contrastRatio(accent, onAccent),
          `text-on-accent for ${seed}/${theme}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }

    // Semantic tokens are fixed and independent of custom accent seed.
    expect(TOKEN_VALUES.success).toBe("#1f5c3c");
    expect(TOKEN_VALUES.warning).toBe("#7a4f0f");
    expect(TOKEN_VALUES.error).toBe("#a83f3f");
    const cyan = deriveAccentPalette("#99ffee", "light");
    expect(cyan.accent).toBe("#99ffee");
    expect(cyan.focus).not.toBe("#99ffee");
  });

  it("applies DOM theme attributes", () => {
    const el = document.createElement("div");
    applyAppearance(
      { version: 1, theme: "dark", accentSeed: "#224466" },
      el,
    );
    expect(el.dataset.theme).toBe("dark");
    expect(el.style.colorScheme).toBe("dark");
    expect(el.style.getPropertyValue("--color-accent")).toBe("#224466");
    expect(el.style.getPropertyValue("--color-text-on-accent")).toMatch(/^#/);
  });

  it("defines required tokens including dark theme and text-on-accent", () => {
    for (const name of REQUIRED_TOKEN_VARS) {
      expect(tokensCss).toContain(name);
    }
    expect(tokensCss).toMatch(/\[data-theme=["']dark["']\]|:root\.theme-dark/);
    expect(tokensCss.toLowerCase()).toContain(TOKEN_VALUES.canvas);
    expect(tokensCss.toLowerCase()).toContain(TOKEN_VALUES.accent);
  });

  it("forbids glass material", () => {
    const combined = `${tokensCss}\n${stylesCss}`;
    expect(combined).not.toMatch(/backdrop-filter/i);
    expect(combined).not.toMatch(/-webkit-backdrop-filter/i);
  });

  it("keeps static light fallback in html for first paint", () => {
    expect(indexHtml).toMatch(/color-scheme:\s*light/i);
    expect(indexHtml.toLowerCase()).toContain("#f4f1ec");
  });

  it("serializes canonical lower-case seed", () => {
    expect(
      serializeAppearancePreference({
        version: 1,
        theme: "light",
        accentSeed: "#AABBCC",
      }),
    ).toBe(
      JSON.stringify({
        version: 1,
        theme: "light",
        accentSeed: "#aabbcc",
      }),
    );
  });
});
