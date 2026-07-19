export type EditorCommandId =
  | "editor.save"
  | "editor.confirm"
  | "editor.next"
  | "editor.previous"
  | "editor.findReplace"
  | "editor.concordance"
  | "editor.copySource"
  | "editor.copyTags"
  | "editor.insertTag"
  | "editor.insertTagPair"
  | "editor.moveTag"
  | "editor.split"
  | "editor.merge"
  | "editor.correctSource"
  | "editor.chineseConversion"
  | "editor.comment"
  | "editor.review"
  | "editor.workflow"
  | "editor.suggestion.1"
  | "editor.suggestion.2"
  | "editor.suggestion.3"
  | "editor.suggestion.4"
  | "editor.suggestion.5"
  | "editor.suggestion.6"
  | "editor.suggestion.7"
  | "editor.suggestion.8"
  | "editor.suggestion.9"
  | "editor.undo"
  | "editor.redo"
  | "editor.palette"
  | "editor.preferences"
  | "editor.toggleSuggestions"
  | "editor.togglePreview"
  | "editor.toggleTheme"
  | "editor.zoomIn"
  | "editor.zoomOut"
  | "editor.toggleNonprinting";

export type EditorCommandInvocation = "external" | "keyboard" | "palette";

export interface EditorCommandContext {
  hasActiveSegment: boolean;
  hasActiveEditorRow: boolean;
  editorFocused: boolean;
  isComposing: boolean;
  isSigned: boolean;
  canMerge: boolean;
  hasSelectedTargetTag: boolean;
  visibleSuggestionCount: number;
}

export interface EditorCommandHandlers {
  save(): void;
  confirm(): void;
  next(): void;
  previous(): void;
  openFindReplace(): void;
  openConcordance(): void;
  copySource(): void;
  copyTags(): void;
  insertTag(paired: boolean): void;
  moveTag(): void;
  split(): void;
  merge(): void;
  correctSource(): void;
  openChineseConversion(): void;
  openComments(): void;
  openReview(): void;
  advanceWorkflow(): void;
  insertSuggestion(index: number): void;
  undo(): void;
  redo(): void;
  openPalette(): void;
  openPreferences(): void;
  toggleSuggestions(): void;
  togglePreview(): void;
  toggleTheme(): void;
  zoomIn(): void;
  zoomOut(): void;
  toggleNonprinting(): void;
}

export interface EditorCommandDefinition {
  id: EditorCommandId;
  label: string;
  shortcut: string;
  group: "segment" | "search" | "review" | "history" | "view";
  editorOnly?: boolean;
  isEnabled(context: EditorCommandContext): boolean;
  dispatch(handlers: EditorCommandHandlers): void;
}

const alwaysEnabled = () => true;
const hasActiveSegment = (context: EditorCommandContext) =>
  context.hasActiveSegment;
const hasEditableSegment = (context: EditorCommandContext) =>
  context.hasActiveEditorRow && !context.isSigned && !context.isComposing;

