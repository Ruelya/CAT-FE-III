/* Emits the product's theme token sheets from the design studies.
 *
 * The studies are the source of truth for what a theme looks like, so the
 * `--tl-*` block the app ships is derived from a study's `:root` rather than
 * transcribed by hand — a palette can only be wrong in one place.
 *
 * What this does NOT emit is the material half of a theme: paper fibre,
 * scanlines, glass, clay pressing. Those target product class names that do
 * not exist in the studies, so they are hand-written in surfaces.css and
 * fx.css next to the generated tokens.
 *
 *   node docs/design-studies/src/emit-themes.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "packages", "ui", "src", "themes");

/* study sheets -> theme id. A light sibling is its parent plus its override
   layer, exactly as the studies build it. */
const THEMES = [
  { id: "terra", css: ["art-terra.css"], scheme: "light" },
  { id: "compact", css: ["theme-compact.css"], scheme: "light" },
  { id: "comfortable", css: ["theme-comfortable.css"], scheme: "light" },
  { id: "dark", css: ["theme-dark.css"], scheme: "dark" },
  { id: "aurora", css: ["art-aurora.css"], scheme: "dark" },
  { id: "blueprint", css: ["art-blueprint.css"], scheme: "dark" },
  { id: "acid", css: ["art-acid.css"], scheme: "light" },
  { id: "quarry", css: ["theme-quarry.css"], scheme: "light" },
  { id: "cobalt", css: ["theme-cobalt.css"], scheme: "dark" },
  { id: "ledger", css: ["theme-ledger.css"], scheme: "light" },
  { id: "riso", css: ["art-riso.css"], scheme: "light" },
  { id: "atelier", css: ["art-atelier.css"], scheme: "dark" },
  {
    id: "atelier-light",
    css: ["art-atelier.css", "art-atelier-light.css"],
    scheme: "light",
  },
  { id: "phosphor", css: ["art-phosphor.css"], scheme: "dark" },
  {
    id: "phosphor-light",
    css: ["art-phosphor.css", "art-phosphor-light.css"],
    scheme: "light",
  },
  { id: "vitrine", css: ["art-vitrine.css"], scheme: "light" },
];

/* study variable -> product token. Anything not named here stays in the
   study; the product contract is deliberately smaller than the prototype's. */
const MAP = [
  ["bg", "--tl-color-bg"],
  ["surface", "--tl-color-surface"],
  ["surface-2", "--tl-color-surface-raised"],
  ["surface-3", "--tl-color-surface-float"],
  ["sunken", "--tl-color-sunken"],
  ["chrome", "--tl-color-chrome"],
  ["row-active", "--tl-color-surface-active"],
  ["row-hover", "--tl-color-row-hover"],
  ["border", "--tl-color-border"],
  ["border-strong", "--tl-color-border-strong"],
  ["border-strong", "--tl-color-field-hover"],
  ["text", "--tl-color-text"],
  ["text-muted", "--tl-color-text-muted"],
  ["text-faint", "--tl-color-text-faint"],
  ["accent", "--tl-color-accent"],
  ["accent-strong", "--tl-color-accent-strong"],
  ["accent-soft", "--tl-color-accent-soft"],
  ["accent-faint", "--tl-color-accent-faint"],
  ["on-accent", "--tl-color-on-accent"],
  ["ok", "--tl-status-ok"],
  ["ok-soft", "--tl-status-ok-soft"],
  ["warn", "--tl-status-warn"],
  ["warn-soft", "--tl-status-warn-soft"],
  ["danger", "--tl-status-danger"],
  ["danger-soft", "--tl-status-danger-soft"],
  ["info", "--tl-status-info"],
  ["info-soft", "--tl-status-info-soft"],
  ["scrim", "--tl-color-scrim"],
  ["font-ui", "--tl-font-ui"],
  ["font-mono", "--tl-font-mono"],
  ["fs-xs", "--tl-text-xs"],
  ["fs-sm", "--tl-text-sm"],
  ["fs-md", "--tl-text-md"],
  ["fs-lg", "--tl-text-lg"],
  ["fs-xl", "--tl-text-xl"],
  ["r-sm", "--tl-radius-sm"],
  ["r-md", "--tl-radius-md"],
  ["row-h", "--tl-row-h-grid"],
  ["ctl-h", "--tl-ctl-h-md"],
  ["ctl-h-sm", "--tl-ctl-h-sm"],
  ["ribbon-h", "--tl-ribbon-h"],
  ["status-h", "--tl-statusbar-h"],
  ["tab-h", "--tl-tab-h"],
  ["rail-left", "--tl-rail-left"],
  ["rail-right", "--tl-rail-right"],
  ["shadow-1", "--tl-shadow-raised"],
  ["shadow-2", "--tl-shadow-pop"],
  ["shadow-3", "--tl-shadow-overlay"],
  ["focus", "--tl-focus-ring"],
  ["pv-done", "--tl-chip-confirmed"],
  ["pv-todo", "--tl-chip-draft"],
  ["pv-none", "--tl-chip-untranslated"],
];

