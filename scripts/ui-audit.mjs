#!/usr/bin/env node
/**
 * Static renderer design-system audit.
 *
 * Enforces the mechanical rules in `.trellis/spec/frontend/design-language.md`
 * that a linter or type checker cannot see: forbidden materials, forbidden
 * icon dependencies, undefined CSS custom properties, raw design values that
 * bypass tokens, inline layout styles, icon-only buttons without both `title`
 * and `aria-label`, and prohibited product copy.
 *
 * Exit code 0 means the renderer is clean. Any finding exits 1.
 *
 * Usage:
 *   node scripts/ui-audit.mjs            # human report
 *   node scripts/ui-audit.mjs --json     # machine-readable report
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rendererDir = join(root, "apps", "desktop", "src", "renderer");
const tokensFile = join(rendererDir, "tokens.css");
const desktopPackageJson = join(root, "apps", "desktop", "package.json");

const jsonOutput = process.argv.includes("--json");

/** @type {{rule: string, file: string, line: number, detail: string}[]} */
const findings = [];

function report(rule, file, line, detail) {
  findings.push({ rule, file: relative(root, file), line, detail });
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "assets") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(rendererDir);
const tsxFiles = allFiles.filter(
  (f) =>
    (extname(f) === ".tsx" || extname(f) === ".ts") &&
    !f.endsWith(".test.tsx") &&
    !f.endsWith(".test.ts") &&
    !f.includes(`${"/"}test${"/"}`),
);
const cssFiles = allFiles.filter((f) => extname(f) === ".css");

const read = (f) => readFileSync(f, "utf8");
const lines = (text) => text.split(/\r?\n/);

/* ── R1 · Forbidden materials ───────────────────────────── */
{
  const pattern = /backdrop-filter|-webkit-backdrop-filter/;
  for (const file of [...cssFiles, ...tsxFiles]) {
    lines(read(file)).forEach((line, i) => {
      if (pattern.test(line)) {
        report(
          "R1-material",
          file,
          i + 1,
          "backdrop-filter / glass material is forbidden",
        );
      }
    });
  }
}

/* ── R2 · Forbidden icon dependency ─────────────────────── */
{
  for (const file of tsxFiles) {
    lines(read(file)).forEach((line, i) => {
      if (line.includes("lucide-react")) {
        report("R2-icons", file, i + 1, "lucide-react import is forbidden");
      }
      if (/from\s+["']react-icons/.test(line)) {
        report(
          "R2-icons",
          file,
          i + 1,
          "only @phosphor-icons/react is allowed",
        );
      }
    });
  }
  const pkg = JSON.parse(read(desktopPackageJson));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep === "lucide-react" || dep.startsWith("react-icons")) {
      report(
        "R2-icons",
        desktopPackageJson,
        0,
        `unused forbidden icon dependency "${dep}" is still declared`,
      );
    }
  }
}

