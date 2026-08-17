import type {
  EditorMutationResult,
  SegmentCounts,
  SegmentEditorRow,
} from "@translunar/contracts";

/** Structural mutations change row identity/order — prefer full refresh. */
export type EditorMutationMode = "replace" | "structural";

export interface ApplyMutationResult {
  /** Whether active document should re-list editor rows after apply. */
  needsFullRefresh: boolean;
  rows: SegmentEditorRow[];
  counts: SegmentCounts;
  focusSegmentId: string | null;
}

export function emptyCounts(total = 0): SegmentCounts {
  return {
    confirmed: 0,
    draft: 0,
    untranslated: 0,
    total,
    openIssues: 0,
  };
}

export function countsFromEditorRows(rows: SegmentEditorRow[]): SegmentCounts {
  let confirmed = 0;
  let draft = 0;
  let untranslated = 0;
  for (const row of rows) {
    const state = row.segment.state;
    if (state === "confirmed") confirmed += 1;
    else if (state === "draft") draft += 1;
    else untranslated += 1;
  }
  return {
    confirmed,
    draft,
    untranslated,
    total: rows.length,
    openIssues: 0,
  };
}

/**
 * Decide whether Engine result rows can replace by stable ID without re-list.
 * Structural mode always refreshes. Replace mode refreshes when IDs appear/disappear
 * relative to the current projection beyond simple in-place updates.
 */
export function shouldRefreshEditorRows(
  currentRows: readonly SegmentEditorRow[],
  result: EditorMutationResult,
  mode: EditorMutationMode,
): boolean {
  if (mode === "structural") return true;
  const currentIds = new Set(currentRows.map((r) => r.segment.id));
  const resultIds = result.rows.map((r) => r.segment.id);
  for (const id of resultIds) {
    if (!currentIds.has(id)) return true;
  }
  // Fewer rows than current with non-empty result can indicate deletion without
  // a complete projection — only safe when all result IDs already exist.
  if (result.rows.length === 0 && resultIds.length === 0) {
    // counts-only / no-row payloads: keep current rows; caller may still refresh.
    return false;
  }
  return false;
}

/**
 * Apply EditorMutationResult rows by stable segment ID.
 * Never invents ordinal placement. Uses Engine counts when provided.
 */
export function applyEditorMutationResult(
  currentRows: readonly SegmentEditorRow[],
  result: EditorMutationResult,
  mode: EditorMutationMode,
  currentFocusId: string | null,
): ApplyMutationResult {
  const needsFullRefresh = shouldRefreshEditorRows(currentRows, result, mode);
  const byId = new Map(result.rows.map((row) => [row.segment.id, row]));
  const rows = currentRows.map((row) => byId.get(row.segment.id) ?? row);
  const counts = result.counts ?? countsFromEditorRows(rows);
  const focusCandidate =
    result.focusSegmentId === undefined || result.focusSegmentId === null
      ? currentFocusId
      : result.focusSegmentId;
  const focusSegmentId =
    focusCandidate &&
    (rows.some((r) => r.segment.id === focusCandidate) ||
      result.rows.some((r) => r.segment.id === focusCandidate))
      ? focusCandidate
      : currentFocusId && rows.some((r) => r.segment.id === currentFocusId)
        ? currentFocusId
        : (rows[0]?.segment.id ?? null);

  return {
    needsFullRefresh,
    rows: needsFullRefresh ? [...currentRows] : rows,
    counts,
    focusSegmentId,
  };
}

export function rowBySegmentId(
  rows: readonly SegmentEditorRow[],
  segmentId: string | null | undefined,
): SegmentEditorRow | null {
  if (!segmentId) return null;
  return rows.find((r) => r.segment.id === segmentId) ?? null;
}

/** Adjacent in Engine ordinal order (presentation eligibility only). */
export function areAdjacentByOrdinal(
  rows: readonly SegmentEditorRow[],
  firstId: string,
  secondId: string,
): boolean {
  const a = rows.find((r) => r.segment.id === firstId);
  const b = rows.find((r) => r.segment.id === secondId);
  if (!a || !b) return false;
  return Math.abs(a.segment.ordinal - b.segment.ordinal) === 1;
}