/* Collect every custom property declared at :root across a study's layers.
   Later layers win, which is how the light siblings override their parent. */
function rootVars(files) {
  const vars = new Map();
  for (const file of files) {
    const css = readFileSync(join(here, file), "utf8");
    const start = css.indexOf(":root {");
    if (start < 0) continue;
    let depth = 0;
    let end = start;
    for (let i = css.indexOf("{", start); i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = css.slice(css.indexOf("{", start) + 1, end);
    /* Declarations only: skip nested at-rules, and allow multi-line values
       such as a font stack or a three-part shadow. */
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      vars.set(m[1].slice(2), m[2].replace(/\s+/g, " ").trim());
    }
  }
  return vars;
}

/* A study may express one token through another (riso's paper scale, the
   light siblings' recolouring). The product sheet has to be self-contained,
   so study-local references are flattened; a reference that is already a
   product token is left alone. */
function resolve(value, vars, seen = new Set()) {
  return value.replace(/var\(--([a-z0-9-]+)(?:,\s*([^)]*))?\)/gi, (all, name, fallback) => {
    if (name.startsWith("tl-")) return all;
    if (seen.has(name)) return fallback ?? all;
    const next = vars.get(name);
    if (next === undefined) return fallback ? fallback.trim() : all;
    return resolve(next, vars, new Set([...seen, name]));
  });
}

mkdirSync(outDir, { recursive: true });
const index = [];

for (const theme of THEMES) {
  const vars = rootVars(theme.css);
  const lines = [`  color-scheme: ${theme.scheme};`, ""];
  const emitted = new Set();
  for (const [from, to] of MAP) {
    const raw = vars.get(from);
    if (raw === undefined || emitted.has(to)) continue;
    emitted.add(to);
    lines.push(`  ${to}: ${resolve(raw, vars)};`);
  }
  /* The hairline is a composite, so it has to be restated once the border
     colour moves; radius-driven geometry follows the same rule. */
  lines.push(`  --tl-border-hairline: 1px solid var(--tl-color-border);`);
  if (vars.has("dur")) {
    const d = parseFloat(vars.get("dur"));
    if (Number.isFinite(d)) {
      lines.push(`  --tl-motion-fast: ${Math.round(d * 0.8)}ms;`);
      lines.push(`  --tl-motion-base: ${Math.round(d * 1.2)}ms;`);
      lines.push(`  --tl-motion-slow: ${Math.round(d * 1.7)}ms;`);
    }
  }
  if (vars.has("ease")) {
    lines.push(`  --tl-ease-standard: ${vars.get("ease")};`);
    lines.push(`  --tl-ease-out: ${vars.get("ease")};`);
  }

  const out = `/* Generated from ${theme.css.join(" + ")} by\n   docs/design-studies/src/emit-themes.mjs — edit the study, not this file.\n   Material and motion that cannot be a token live in ../theme-surfaces.css. */\n\n[data-theme="${theme.id}"] {\n${lines.join("\n")}\n}\n`;
  writeFileSync(join(outDir, `${theme.id}.css`), out);
  index.push(`@import "./themes/${theme.id}.css";`);
  console.log(`${theme.id}.css  ${emitted.size} tokens`);
}

writeFileSync(
  join(outDir, "..", "themes.css"),
  `/* Every theme's token block. Generated by docs/design-studies/src/emit-themes.mjs.\n   The material layer that these cannot express is in theme-surfaces.css. */\n\n${index.join("\n")}\n`,
);
console.log(`themes.css  ${THEMES.length} themes`);