/* ── R3 · Undefined CSS custom properties ───────────────── */
{
  const declared = new Set();
  // Declarations may live in tokens.css, styles/*.css, or inline via JS.
  for (const file of cssFiles) {
    for (const match of read(file).matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      declared.add(match[1]);
    }
  }
  // appearance.ts writes derived variables onto the document root at runtime.
  for (const file of allFiles.filter((f) => extname(f) === ".ts")) {
    for (const match of read(file).matchAll(
      /setProperty\(\s*["'](--[a-z0-9-]+)["']/g,
    )) {
      declared.add(match[1]);
    }
  }

  for (const file of cssFiles) {
    lines(read(file)).forEach((line, i) => {
      for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
        const name = match[1];
        const hasFallback = match[2] === ",";
        if (!declared.has(name) && !hasFallback) {
          report(
            "R3-token",
            file,
            i + 1,
            `var(${name}) has no declaration and no fallback`,
          );
        }
      }
    });
  }
}

/* ── R4 · Raw design values outside the token file ──────── */
{
  const isTokens = (f) => f === tokensFile;
  for (const file of cssFiles) {
    if (isTokens(file)) continue;
    lines(read(file)).forEach((line, i) => {
      const code = line.replace(/\/\*.*?\*\//g, "");
      if (/#[0-9a-fA-F]{3,8}\b/.test(code)) {
        report(
          "R4-raw-color",
          file,
          i + 1,
          "raw hex colour outside tokens.css",
        );
      }
      if (/\brgba?\(/.test(code) && !/color-mix\(/.test(code)) {
        report(
          "R4-raw-color",
          file,
          i + 1,
          "raw rgb()/rgba() outside tokens.css",
        );
      }
      const radius = code.match(/border-radius:\s*([^;]+);/);
      if (radius && /\d/.test(radius[1]) && !radius[1].includes("var(")) {
        // `0` removes a radius rather than inventing one; 50% and pill
        // geometry are documented exceptions.
        if (
          !/^\s*0\s*$/.test(radius[1]) &&
          !/(50%|9999?px|100%)/.test(radius[1])
        ) {
          report(
            "R4-raw-radius",
            file,
            i + 1,
            `border-radius must use a radius token (found "${radius[1].trim()}")`,
          );
        }
      }
      const duration = code.match(
        /(transition|animation)(-duration)?:\s*([^;]+);/,
      );
      if (
        duration &&
        /\d+m?s\b/.test(duration[3]) &&
        !duration[3].includes("var(")
      ) {
        report(
          "R4-raw-motion",
          file,
          i + 1,
          `motion duration must use a motion token (found "${duration[3].trim()}")`,
        );
      }
      const shadow = code.match(/box-shadow:\s*([^;]+);/);
      if (
        shadow &&
        !shadow[1].includes("var(") &&
        !/^\s*none/.test(shadow[1])
      ) {
        report(
          "R4-raw-shadow",
          file,
          i + 1,
          "box-shadow must use an elevation token",
        );
      }
      if (/z-index:\s*-?\d/.test(code)) {
        report("R4-raw-layer", file, i + 1, "z-index must use a layer token");
      }
    });
  }
}

/* ── R5 · Inline layout styles ──────────────────────────── */
{
  // Data-derived geometry is a documented exception; everything else is CSS.
  const allowed = new Set(["workbench/PdfPageReview.tsx"]);
  for (const file of tsxFiles) {
    const rel = relative(rendererDir, file).split("\\").join("/");
    if (allowed.has(rel)) continue;
    lines(read(file)).forEach((line, i) => {
      if (/style=\{\{/.test(line)) {
        report(
          "R5-inline-style",
          file,
          i + 1,
          "inline style; move layout constants to a class",
        );
      }
    });
  }
}

/* ── R6 · Icon-only buttons need title + aria-label ─────── */
/**
 * Scan a JSX open tag starting at `<`, honouring nested braces and strings so
 * that `onClick={() => x}` does not terminate the tag at its arrow `>`.
 * Returns the attribute source and the index just past the closing `>`.
 */
function scanOpenTag(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) {
      return { attrs: text.slice(start, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * Text a sighted user would read inside an element.
 *
 * Literal children count, and so do string literals inside a JSX expression,
 * because `{pending ? "Saving" : "Save"}` renders a visible label. Element
 * tags and non-literal expressions do not count.
 */
function visibleTextOf(body) {
  let out = "";
  let depth = 0;
  let inTag = false;
  let expression = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (depth === 0 && !inTag && ch === "<") {
      inTag = true;
    } else if (inTag && ch === ">") {
      inTag = false;
    } else if (!inTag && ch === "{") {
      depth += 1;
      if (depth === 1) expression = "";
    } else if (!inTag && ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        for (const match of expression.matchAll(/"([^"]*)"|'([^']*)'/g)) {
          out += ` ${match[1] ?? match[2] ?? ""}`;
        }
      }
    } else if (!inTag && depth > 0) {
      expression += ch;
    } else if (!inTag) {
      out += ch;
    }
  }
  return out.trim();
}

{
  for (const file of tsxFiles) {
    const text = read(file);
    for (
      let i = text.indexOf("<button");
      i !== -1;
      i = text.indexOf("<button", i + 1)
    ) {
      const open = scanOpenTag(text, i + "<button".length);
      if (!open) continue;
      const close = text.indexOf("</button>", open.end);
      if (close === -1) continue;
      const attrs = open.attrs;
      const body = text.slice(open.end, close);
      const lineNo = text.slice(0, i).split(/\r?\n/).length;
      const hasIcon = /<[A-Z][A-Za-z0-9]*[\s/>]/.test(body);
      if (!hasIcon) continue;
      if (visibleTextOf(body).length > 0) continue;
      if (!/aria-label=/.test(attrs)) {
        report(
          "R6-icon-button",
          file,
          lineNo,
          "icon-only button is missing aria-label",
        );
      }
      if (!/\btitle=/.test(attrs)) {
        report(
          "R6-icon-button",
          file,
          lineNo,
          "icon-only button is missing title",
        );
      }
    }
  }
}

/* ── R7 · Product copy discipline ───────────────────────── */
{
  const bannedWords = [
    "Seamless",
    "seamlessly",
    "Unleash",
    "Elevate your",
    "Revolutionize",
    "Next-Gen",
    "cutting-edge",
    "state-of-the-art",
    "effortlessly",
  ];
  for (const file of tsxFiles) {
    lines(read(file)).forEach((line, i) => {
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*/, "");
      if (/[\u2014\u2013]/.test(code)) {
        report(
          "R7-copy",
          file,
          i + 1,
          "em dash or en dash is forbidden in source and visible copy",
        );
      }
      if (/["'>][^"'<]*\u4e0d\u662f[^"'<]*["'<]/.test(code)) {
        report(
          "R7-copy",
          file,
          i + 1,
          'contrast construction using "\u4e0d\u662f" is forbidden in UI copy',
        );
      }
      for (const word of bannedWords) {
        if (code.includes(word)) {
          report("R7-copy", file, i + 1, `marketing filler word "${word}"`);
        }
      }
    });
  }
}

/* ── Output ─────────────────────────────────────────────── */
if (jsonOutput) {
  process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
} else if (findings.length === 0) {
  process.stdout.write("ui-audit: clean\n");
} else {
  const byRule = new Map();
  for (const finding of findings) {
    if (!byRule.has(finding.rule)) byRule.set(finding.rule, []);
    byRule.get(finding.rule).push(finding);
  }
  for (const [rule, entries] of [...byRule.entries()].sort()) {
    process.stdout.write(`\n${rule} (${entries.length})\n`);
    for (const entry of entries) {
      process.stdout.write(`  ${entry.file}:${entry.line}  ${entry.detail}\n`);
    }
  }
  process.stdout.write(`\nui-audit: ${findings.length} finding(s)\n`);
}

process.exit(findings.length === 0 ? 0 : 1);
