import { useEffect, useRef } from "react";
import type { EditorSuggestion } from "@translunar/contracts";

import type { SegmentEditState } from "../state/save-coordinator";
import { SuggestionPopup } from "./SuggestionPopup";

export interface TargetEditorProps {
  segmentId: string;
  value: string;
  editState: SegmentEditState | null;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onConfirm: (event: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
    altKey?: boolean;
    shiftKey?: boolean;
  }) => void;
  /** Ctrl+1..9 takes the nth memory match without leaving the target. */
  onApplyMatchByIndex?: (index: number) => void;
  /** As-you-type completions, rendered under the caret. */
  suggestions?: SuggestionBinding;
}

export interface SuggestionBinding {
  items: EditorSuggestion[];
  activeIndex: number;
  request: (targetText: string, caret: number) => void;
  dismiss: () => void;
  move: (delta: number) => void;
  accept: () => EditorSuggestion | null;
  setActiveIndex: (index: number) => void;
  /** Replace the word under the caret with the accepted completion. */
  onAccepted: (suggestion: EditorSuggestion) => void;
}

export function TargetEditor({
  segmentId,
  value,
  editState,
  disabled,
  autoFocus,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onApplyMatchByIndex,
  suggestions,
}: TargetEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const open = (suggestions?.items.length ?? 0) > 0;

  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
    }
  }, [autoFocus, segmentId]);

  const dirty =
    editState &&
    editState.segmentId === segmentId &&
    (editState.editGeneration !== editState.savedGeneration ||
      editState.draftTarget !== editState.engineTarget);
  const errored =
    editState?.segmentId === segmentId && editState.saveState === "error";

  const className = [
    "target-editor",
    dirty ? "target-editor--dirty" : "",
    errored ? "target-editor--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="target-editor__shell">
      <textarea
        ref={ref}
        className={className}
        data-testid={`target-editor-${segmentId}`}
        aria-label="Target"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          suggestions?.request(e.target.value, e.target.selectionStart ?? 0);
        }}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onBlur={() => suggestions?.dismiss()}
        onKeyDown={(e) => {
          // The completion list owns these keys only while it is open, and never
          // during composition: an IME uses the same arrows and Enter to choose
          // among its own candidates, and stealing them destroys input.
          if (
            open &&
            suggestions &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229
          ) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              suggestions.move(1);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              suggestions.move(-1);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              suggestions.dismiss();
              return;
            }
            if (
              e.key === "Tab" ||
              (e.key === "Enter" && !e.ctrlKey && !e.metaKey)
            ) {
              const chosen = suggestions.accept();
              if (chosen) {
                e.preventDefault();
                suggestions.onAccepted(chosen);
                return;
              }
            }
          }
          if (
            onApplyMatchByIndex &&
            (e.ctrlKey || e.metaKey) &&
            !e.altKey &&
            /^[1-9]$/.test(e.key)
          ) {
            // Digits are safe to intercept here: the target is prose, and every
            // CAT tool this product's users come from binds them to the match
            // list. Composition is checked because an IME candidate window uses
            // the same digits to pick a candidate.
            if (
              e.nativeEvent.isComposing ||
              e.keyCode === 229 ||
              e.which === 229
            ) {
              return;
            }
            e.preventDefault();
            onApplyMatchByIndex(Number(e.key) - 1);
            return;
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            // Do not preventDefault when IME is active — check all 229 signals first.
            if (
              e.nativeEvent.isComposing ||
              e.keyCode === 229 ||
              e.which === 229
            ) {
              return;
            }
            e.preventDefault();
            // Alt and Shift choose where the caret lands next; see
            // state/confirm-advance.ts for the contract.
            onConfirm({
              isComposing: e.nativeEvent.isComposing,
              keyCode: e.keyCode,
              which: e.which,
              altKey: e.altKey,
              shiftKey: e.shiftKey,
            });
          }
        }}
      />
      {open && suggestions ? (
        <SuggestionPopup
          suggestions={suggestions.items}
          activeIndex={suggestions.activeIndex}
          onHover={suggestions.setActiveIndex}
          onAccept={(suggestion) => {
            suggestions.accept();
            suggestions.onAccepted(suggestion);
          }}
          onDismiss={suggestions.dismiss}
        />
      ) : null}
    </div>
  );
}
