/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));

/**
 * Product-facing renderer components audited for hard-coded English UI copy.
 * Workbench.tsx is owned by a separate visual task and is excluded from this
 * migration; its residual literals are tracked in the task report, not here.
 */
const PROTECTED_EXCLUDED = new Set<string>(["Workbench.tsx"]);

/**
 * JSX attributes whose string values are user-visible copy and therefore must
 * come from the catalog, not a hard-coded literal.
 */
const VISIBLE_ATTRIBUTES = new Set<string>([
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "aria-description",
  "aria-placeholder",
]);

/**
 * Audited allowlist of literal strings that are legitimately not catalog copy:
 * technical tokens, provider/format identifiers, CSS class fragments, and
 * punctuation-only separators. Multi-word English prose must not appear here.
 */
const ALLOWLIST = new Set<string>([
  "OpenAI",
  "https://api.openai.com/v1",
  "gpt-4.1-mini",
  "en-US",
  "zh-CN",
]);

/**
 * True when a literal is a technical identifier rather than prose: a single
 * token, a format/provider identifier, a URL, a path, or something without
 * two or more consecutive ASCII-letter words (e.g. "DOCX", "1.2.3", "—").
 */
function looksTechnical(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (ALLOWLIST.has(trimmed)) return true;
  // No two consecutive multi-letter English words -> treat as a token.
  return !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(trimmed);
}

function collectComponentFiles(): string[] {
  return readdirSync(rendererDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".tsx"))
    .filter((name) => !name.endsWith(".test.tsx"))
    .filter((name) => !PROTECTED_EXCLUDED.has(name))
    .map((name) => join(rendererDir, name));
}

function stringAttributeValue(
  node: ts.JsxAttribute,
): { name: string; value: string } | null {
  const name = node.name.getText();
  if (!VISIBLE_ATTRIBUTES.has(name)) return null;
  const initializer = node.initializer;
  if (initializer && ts.isStringLiteral(initializer)) {
    return { name, value: initializer.text };
  }
  return null;
}

function findHardCodedCopy(sourceText: string, fileName: string): string[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const offenders: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text.length > 0 && !looksTechnical(text)) {
        offenders.push(`${fileName}: JSX text "${text}"`);
      }
    } else if (ts.isJsxAttribute(node)) {
      const attribute = stringAttributeValue(node);
      if (attribute && !looksTechnical(attribute.value)) {
        offenders.push(
          `${fileName}: ${attribute.name}="${attribute.value}"`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return offenders;
}

describe("product-facing renderer copy stays in the catalog", () => {
  it("has no hard-coded English JSX text or visible attributes", () => {
    const offenders: string[] = [];
    for (const file of collectComponentFiles()) {
      const name = file.split(/[\\/]/u).at(-1) ?? file;
      offenders.push(...findHardCodedCopy(readFileSync(file, "utf8"), name));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