export function orderedMergePair(
  rows: readonly SegmentEditorRow[],
  idA: string,
  idB: string,
): { first: SegmentEditorRow; second: SegmentEditorRow } | null {
  const a = rows.find((r) => r.segment.id === idA);
  const b = rows.find((r) => r.segment.id === idB);
  if (!a || !b) return null;
  if (!areAdjacentByOrdinal(rows, idA, idB)) return null;
  return a.segment.ordinal <= b.segment.ordinal
    ? { first: a, second: b }
    : { first: b, second: a };
}

export type EditorCommandId =
  | "editor.findReplace"
  | "editor.tags"
  | "editor.propagate"
  | "editor.split"
  | "editor.merge"
  | "editor.correctSource"
  | "editor.comments"
  | "editor.spell"
  | "editor.chinese"
  | "editor.undo"
  | "editor.redo"
  | "editor.history"
  | "editor.preferences"
  | "editor.review";

export type EditorCommandPlacement = "primary" | "overflow";

export interface EditorCommandDef {
  id: EditorCommandId;
  label: string;
  placement: EditorCommandPlacement;
  /** Display-only shortcut hint (Engine preferences may override later). */
  shortcut?: string;
  /**
   * Lowercase key matched with Ctrl/Cmd (no Alt) for Workbench keyboard dispatch.
   * Only registered chords are accepted; unregistered shell keys are never intercepted.
   */
  shortcutKey?: string;
  needsRow: boolean;
  /** Requires a visible Workbench session that owns the editor chrome. */
  editorOnly: boolean;
  targetAffecting: boolean;
}

/** Single registry: bar, overflow menu, keyboard, and availability share this. */
export const EDITOR_COMMAND_REGISTRY: readonly EditorCommandDef[] = [
  {
    id: "editor.findReplace",
    label: "Find",
    placement: "primary",
    shortcut: "Ctrl+F",
    shortcutKey: "f",
    needsRow: false,
    editorOnly: true,
    targetAffecting: false,
  },
  {
    id: "editor.tags",
    label: "Tags",
    placement: "primary",
    needsRow: true,
    editorOnly: true,
    targetAffecting: true,
  },
  {
    id: "editor.comments",
    label: "Comments",
    placement: "primary",
    needsRow: true,
    editorOnly: true,
    targetAffecting: false,
  },
  {
    id: "editor.undo",
    label: "Undo",
    placement: "primary",
    shortcut: "Ctrl+Z",
    shortcutKey: "z",
    needsRow: false,
    editorOnly: true,
    targetAffecting: true,
  },
  {
    id: "editor.redo",
    label: "Redo",
    placement: "primary",
    shortcut: "Ctrl+Y",
    shortcutKey: "y",
    needsRow: false,
    editorOnly: true,
    targetAffecting: true,
  },
  {
    id: "editor.split",
    label: "Split",
    placement: "primary",
    needsRow: true,
    editorOnly: true,
    targetAffecting: true,
  },
  {
    id: "editor.merge",
    label: "Merge",
    placement: "primary",
    needsRow: true,
    editorOnly: true,
    targetAffecting: true,
  },
  {
    id: "editor.spell",
    label: "Spell",
    placement: "primary",
    needsRow: true,
    editorOnly: true,
    targetAffecting: false,
  },
  {
    id: "editor.propagate",
    label: "Propagate",
    placement: "primary",
    needsRow: true,
    editorOnly: true,
    targetAffecting: true,
  },
  {
    id: "editor.correctSource",
    label: "Source",
    placement: "overflow",
    needsRow: true,
    editorOnly: true,
    targetAffecting: true,
  },
  {
    id: "editor.chinese",
    label: "CJK",
    placement: "overflow",
    needsRow: true,
    editorOnly: true,
    targetAffecting: true,
  },
  {
    id: "editor.history",
    label: "History",
    placement: "overflow",
    needsRow: false,
    editorOnly: true,
    targetAffecting: false,
  },
  {
    id: "editor.preferences",
    label: "Prefs",
    placement: "overflow",
    needsRow: false,
    editorOnly: true,
    targetAffecting: false,
  },
  {
    id: "editor.review",
    label: "Review",
    placement: "overflow",
    needsRow: false,
    editorOnly: true,
    targetAffecting: false,
  },
] as const;

