import { useEffect } from "react";

export interface EditorShortcutHandlers {
  /** F3: look the current selection up across the memory. */
  onConcordance: () => void;
  /** Ctrl+Shift+T: store the selected source and target as a term. */
  onQuickAddTerm: () => void;
  /** Ctrl+Insert: put the source into the target verbatim. */
  onCopySource: () => void;
  /** Ctrl+Delete: empty the target. */
  onClearTarget: () => void;
  /** Ctrl+G: jump to a segment by number. */
  onGoTo: () => void;
  /** Ctrl+Shift+P: pretranslate empty targets from memory. */
  onPretranslate: () => void;
  /** Ctrl+,: place source tags onto the target. */
  onPlaceTags: () => void;
  /** Ctrl+Shift+,: open the QuickPlace list. */
  onQuickPlace?: () => void;
  /** Ctrl+F: open find on the current document. */
  onFind?: () => void;
  /** F4 / Ctrl+G already used; Enter-next from Find uses this. */
  onFindNext?: () => void;
}

/**
 * Segment-level shortcuts that must work wherever the caret is in the editor.
 *
 * These are bound at the window because a translator uses them while typing in
 * the target, while reading the source, and while standing in a dock, and a
 * shortcut that only works in one of those places is a shortcut they stop
 * trusting. The chosen chords are the ones the same users already have in
 * their fingers from Trados and memoQ.
 *
 * Nothing fires during IME composition: the same keys drive candidate windows,
 * and stealing them mid-composition destroys input rather than accelerating it.
 */
export function useEditorShortcuts(
  enabled: boolean,
  handlers: EditorShortcutHandlers,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const control = event.ctrlKey || event.metaKey;

      if (event.key === "F3" && !event.altKey) {
        event.preventDefault();
        handlers.onConcordance();
        return;
      }
      if (control && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        handlers.onQuickAddTerm();
        return;
      }
      if (control && event.key === "Insert") {
        event.preventDefault();
        handlers.onCopySource();
        return;
      }
      if (control && event.key === "Delete") {
        event.preventDefault();
        handlers.onClearTarget();
        return;
      }
      if (control && !event.shiftKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        handlers.onGoTo();
        return;
      }
      if (control && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        handlers.onPretranslate();
        return;
      }
      if (control && event.shiftKey && event.code === "Comma") {
        event.preventDefault();
        handlers.onQuickPlace?.();
        return;
      }
      if (control && event.key === ",") {
        event.preventDefault();
        if (handlers.onQuickPlace) {
          handlers.onQuickPlace();
          return;
        }
        handlers.onPlaceTags();
      }
      if (control && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        handlers.onFind?.();
        return;
      }
      if (event.key === "F4" && !event.altKey) {
        event.preventDefault();
        handlers.onFindNext?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    handlers.onConcordance,
    handlers.onQuickAddTerm,
    handlers.onCopySource,
    handlers.onClearTarget,
    handlers.onGoTo,
    handlers.onPretranslate,
    handlers.onPlaceTags,
    handlers.onQuickPlace,
    handlers.onFind,
    handlers.onFindNext,
  ]);
}
