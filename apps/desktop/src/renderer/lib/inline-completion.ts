import type { GroundingOptions3 } from "@translunar/contracts";

/** Caret marker inside the freeform prompt. Must stay unique in the live draft. */
export const AI_COMPLETE_MARKER = "⌂";

/**
 * Instruction the model sees in `ai.run.start.prompt`.
 *
 * Grounding (source, terms, TM, neighbour segments) is packed by the engine.
 * The live unsaved draft is not in SQLite, so it has to travel here.
 */
export const AI_COMPLETE_PROMPT_LEAD = `Continue the target translation from the caret. Return only the completion suffix (do not repeat text already typed; do not translate the source from scratch; do not explain; do not invent tags).
Honor preferred terms; never use forbidden terms.
Live target (caret marked with ${AI_COMPLETE_MARKER}):`;

/** Leaner than a full-segment generate; still inside engine maxChars 1000..64000. */
export const AI_SUGGEST_GROUNDING: GroundingOptions3 = {
  includeTerms: true,
  includeTm: true,
  includeCorpus: true,
  includeContext: true,
  includeStyle: true,
  tmTopN: 5,
  corpusTopN: 3,
  contextBefore: 2,
  contextAfter: 2,
  maxChars: 8000,
  styleInstruction: "",
  systemInstruction: "",
};

export function isCompletePrompt(prompt: string): boolean {
  return prompt.includes(AI_COMPLETE_MARKER) && prompt.includes("Live target");
}

function chars(text: string): string[] {
  return [...text];
}

function equalsIgnoreCase(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.join("").toLowerCase() === right.join("").toLowerCase();
}

/** Longest word-ish prefix before the caret. Mirrors editor-core `caret_prefix`. */
export function livePrefix(text: string, caret: number, maxChars = 32): string {
  const characters = chars(text);
  const at = Math.max(0, Math.min(caret, characters.length));
  let start = at;
  while (start > 0) {
    const candidate = characters[start - 1] ?? "";
    if (/\s/.test(candidate) || at - start >= maxChars) break;
    start -= 1;
  }
  return characters.slice(start, at).join("");
}

/**
 * Untyped tail of a ranked candidate. Empty when the candidate is not a
 * completion of `prefix` (already typed, or a mismatch).
 */
export function completionSuffix(candidate: string, prefix: string): string {
  const cand = chars(candidate);
  const pref = chars(prefix);
  if (pref.length === 0 || cand.length <= pref.length) return "";
  if (!equalsIgnoreCase(cand.slice(0, pref.length), pref)) return "";
  return cand.slice(pref.length).join("");
}

function stripTrailing(text: string, tail: string): string {
  if (!tail) return text;
  const body = chars(text);
  const end = chars(tail);
  if (
    body.length >= end.length &&
    equalsIgnoreCase(body.slice(body.length - end.length), end)
  ) {
    return body.slice(0, body.length - end.length).join("");
  }
  return text;
}

/**
 * Turn a model proposal into a caret suffix, or "" if it cannot be attached.
 *
 * Accepts a full rewrite that still starts with the typed prefix, or a bare
 * suffix. Drops whole-segment shapes the fake translate path already uses.
 */
export function attachCompletion(
  proposal: string,
  liveTarget: string,
  caret: number,
): string {
  const trimmed = proposal.trim();
  if (!trimmed) return "";
  if (/^AI\s+\w+:/i.test(trimmed) || /^Corrected:/i.test(trimmed)) return "";

  const live = chars(liveTarget);
  const at = Math.max(0, Math.min(caret, live.length));
  const before = live.slice(0, at).join("");
  const after = live.slice(at).join("");
  const beforeChars = chars(before);
  const proposalChars = chars(trimmed);

  if (
    beforeChars.length > 0 &&
    proposalChars.length > beforeChars.length &&
    equalsIgnoreCase(proposalChars.slice(0, beforeChars.length), beforeChars)
  ) {
    return stripTrailing(
      proposalChars.slice(beforeChars.length).join(""),
      after,
    );
  }

  if (
    live.length > 0 &&
    proposalChars.length > live.length &&
    equalsIgnoreCase(proposalChars.slice(0, live.length), live)
  ) {
    return proposalChars.slice(live.length).join("");
  }

  // Bare suffix: the prompt asked for this. Reject if it repeats the live draft.
  if (before && trimmed.toLowerCase() === before.toLowerCase()) return "";
  if (liveTarget && trimmed.toLowerCase() === liveTarget.toLowerCase()) return "";
  return stripTrailing(trimmed, after);
}

export function isCjkChar(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  );
}

/** Next whitespace-delimited word, or the next CJK character. */
export function firstAcceptUnit(suffix: string): string {
  const units = chars(suffix);
  if (units.length === 0) return "";
  let i = 0;
  while (i < units.length && /\s/.test(units[i] ?? "")) i += 1;
  if (i >= units.length) return suffix;
  if (isCjkChar(units[i] ?? "")) {
    return units.slice(0, i + 1).join("");
  }
  let end = i + 1;
  while (end < units.length && !/\s/.test(units[end] ?? "")) end += 1;
  return units.slice(0, end).join("");
}

export function buildCompletePrompt(liveTarget: string, caret: number): string {
  const units = chars(liveTarget);
  const at = Math.max(0, Math.min(caret, units.length));
  const before = units.slice(0, at).join("");
  const after = units.slice(at).join("");
  return `${AI_COMPLETE_PROMPT_LEAD}\n「${before}${AI_COMPLETE_MARKER}${after}」`;
}
