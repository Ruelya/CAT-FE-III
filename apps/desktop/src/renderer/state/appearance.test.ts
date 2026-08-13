import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  MIN_ACCENT_SURFACE_CONTRAST,
  MIN_ACCENT_TEXT_CONTRAST,
  MIN_FOCUS_CONTRAST,
  ON_ACCENT_CANDIDATES,
  THEME_SURFACES,
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
import type { AppearanceTheme, Rgb } from "./appearance";

const rendererRoot = join(process.cwd(), "src/renderer");
const tokensCss = readFileSync(join(rendererRoot, "tokens.css"), "utf8");
const entryCss = readFileSync(join(rendererRoot, "styles.css"), "utf8");
const indexHtml = readFileSync(join(rendererRoot, "index.html"), "utf8");
const themeBootJs = readFileSync(
  join(rendererRoot, "public/theme-boot.js"),
  "utf8",
);

const styleModules = readdirSync(join(rendererRoot, "styles"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => ({
    name,
    text: readFileSync(join(rendererRoot, "styles", name), "utf8"),
  }));
const moduleByName = new Map(styleModules.map((m) => [m.name, m.text]));
/** Every rule that ships, in cascade order, as one string. */
const allCss = [tokensCss, ...styleModules.map((m) => m.text)].join("\n");

/* ── Token parsing ──────────────────────────────────────── */

/** Read a custom property from a specific block of tokens.css. */
function tokenIn(block: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`missing token ${name}`);
  return match[1]!.trim();
}

function blockFor(theme: AppearanceTheme): string {
  const marker =
    theme === "light"
      ? ':root,\nhtml[data-theme="light"] {'
      : 'html[data-theme="dark"] {';
  const start = tokensCss.indexOf(marker);
  expect(start, `theme block for ${theme}`).toBeGreaterThanOrEqual(0);
  const end = tokensCss.indexOf("\n}", start);
  return tokensCss.slice(start, end);
}

const themeBlocks: Record<AppearanceTheme, string> = {
  light: blockFor("light"),
  dark: blockFor("dark"),
};

const rgb = (hex: string): Rgb => {
  const value = hexToRgb(hex);
  if (!value) throw new Error(`not a hex colour: ${hex}`);
  return value;
};

/** CIE L* from an sRGB hex string. */
function lstar(hex: string): number {
  const { r, g, b } = rgb(hex);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return y <= 216 / 24389 ? y * (24389 / 27) : Math.cbrt(y) * 116 - 16;
}

const ratio = (a: string, b: string): number => contrastRatio(rgb(a), rgb(b));

const THEMES: AppearanceTheme[] = ["light", "dark"];
const SURFACE_STEPS = ["sunken", "canvas", "surface", "raised"] as const;

/* ── Preference schema ──────────────────────────────────── */