export function commandDef(id: EditorCommandId): EditorCommandDef | undefined {
  return EDITOR_COMMAND_REGISTRY.find((c) => c.id === id);
}

export function isEditorCommandId(value: string): value is EditorCommandId {
  return EDITOR_COMMAND_REGISTRY.some((c) => c.id === value);
}

export interface EditorCommandAvailability {
  /** Visible Workbench owns editor chrome and panels. */
  hasWorkbenchSession: boolean;
  hasActiveRow: boolean;
  isComposing: boolean;
  isDirty: boolean;
  mutationsEnabled: boolean;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  mergeEligible: boolean;
}

export function isCommandAvailable(
  id: EditorCommandId,
  avail: EditorCommandAvailability,
): boolean {
  if (!avail.mutationsEnabled || avail.busy) return false;
  const def = commandDef(id);
  if (!def) return false;
  if (def.editorOnly && !avail.hasWorkbenchSession) return false;
  if (def.needsRow && !avail.hasActiveRow) return false;
  if (id === "editor.merge" && !avail.mergeEligible) return false;
  if (id === "editor.undo" && !avail.canUndo) return false;
  if (id === "editor.redo" && !avail.canRedo) return false;
  if (def.targetAffecting && avail.isComposing) return false;
  return true;
}

/** Resolve a Ctrl/Cmd chord to a registered editor command, or null. */
export function matchEditorShortcut(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): EditorCommandId | null {
  if (!(input.ctrlKey || input.metaKey) || input.altKey) return null;
  // Keep Shift free for future reverse-find chords; do not match shifted letters.
  if (input.shiftKey) return null;
  const key = input.key.toLocaleLowerCase();
  if (key.length !== 1) return null;
  const hit = EDITOR_COMMAND_REGISTRY.find((c) => c.shortcutKey === key);
  return hit?.id ?? null;
}

/**
 * Registry-owned keyboard acceptance: Workbench + focus + IME + availability.
 * Callers must not preventDefault unless this returns a command id.
 */
export function resolveAcceptedEditorShortcut(
  input: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  },
  avail: EditorCommandAvailability,
  options?: { workbenchFocused?: boolean },
): EditorCommandId | null {
  if (input.isComposing === true) return null;
  if (input.keyCode === 229 || input.which === 229) return null;
  if (options?.workbenchFocused === false) return null;
  if (!avail.hasWorkbenchSession) return null;
  const id = matchEditorShortcut(input);
  if (!id) return null;
  if (!isCommandAvailable(id, avail)) return null;
  return id;
}

export const CHINESE_PROFILES = [
  {
    id: "simplifiedToTraditional" as const,
    label: "Simplified → Traditional",
  },
  { id: "simplifiedToTaiwan" as const, label: "Simplified → Taiwan" },
  { id: "simplifiedToHongKong" as const, label: "Simplified → Hong Kong" },
  {
    id: "traditionalToSimplified" as const,
    label: "Traditional → Simplified",
  },
  { id: "taiwanToSimplified" as const, label: "Taiwan → Simplified" },
  { id: "hongKongToSimplified" as const, label: "Hong Kong → Simplified" },
];

export type EditorPanelId =
  | "findReplace"
  | "tags"
  | "comments"
  | "spell"
  | "history"
  | "preferences"
  | "review"
  | "structure"
  | "sourceCorrection"
  | "chinese"
  | "propagate"
  | null;
