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
  canFind?: boolean;
  canSplit?: boolean;
  canMerge?: boolean;
  canComment?: boolean;
  protectTags?: boolean;
  canLock?: boolean;
  canSetWorkflow?: boolean;
  workflowState?: "translation" | "review" | "signed";
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
      shortcut: "Ctrl+Shift+L",
      disabled: !input.canInsertTerm,
    },
    {
      id: "addTerm",
      label: "Add term",
      shortcut: "Ctrl+Shift+T",
      disabled: !input.canStoreTerm,
    },
    // Place-all has no chord of its own: Ctrl+, opens QuickPlace, whose first
    // entry is "place all tags". Advertising a chord here that opens a
    // different control teaches people the hints cannot be trusted.
    {
      id: "placeTags",
      label: "Place tags",
    },
    {
      id: "quickPlace",
      label: "QuickPlace",
      shortcut: "Ctrl+,",
    },
    {
      id: "protectTags",
      label: input.protectTags ? "Allow tag deletion" : "Protect tags",
    },
    { id: "sep-structure", separator: true },
    {
      id: "find",
      label: "Find in document",
      shortcut: "Ctrl+F",
      disabled: input.canFind === false,
    },
    {
      id: "split",
      label: "Split segment",
      disabled: input.canSplit !== true,
    },
    {
      id: "merge",
      label: "Merge segments",
      disabled: input.canMerge !== true,
    },
    {
      id: "comment",
      label: "Add comment",
      disabled: input.canComment !== true,
    },
    { id: "sep-status", separator: true },
    {
      id: "statusTranslation",
      label: "Set status: Translation",
      shortcut: "Ctrl+Alt+T",
      disabled:
        input.canSetWorkflow !== true || input.workflowState === "translation",
    },
    {
      id: "statusReview",
      label: "Set status: Review",
      shortcut: "Ctrl+Alt+R",
      disabled: input.canSetWorkflow !== true || input.workflowState === "review",
    },
    {
      id: "lock",
      label: "Sign off / lock",
      shortcut: "Ctrl+L",
      disabled: input.canLock !== true || input.workflowState === "signed",
    },
    {
      id: "goTo",
      label: "Go to segment",
      shortcut: "Ctrl+G",
    },
    {
      id: "extractTerms",
      label: "Extract terms",
    },
  ];
}