describe("appearance-v1 preference", () => {
  it("defaults to light and the advanced brown seed", () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      version: 1,
      theme: "light",
      accentSeed: "#765847",
    });
    expect(isLightDefaultTheme()).toBe(true);
    expect(isAdvancedBrownAccent()).toBe(true);
  });

  it("parses valid preferences and falls back for malformed input", () => {
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

  it("serializes a canonical lower-case seed", () => {
    expect(
      serializeAppearancePreference({
        version: 1,
        theme: "light",
        accentSeed: "#AABBCC",
      }),
    ).toBe(
      JSON.stringify({ version: 1, theme: "light", accentSeed: "#aabbcc" }),
    );
  });

  it("applies DOM theme attributes and derived accent variables", () => {
    const el = document.createElement("div");
    applyAppearance({ version: 1, theme: "dark", accentSeed: "#224466" }, el);
    expect(el.dataset.theme).toBe("dark");
    expect(el.style.colorScheme).toBe("dark");
    expect(el.style.getPropertyValue("--color-accent")).toMatch(
      /^#[0-9a-f]{6}$/,
    );
    expect(el.style.getPropertyValue("--color-on-accent")).toMatch(/^#/);
    expect(el.style.getPropertyValue("--color-focus")).toMatch(/^#/);
  });
});

/* ── Token contract ─────────────────────────────────────── */

describe("design tokens", () => {
  it("declares every required token", () => {
    for (const name of REQUIRED_TOKEN_VARS) {
      expect(tokensCss, `token ${name}`).toContain(name);
    }
    expect(tokensCss).toMatch(/\[data-theme=["']dark["']\]/);
  });

  it("mirrors the surface ladder that the runtime derivation depends on", () => {
    for (const theme of THEMES) {
      for (const step of SURFACE_STEPS) {
        expect(
          tokenIn(themeBlocks[theme], `--color-${step}`),
          `${theme} --color-${step} must equal THEME_SURFACES`,
        ).toBe(THEME_SURFACES[theme][step]);
      }
      expect(tokenIn(themeBlocks[theme], "--color-text")).toBe(
        THEME_SURFACES[theme].text,
      );
    }
  });

  it("keeps at least 2.5 CIE L* between adjacent surface steps", () => {
    for (const theme of THEMES) {
      for (let i = 1; i < SURFACE_STEPS.length; i += 1) {
        const previous = THEME_SURFACES[theme][SURFACE_STEPS[i - 1]!];
        const current = THEME_SURFACES[theme][SURFACE_STEPS[i]!];
        const delta = Math.abs(lstar(current) - lstar(previous));
        expect(
          delta,
          `${theme} ${SURFACE_STEPS[i - 1]} to ${SURFACE_STEPS[i]} is ${delta.toFixed(2)} L*`,
        ).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it("keeps every text role at 4.5:1 on every surface", () => {
    for (const theme of THEMES) {
      const block = themeBlocks[theme];
      for (const role of ["text", "text-muted", "text-subtle"]) {
        const colour = tokenIn(block, `--color-${role}`);
        for (const step of SURFACE_STEPS) {
          const background = THEME_SURFACES[theme][step];
          expect(
            ratio(colour, background),
            `${theme} --color-${role} on --color-${step}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps control boundaries at 3:1 on every surface they sit on", () => {
    for (const theme of THEMES) {
      const block = themeBlocks[theme];
      for (const role of ["border", "border-strong"]) {
        const colour = tokenIn(block, `--color-${role}`);
        for (const step of ["canvas", "surface", "raised"] as const) {
          expect(
            ratio(colour, THEME_SURFACES[theme][step]),
            `${theme} --color-${role} on --color-${step}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("keeps semantic colours readable and independent of the accent", () => {
    for (const theme of THEMES) {
      const block = themeBlocks[theme];
      const accent = tokenIn(block, "--color-accent");
      for (const role of ["success", "warning", "error", "info"]) {
        const colour = tokenIn(block, `--color-${role}`);
        expect(
          colour,
          `${theme} --color-${role} must not equal the accent`,
        ).not.toBe(accent);
        for (const step of ["canvas", "surface"] as const) {
          expect(
            ratio(colour, THEME_SURFACES[theme][step]),
            `${theme} --color-${role} on --color-${step}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        const soft = tokenIn(block, `--color-${role}-soft`);
        expect(
          ratio(colour, soft),
          `${theme} --color-${role} on its soft background`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          ratio(THEME_SURFACES[theme].text, soft),
          `${theme} body text on --color-${role}-soft`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the brand data palette distinguishable", () => {
    const series = ["ochre", "lichen", "burnt", "teal", "dusk"] as const;
    for (const theme of THEMES) {
      const block = themeBlocks[theme];
      const values = series.map((name) =>
        tokenIn(block, `--color-series-${name}`),
      );
      for (const [index, value] of values.entries()) {
        expect(
          ratio(value, THEME_SURFACES[theme].surface),
          `${theme} --color-series-${series[index]} on surface`,
        ).toBeGreaterThanOrEqual(3);
      }
      const sorted = values.map(lstar).sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(
          sorted[i]! - sorted[i - 1]!,
          `${theme} series lightness separation`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("uses only the approved radius scale", () => {
    const declared = [
      ...tokensCss.matchAll(/--radius-[a-z]+:\s*([^;]+);/g),
    ].map((m) => m[1]!.trim());
    expect(declared.sort()).toEqual(["4px", "6px", "8px", "999px"]);
  });

  it("keeps the CSS accent family equal to the derived default palette", () => {
    // The pre-hydration paint uses the CSS values and the hydrated paint uses
    // the derived values. If they differ the theme visibly shifts on boot.
    for (const theme of THEMES) {
      const derived = deriveAccentPalette(DEFAULT_APPEARANCE.accentSeed, theme);
      const block = themeBlocks[theme];
      expect(tokenIn(block, "--color-accent"), `${theme} accent`).toBe(
        derived.accent,
      );
      expect(tokenIn(block, "--color-accent-hover"), `${theme} hover`).toBe(
        derived.accentHover,
      );
      expect(tokenIn(block, "--color-accent-active"), `${theme} active`).toBe(
        derived.accentActive,
      );
      expect(tokenIn(block, "--color-accent-soft"), `${theme} soft`).toBe(
        derived.accentSoft,
      );
      expect(tokenIn(block, "--color-on-accent"), `${theme} on-accent`).toBe(
        derived.textOnAccent,
      );
      expect(tokenIn(block, "--color-focus"), `${theme} focus`).toBe(
        derived.focus,
      );
    }
  });

  it("collapses motion tokens under reduced motion", () => {
    const reduced =
      /@media \(prefers-reduced-motion: reduce\)([\s\S]*?)\n}/.exec(tokensCss);
    expect(reduced).not.toBeNull();
    for (const name of ["--motion-fast", "--motion-base", "--motion-slow"]) {
      expect(reduced![1]).toContain(`${name}: 0ms`);
    }
  });
});

/* ── Accent derivation ──────────────────────────────────── */

describe("accent derivation", () => {
  const seeds = [
    "#765847",
    "#000000",
    "#ffffff",
    "#0a0a0a",
    "#99ffee",
    "#330000",
    "#ff00ff",
    "#336699",
    "#abcdef",
    "#d9562b",
  ] as const;

  it("stays readable for every seed in both themes", () => {
    for (const seed of seeds) {
      for (const theme of THEMES) {
        const palette = deriveAccentPalette(seed, theme);
        const surfaces = (["canvas", "surface", "raised"] as const).map(
          (step) => THEME_SURFACES[theme][step],
        );

        for (const surface of surfaces) {
          expect(
            ratio(palette.accent, surface),
            `accent ${palette.accent} on ${surface} for ${seed}/${theme}`,
          ).toBeGreaterThanOrEqual(MIN_ACCENT_SURFACE_CONTRAST);
          expect(
            ratio(palette.focus, surface),
            `focus ${palette.focus} on ${surface} for ${seed}/${theme}`,
          ).toBeGreaterThanOrEqual(MIN_FOCUS_CONTRAST);
        }

        for (const fill of [
          palette.accent,
          palette.accentHover,
          palette.accentActive,
        ]) {
          expect(
            ratio(palette.textOnAccent, fill),
            `on-accent text on ${fill} for ${seed}/${theme}`,
          ).toBeGreaterThanOrEqual(MIN_ACCENT_TEXT_CONTRAST);
        }

        expect(
          ratio(THEME_SURFACES[theme].text, palette.accentSoft),
          `body text on accent-soft for ${seed}/${theme}`,
        ).toBeGreaterThanOrEqual(4.5);

        expect(palette.textOnAccent).toMatch(
          new RegExp(
            `^(${ON_ACCENT_CANDIDATES.paper}|${ON_ACCENT_CANDIDATES.ink})$`,
          ),
        );
      }
    }
  });

  it("lifts a dark seed for the dark theme instead of reusing it", () => {
    const light = deriveAccentPalette("#765847", "light");
    const dark = deriveAccentPalette("#765847", "dark");
    expect(light.accent).toBe("#765847");
    expect(dark.accent).not.toBe("#765847");
    expect(lstar(dark.accent)).toBeGreaterThan(lstar(light.accent));
  });

  it("keeps the seed hue rather than washing it to grey", () => {
    const dark = deriveAccentPalette("#765847", "dark");
    const { r, g, b } = rgb(dark.accent);
    // A warm brown must stay warm: red dominant, blue lowest.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("keeps semantic constants independent of the accent", () => {
    expect(TOKEN_VALUES.success).not.toBe(TOKEN_VALUES.accent);
    expect(TOKEN_VALUES.warning).not.toBe(TOKEN_VALUES.accent);
    expect(TOKEN_VALUES.error).not.toBe(TOKEN_VALUES.accent);
  });
});

/* ── Stylesheet contract ────────────────────────────────── */

describe("stylesheet contract", () => {
  it("imports every style module exactly once, in cascade order", () => {
    const imported = [
      ...entryCss.matchAll(/@import "\.\/styles\/([\w-]+\.css)"/g),
    ].map((m) => m[1]!);
    expect(entryCss).toContain('@import "./tokens.css"');
    expect(new Set(imported).size).toBe(imported.length);
    expect(new Set(imported)).toEqual(new Set(moduleByName.keys()));
    expect(imported.indexOf("base.css")).toBeLessThan(
      imported.indexOf("primitives.css"),
    );
    expect(imported.indexOf("primitives.css")).toBeLessThan(
      imported.indexOf("shell.css"),
    );
  });

  it("forbids glass material anywhere in the renderer stylesheet", () => {
    expect(allCss).not.toMatch(/backdrop-filter/i);
    expect(allCss).not.toMatch(/-webkit-backdrop-filter/i);
  });

  it("bundles all four type roles locally with swap", () => {
    const fonts = moduleByName
      .get("fonts.css")!
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const family of [
      "Translunar Space Grotesk",
      "Translunar Chivo",
      "Translunar Space Mono",
      "Translunar Noto Sans SC",
    ]) {
      expect(fonts).toContain(family);
    }
    expect(fonts).not.toMatch(/https?:\/\//);
    const faces = fonts.match(/@font-face/g) ?? [];
    const swaps = fonts.match(/font-display:\s*swap/g) ?? [];
    expect(swaps.length).toBe(faces.length);
    // The 7.78 MB CJK face is range-scoped so Latin sessions never fetch it.
    expect(fonts).toMatch(/Translunar Noto Sans SC[\s\S]*unicode-range/);
  });

  it("keeps the title strip drag regions and token-only window controls", () => {
    const shell = moduleByName.get("shell.css")!;
    expect(shell).toMatch(/\.app-chrome\s*\{[^}]*-webkit-app-region:\s*drag/s);
    expect(shell).toMatch(
      /\.app-chrome__actions\s*\{[^}]*-webkit-app-region:\s*no-drag/s,
    );
    expect(shell).toMatch(
      /\.window-controls\s*\{[^}]*-webkit-app-region:\s*no-drag/s,
    );
    expect(shell).toMatch(
      /\.app-chrome\s*\{[^}]*background:\s*var\(--color-surface\)/s,
    );
    expect(shell).toMatch(
      /data-window-chrome=["']macos["'][^}]*padding-left:\s*78px/s,
    );
    expect(shell).toMatch(
      /\.window-controls__btn--close:active\s*\{[^}]*color-mix\(\s*in\s+srgb\s*,\s*var\(--color-error\)[^)]*var\(--color-text\)/s,
    );
    expect(shell).not.toMatch(
      /\.window-controls__btn--close:active\s*\{[^}]*#000\b/s,
    );
  });

  it("gives the Workbench body an explicit grow track", () => {
    // Regression: an implicit grid row pushed the segment grid to the bottom
    // of the viewport and left a void in the middle of the editor.
    const workbench = moduleByName.get("workbench.css")!;
    expect(workbench).toMatch(/\.workbench\s*\{[^}]*display:\s*flex/s);
    expect(workbench).toMatch(/\.workbench\s*\{[^}]*flex-direction:\s*column/s);
    expect(workbench).toMatch(/\.workbench__body\s*\{[^}]*flex:\s*1 1 auto/s);
    expect(workbench).toMatch(/\.workbench__body\s*\{[^}]*min-height:\s*0/s);
  });
});

/* ── First paint ────────────────────────────────────────── */

describe("first paint", () => {
  it("matches the token canvas and text for both themes", () => {
    const html = indexHtml.toLowerCase();
    expect(html).toContain(THEME_SURFACES.light.canvas);
    expect(html).toContain(THEME_SURFACES.light.text);
    expect(html).toContain(THEME_SURFACES.dark.canvas);
    expect(html).toContain(THEME_SURFACES.dark.text);
  });

  it("sets the persisted theme before the body is parsed", () => {
    // A blocking classic script in <head>, not a deferred module, and not
    // inline, so `script-src 'self'` still holds.
    expect(indexHtml).toMatch(
      /<head>[\s\S]*<script src="\/theme-boot\.js"><\/script>[\s\S]*<\/head>/,
    );
    expect(indexHtml).not.toMatch(/<script>[\s\S]*localStorage/);
    expect(themeBootJs).toContain(APPEARANCE_STORAGE_KEY);
    expect(themeBootJs).toContain('setAttribute("data-theme", "dark")');
  });
});
