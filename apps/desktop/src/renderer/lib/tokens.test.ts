import { describe, expect, it } from "vitest";

import { lexPlaceholderTokens, placeholderTokens } from "./tokens.js";

/**
 * Fixture set mirrors the engine's placeholder QA rule
 * (crates/tl-qa `placeholder_rule`, pattern from crates/tl-domain
 * `PLACEHOLDER_RE`): the renderer must highlight exactly the tokens the
 * engine counts, or the danger outline would drift from qa.list.
 */
const ENGINE_FIXTURES: Array<[string, string[]]> = [
  ["Hello {name}, welcome!", ["{name}"]],
  ["Value: {{count}} items", ["{{count}}"]],
  ["Progress: %d%% (%s)", ["%d", "%s"]],
  ["Click <b>here</b> now", ["<b>", "</b>"]],
  ["A &amp; B &#169; C", ["&amp;", "&#169;"]],
  ["printf %1$s and %.2f", ["%1$s", "%.2f"]],
  ["<br/> and <a href=\"x\">", ["<br/>", "<a href=\"x\">"]],
  ["No tokens here.", []],
  ["", []],
  // Not tokens: unbalanced braces, lone percent, spaces after `{`.
  ["50% of { not a token", []],
  // The engine's printf flag class has no space flag (its Rust pattern is
  // in verbose mode): "% d" must NOT become a token here either.
  ["50% delivered", []],
];

describe("lexPlaceholderTokens", () => {
  it.each(ENGINE_FIXTURES)("tokenizes %j", (text, expected) => {
    expect(placeholderTokens(text)).toEqual(expected);
  });

  it("splits text into ordered runs that reassemble the input", () => {
    const text = "Hi {name}, you have {{count}} new <b>messages</b>.";
    const runs = lexPlaceholderTokens(text);
    expect(runs.map((run) => run.text).join("")).toBe(text);
    expect(runs.filter((run) => run.token).map((run) => run.text)).toEqual([
      "{name}",
      "{{count}}",
      "<b>",
      "</b>",
    ]);
    // Plain runs and token runs alternate without empty runs.
    expect(runs.every((run) => run.text.length > 0)).toBe(true);
  });

  it("keeps duplicate tokens as separate runs", () => {
    const runs = lexPlaceholderTokens("%s and %s");
    expect(runs.filter((run) => run.token)).toHaveLength(2);
  });
});
