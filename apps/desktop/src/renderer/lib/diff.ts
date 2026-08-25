/** Character-level diff for candidate cards: current target vs AI proposal. */

export interface DiffPart {
  kind: "equal" | "insert" | "delete";
  text: string;
}

/** Inputs beyond this product fall back to a whole-string replace so the UI
 * never burns quadratic time on pathological segments. */
const MAX_LCS_CELLS = 250_000;

/**
 * Code-point LCS diff. `delete` parts come from `before`, `insert` parts from
 * `after`; consecutive parts of the same kind are merged.
 */
export function diffChars(before: string, after: string): DiffPart[] {
  if (before === after) {
    return before.length === 0 ? [] : [{ kind: "equal", text: before }];
  }
  const a = Array.from(before);
  const b = Array.from(after);
  if (a.length * b.length > MAX_LCS_CELLS) {
    return mergeParts([
      { kind: "delete", text: before },
      { kind: "insert", text: after },
    ]);
  }
  // Classic DP table of LCS lengths, then a backtrack into edit parts.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(
              table[(i + 1) * cols + j] ?? 0,
              table[i * cols + j + 1] ?? 0,
            );
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ kind: "equal", text: a[i] as string });
      i += 1;
      j += 1;
    } else if (
      (table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)
    ) {
      parts.push({ kind: "delete", text: a[i] as string });
      i += 1;
    } else {
      parts.push({ kind: "insert", text: b[j] as string });
      j += 1;
    }
  }
  while (i < a.length) {
    parts.push({ kind: "delete", text: a[i] as string });
    i += 1;
  }
  while (j < b.length) {
    parts.push({ kind: "insert", text: b[j] as string });
    j += 1;
  }
  return mergeParts(parts);
}

function mergeParts(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    if (part.text.length === 0) {
      continue;
    }
    const last = merged[merged.length - 1];
    if (last && last.kind === part.kind) {
      last.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}