export const EDITOR_COMMANDS: readonly EditorCommandDefinition[] = [
  {
    id: "editor.save",
    label: "Save active segment",
    shortcut: "Ctrl+S",
    group: "segment",
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.save(),
  },
  {
    id: "editor.confirm",
    label: "Confirm and move next",
    shortcut: "Ctrl+Enter",
    group: "segment",
    editorOnly: true,
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.confirm(),
  },
  {
    id: "editor.next",
    label: "Next segment",
    shortcut: "Alt+ArrowDown",
    group: "segment",
    isEnabled: hasActiveSegment,
    dispatch: (handlers) => handlers.next(),
  },
  {
    id: "editor.previous",
    label: "Previous segment",
    shortcut: "Alt+ArrowUp",
    group: "segment",
    isEnabled: hasActiveSegment,
    dispatch: (handlers) => handlers.previous(),
  },
  {
    id: "editor.findReplace",
    label: "Find and replace",
    shortcut: "Ctrl+F",
    group: "search",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.openFindReplace(),
  },
  {
    id: "editor.concordance",
    label: "Concordance",
    shortcut: "Ctrl+Shift+F",
    group: "search",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.openConcordance(),
  },
  {
    id: "editor.copySource",
    label: "Copy source to target",
    shortcut: "Ctrl+Shift+S",
    group: "segment",
    editorOnly: true,
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.copySource(),
  },
  {
    id: "editor.copyTags",
    label: "Copy protected tags",
    shortcut: "Ctrl+Shift+T",
    group: "segment",
    editorOnly: true,
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.copyTags(),
  },
  {
    id: "editor.insertTag",
    label: "Insert next protected tag",
    shortcut: "Ctrl+Shift+I",
    group: "segment",
    editorOnly: true,
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.insertTag(false),
  },
  {
    id: "editor.insertTagPair",
    label: "Insert next protected tag pair",
    shortcut: "Ctrl+Alt+I",
    group: "segment",
    editorOnly: true,
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.insertTag(true),
  },
  {
    id: "editor.moveTag",
    label: "Move selected tag to caret",
    shortcut: "Ctrl+Alt+G",
    group: "segment",
    editorOnly: true,
    isEnabled: (context) =>
      hasEditableSegment(context) && context.hasSelectedTargetTag,
    dispatch: (handlers) => handlers.moveTag(),
  },
  {
    id: "editor.split",
    label: "Split segment at caret",
    shortcut: "Ctrl+Alt+S",
    group: "segment",
    editorOnly: true,
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.split(),
  },
  {
    id: "editor.merge",
    label: "Merge split siblings",
    shortcut: "Ctrl+Alt+J",
    group: "segment",
    isEnabled: (context) => hasEditableSegment(context) && context.canMerge,
    dispatch: (handlers) => handlers.merge(),
  },
  {
    id: "editor.correctSource",
    label: "Correct source",
    shortcut: "Ctrl+Alt+E",
    group: "review",
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.correctSource(),
  },
  {
    id: "editor.chineseConversion",
    label: "Convert Simplified / Traditional Chinese",
    shortcut: "Ctrl+Alt+Shift+C",
    group: "segment",
    editorOnly: true,
    isEnabled: hasEditableSegment,
    dispatch: (handlers) => handlers.openChineseConversion(),
  },
  {
    id: "editor.comment",
    label: "Open comments",
    shortcut: "Ctrl+Alt+M",
    group: "segment",
    isEnabled: hasActiveSegment,
    dispatch: (handlers) => handlers.openComments(),
  },
  {
    id: "editor.review",
    label: "Open review revisions",
    shortcut: "Ctrl+Alt+R",
    group: "review",
    isEnabled: hasActiveSegment,
    dispatch: (handlers) => handlers.openReview(),
  },
  {
    id: "editor.workflow",
    label: "Advance workflow state",
    shortcut: "Ctrl+Alt+W",
    group: "review",
    isEnabled: hasActiveSegment,
    dispatch: (handlers) => handlers.advanceWorkflow(),
  },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `editor.suggestion.${index + 1}` as EditorCommandId,
    label: `Insert suggestion ${index + 1}`,
    shortcut: `Ctrl+${index + 1}`,
    group: "segment" as const,
    editorOnly: true,
    isEnabled: (context: EditorCommandContext) =>
      hasEditableSegment(context) && context.visibleSuggestionCount > index,
    dispatch: (handlers: EditorCommandHandlers) =>
      handlers.insertSuggestion(index),
  })),
  {
    id: "editor.undo",
    label: "Undo",
    shortcut: "Ctrl+Z",
    group: "history",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.undo(),
  },
  {
    id: "editor.redo",
    label: "Redo",
    shortcut: "Ctrl+Y",
    group: "history",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.redo(),
  },
  {
    id: "editor.palette",
    label: "Command palette",
    shortcut: "Ctrl+K",
    group: "view",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.openPalette(),
  },
  {
    id: "editor.preferences",
    label: "Editor preferences and shortcuts",
    shortcut: "Ctrl+,",
    group: "view",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.openPreferences(),
  },
  {
    id: "editor.toggleSuggestions",
    label: "Toggle Suggestions",
    shortcut: "Ctrl+Alt+Right",
    group: "view",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.toggleSuggestions(),
  },
  {
    id: "editor.togglePreview",
    label: "Toggle preview",
    shortcut: "Ctrl+Alt+Down",
    group: "view",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.togglePreview(),
  },
  {
    id: "editor.toggleTheme",
    label: "Cycle theme",
    shortcut: "Ctrl+Alt+T",
    group: "view",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.toggleTheme(),
  },
  {
    id: "editor.zoomIn",
    label: "Zoom in",
    shortcut: "Ctrl+=",
    group: "view",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.zoomIn(),
  },
  {
    id: "editor.zoomOut",
    label: "Zoom out",
    shortcut: "Ctrl+-",
    group: "view",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.zoomOut(),
  },
  {
    id: "editor.toggleNonprinting",
    label: "Toggle nonprinting marks",
    shortcut: "F9",
    group: "view",
    isEnabled: alwaysEnabled,
    dispatch: (handlers) => handlers.toggleNonprinting(),
  },
] as const;

export function commandById(id: EditorCommandId): EditorCommandDefinition {
  const command = EDITOR_COMMANDS.find((item) => item.id === id);
  if (!command) throw new Error(`Unknown editor command: ${id}`);
  return command;
}

export function isEditorCommandEnabled(
  command: EditorCommandDefinition,
  context: EditorCommandContext,
  invocation: EditorCommandInvocation = "external",
): boolean {
  if (
    invocation === "keyboard" &&
    command.editorOnly &&
    !context.editorFocused
  ) {
    return false;
  }
  return command.isEnabled(context);
}

export function dispatchEditorCommand(
  id: EditorCommandId,
  handlers: EditorCommandHandlers,
): void {
  commandById(id).dispatch(handlers);
}

export function shortcutMatches(
  event: KeyboardEvent,
  shortcut: string,
): boolean {
  const parts = shortcut.toLocaleLowerCase().split("+");
  const key = parts.at(-1);
  if (!key) return false;
  const wantsCtrl = parts.includes("ctrl");
  const wantsAlt = parts.includes("alt");
  const wantsShift = parts.includes("shift");
  const normalizedKey = event.key.toLocaleLowerCase();
  return (
    normalizedKey === key &&
    (event.ctrlKey || event.metaKey) === wantsCtrl &&
    event.altKey === wantsAlt &&
    event.shiftKey === wantsShift
  );
}

export function acceleratorLabel(shortcut: string): string {
  return shortcut.replace(
    "Ctrl",
    navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
  );
}
