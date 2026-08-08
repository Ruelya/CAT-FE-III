import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  APPEARANCE_ACCENT,
  APPEARANCE_THEME,
  isAdvancedBrownAccent,
  isLightDefaultTheme,
  REQUIRED_TOKEN_VARS,
  TOKEN_VALUES,
} from "./appearance";

const rendererRoot = join(process.cwd(), "src/renderer");
const tokensCss = readFileSync(join(rendererRoot, "tokens.css"), "utf8");
const stylesCss = readFileSync(join(rendererRoot, "styles.css"), "utf8");
const indexHtml = readFileSync(join(rendererRoot, "index.html"), "utf8");

describe("appearance defaults", () => {
  it("locks light theme and advanced-brown accent", () => {
    expect(APPEARANCE_THEME).toBe("light");
    expect(APPEARANCE_ACCENT).toBe("advanced-brown");
    expect(isLightDefaultTheme()).toBe(true);
    expect(isAdvancedBrownAccent()).toBe(true);
  });

  it("defines required CSS custom properties with light/brown/semantic values", () => {
    for (const name of REQUIRED_TOKEN_VARS) {
      expect(tokensCss).toContain(name);
    }
    expect(tokensCss.toLowerCase()).toContain(TOKEN_VALUES.canvas);
    expect(tokensCss.toLowerCase()).toContain(TOKEN_VALUES.accent);
    expect(tokensCss.toLowerCase()).toContain(TOKEN_VALUES.success);
    expect(tokensCss.toLowerCase()).toContain(TOKEN_VALUES.warning);
    expect(tokensCss.toLowerCase()).toContain(TOKEN_VALUES.error);
    // Semantic colors must remain distinct from accent.
    expect(TOKEN_VALUES.success).not.toBe(TOKEN_VALUES.accent);
    expect(TOKEN_VALUES.warning).not.toBe(TOKEN_VALUES.accent);
    expect(TOKEN_VALUES.error).not.toBe(TOKEN_VALUES.accent);
  });

  it("forbids glass material", () => {
    const combined = `${tokensCss}\n${stylesCss}`;
    expect(combined).not.toMatch(/backdrop-filter/i);
    expect(combined).not.toMatch(/-webkit-backdrop-filter/i);
  });

  it("paints light before React via html/body defaults", () => {
    expect(indexHtml).toMatch(/color-scheme:\s*light/i);
    expect(indexHtml.toLowerCase()).toContain("#f4f1ec");
    expect(tokensCss).toMatch(/color-scheme:\s*light/);
  });
});
