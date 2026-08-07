/**
 * Client-side word-level diff for TM match cards.
 * Deleted → line-through; inserted → underline. No color-block styling.
 */

export type DiffKind = "equal" | "delete" | "insert";

export interface DiffToken {
  kind: DiffKind;
  text: string;
}

/** Split into whitespace and non-whitespace runs (Unicode-aware). */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  const re = /(\s+)|(\S+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * Diff match source against the active segment source.
 * Tokens only in the match → delete; only in active → insert; shared → equal.
 */
export function wordDiff(activeSource: string, matchSource: string): DiffToken[] {
  if (activeSource === matchSource) {
    return matchSource ? [{ kind: "equal", text: matchSource }] : [];
  }
  const a = tokenize(activeSource);
  const b = tokenize(matchSource);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) {
    return b.map((text) => ({ kind: "delete" as const, text }));
  }
  if (b.length === 0) {
    return a.map((text) => ({ kind: "insert" as const, text }));
  }

  const n = a.length;
  const m = b.length;
  // LCS DP table (n+1)×(m+1) — fine for short segment strings.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0);
      }
    }
  }

  const reverse: DiffToken[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      reverse.push({ kind: "equal", text: b[j - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (dp[i]![j - 1] ?? 0) >= (dp[i - 1]![j] ?? 0))) {
      reverse.push({ kind: "delete", text: b[j - 1]! });
      j--;
    } else if (i > 0) {
      reverse.push({ kind: "insert", text: a[i - 1]! });
      i--;
    }
  }
  reverse.reverse();
  return mergeAdjacent(reverse);
}

function mergeAdjacent(tokens: DiffToken[]): DiffToken[] {
  if (tokens.length === 0) return tokens;
  const out: DiffToken[] = [];
  for (const token of tokens) {
    const last = out[out.length - 1];
    if (last && last.kind === token.kind) {
      last.text += token.text;
    } else {
      out.push({ kind: token.kind, text: token.text });
    }
  }
  return out;
}
