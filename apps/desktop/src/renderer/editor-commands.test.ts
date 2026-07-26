import { describe, expect, it, vi } from "vitest";

import {
  EDITOR_COMMANDS,
  commandById,
  dispatchEditorCommand,
  isEditorCommandEnabled,
  validateShortcutBindings,
  type EditorCommandContext,
  type EditorCommandHandlers,
} from "./editor-commands";

function commandContext(
  overrides: Partial<EditorCommandContext> = {},
): EditorCommandContext {
  return {
    hasActiveSegment: true,
    hasActiveEditorRow: true,
    editorFocused: true,
    isComposing: false,
    isSigned: false,
    canMerge: false,
    hasSelectedTargetTag: false,
    visibleSuggestionCount: 1,
    ...overrides,
  };
}

function commandHandlers(): EditorCommandHandlers {
  return {
    save: vi.fn(),
    confirm: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    openFindReplace: vi.fn(),
    openConcordance: vi.fn(),
    copySource: vi.fn(),
    copyTags: vi.fn(),
    insertTag: vi.fn(),
    moveTag: vi.fn(),
    split: vi.fn(),
    merge: vi.fn(),
    correctSource: vi.fn(),
    openChineseConversion: vi.fn(),
    openComments: vi.fn(),
    openReview: vi.fn(),
    advanceWorkflow: vi.fn(),
    insertSuggestion: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    openPalette: vi.fn(),
    openPreferences: vi.fn(),
    toggleSuggestions: vi.fn(),
    togglePreview: vi.fn(),
    toggleTheme: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    toggleNonprinting: vi.fn(),
  };
}

describe("editor command registry", () => {
  it("owns a unique enabled predicate and dispatcher for every command", () => {
    expect(new Set(EDITOR_COMMANDS.map((command) => command.id)).size).toBe(
      EDITOR_COMMANDS.length,
    );
    for (const command of EDITOR_COMMANDS) {
      expect(command.isEnabled).toEqual(expect.any(Function));
      expect(command.dispatch).toEqual(expect.any(Function));
    }
  });

  it("applies signed, composition, focus, and suggestion enablement centrally", () => {
    const insertPair = commandById("editor.insertTagPair");
    expect(isEditorCommandEnabled(insertPair, commandContext())).toBe(true);
    expect(
      isEditorCommandEnabled(insertPair, commandContext({ isSigned: true })),
    ).toBe(false);
    expect(
      isEditorCommandEnabled(insertPair, commandContext({ isComposing: true })),
    ).toBe(false);
    expect(
      isEditorCommandEnabled(
        insertPair,
        commandContext({ editorFocused: false }),
        "keyboard",
      ),
    ).toBe(false);
    expect(
      isEditorCommandEnabled(
        insertPair,
        commandContext({ editorFocused: false }),
        "palette",
      ),
    ).toBe(true);
    expect(
      isEditorCommandEnabled(
        commandById("editor.suggestion.2"),
        commandContext({ visibleSuggestionCount: 1 }),
      ),
    ).toBe(false);
  });

  it("dispatches tag and suggestion commands through registry handlers", () => {
    const handlers = commandHandlers();
    dispatchEditorCommand("editor.insertTagPair", handlers);
    dispatchEditorCommand("editor.suggestion.3", handlers);
    expect(handlers.insertTag).toHaveBeenCalledWith(true);
    expect(handlers.insertSuggestion).toHaveBeenCalledWith(2);
  });

  it("rejects empty, colliding, and globally reserved shortcut bindings", () => {
    const reserved = "Ctrl+Shift+K";
    expect(validateShortcutBindings(["Ctrl+S", ""], reserved)).toBe("empty");
    expect(validateShortcutBindings(["Ctrl+S", " ctrl+s "], reserved)).toBe(
      "collision",
    );
    expect(validateShortcutBindings(["Ctrl+S", "ctrl+shift+k"], reserved)).toBe(
      "reserved",
    );
    expect(validateShortcutBindings(["Ctrl+S", "Ctrl+Shift+F"], reserved)).toBe(
      null,
    );
  });
});
