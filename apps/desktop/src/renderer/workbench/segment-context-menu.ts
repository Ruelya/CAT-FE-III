export type ContextMenuField = "source" | "target" | "row";

export function splicePlain(
  text: string,
  start: number,
  end: number,
  insert: string,
): string {
  const chars = [...text];
  const from = Math.max(0, Math.min(start, chars.length));
  const to = Math.max(from, Math.min(end, chars.length));
  return chars.slice(0, from).join("") + insert + chars.slice(to).join("");
}

export interface ContextMenuAction {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
}

export type ContextMenuEntry =
  | ContextMenuAction
  | { id: string; separator: true };

/**
 * Trados-style editor context actions for the active segment.
 *
 * Built from the live selection, not from a second copy of the row. Disabled
 * items stay visible so the translator can see what the gesture would do.
 */
export function segmentContextActions(input: {
  field: ContextMenuField;
  hasSourceSelection: boolean;
  hasTargetSelection: boolean;
  canStoreTerm: boolean;
  canInsertTerm: boolean;
  canConfirm: boolean;
  targetHasText: boolean;
  canCopySource: boolean;
}): ContextMenuEntry[] {
  const hasSelection =
    input.field === "source"
      ? input.hasSourceSelection
      : input.field === "target"
        ? input.hasTargetSelection
        : input.hasSourceSelection || input.hasTargetSelection;
  const targetField = input.field === "target";

  return [
    {
      id: "copy",
      label: "Copy",
      shortcut: "Ctrl+C",
      disabled: !hasSelection && !input.targetHasText && !input.hasSourceSelection,
    },
    {
      id: "cut",
      label: "Cut",
      shortcut: "Ctrl+X",
      disabled: !targetField || !input.hasTargetSelection,
    },
    {
      id: "paste",
      label: "Paste",
      shortcut: "Ctrl+V",
      disabled: !targetField,
    },
    { id: "sep-edit", separator: true },
    {
      id: "copySource",
      label: "Copy source to target",
      shortcut: "Ctrl+Insert",
      disabled: !input.canCopySource,
    },
    {
      id: "clearTarget",
      label: "Clear target",
      disabled: !input.targetHasText,
      danger: true,
    },
    {
      id: "confirm",
      label: "Confirm",
      shortcut: "Ctrl+Enter",
      disabled: !input.canConfirm,
    },
    { id: "sep-terms", separator: true },
    {
      id: "concordance",
      label: "Concordance",
      shortcut: "F3",
    },
    {
      id: "insertTerm",
      label: "Insert term",
      shortcut: "Ctrl+T",
      disabled: !input.canInsertTerm,
    },
    {
      id: "addTerm",
      label: "Add term",
      disabled: !input.canStoreTerm,
    },
    {
      id: "placeTags",
      label: "Place tags",
      shortcut: "Ctrl+,",
    },
  ];
}
