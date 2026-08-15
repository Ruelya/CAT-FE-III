import { useEffect, useRef, type KeyboardEvent } from "react";
import type { EditorSuggestion, InlineTag } from "@translunar/contracts";

import {
  buildTaggedEditorHtml,
  caretOffsetsInTaggedEditor,
  serializeTaggedEditor,
  setCaretInTaggedEditor,
  tagsEqual,
} from "../lib/tagged-text";
import type { SegmentEditState } from "../state/save-coordinator";
import { SuggestionPopup } from "./SuggestionPopup";

export interface TargetEditorProps {
  segmentId: string;
  value: string;
  tags?: readonly InlineTag[];
  editState: SegmentEditState | null;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onTagsChange?: (tags: InlineTag[]) => void;
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
  /** Segment ordinal shown on the Confirm control for a11y. */
  confirmLabel?: string;
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

function isImeKey(event: {
  nativeEvent: { isComposing?: boolean };
  keyCode: number;
  which: number;
}): boolean {
  return (
    event.nativeEvent.isComposing === true ||
    event.keyCode === 229 ||
    event.which === 229
  );
}

export function TargetEditor({
  segmentId,
  value,
  tags = [],
  editState,
  disabled,
  autoFocus,
  onChange,
  onTagsChange,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onApplyMatchByIndex,
  suggestions,
  confirmLabel,
}: TargetEditorProps) {
  const mirrorRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const skipSync = useRef(false);
  const composing = useRef(false);
  const open = (suggestions?.items.length ?? 0) > 0;

  useEffect(() => {
    if (autoFocus) {
      surfaceRef.current?.focus();
    }
  }, [autoFocus, segmentId]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (skipSync.current) {
      skipSync.current = false;
      return;
    }
    if (composing.current) return;
    const next = buildTaggedEditorHtml(value, tags);
    if (surface.innerHTML !== next) {
      const caret = caretOffsetsInTaggedEditor(
        surface,
        surface.ownerDocument.defaultView?.getSelection() ?? null,
      ).start;
      surface.innerHTML = next;
      if (document.activeElement === surface) {
        setCaretInTaggedEditor(surface, Math.min(caret, [...value].length));
      }
    }
  }, [value, tags, segmentId]);

  const dirty =
    editState &&
    editState.segmentId === segmentId &&
    (editState.editGeneration !== editState.savedGeneration ||
      editState.draftTarget !== editState.engineTarget);
  const errored =
    editState?.segmentId === segmentId && editState.saveState === "error";
  const confirming =
    editState?.segmentId === segmentId && editState.saveState === "saving";

  const className = [
    "target-editor",
    "target-editor--rich",
    dirty ? "target-editor--dirty" : "",
    errored ? "target-editor--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const emitFromSurface = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const serialized = serializeTaggedEditor(surface);
    skipSync.current = true;
    onChange(serialized.text);
    if (onTagsChange && !tagsEqual(serialized.tags, tags)) {
      onTagsChange(serialized.tags);
    }
    const caret = caretOffsetsInTaggedEditor(
      surface,
      surface.ownerDocument.defaultView?.getSelection() ?? null,
    ).end;
    suggestions?.request(serialized.text, caret);
  };

  const handleKeys = (
    event: KeyboardEvent<HTMLElement>,
    caretFallback: number,
  ) => {
    if (open && suggestions && !isImeKey(event)) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        suggestions.move(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        suggestions.move(-1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        suggestions.dismiss();
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.ctrlKey && !event.metaKey)) {
        const chosen = suggestions.accept();
        if (chosen) {
          event.preventDefault();
          suggestions.onAccepted(chosen);
          return;
        }
      }
    }
    if (
      onApplyMatchByIndex &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      /^[1-9]$/.test(event.key)
    ) {
      if (isImeKey(event)) return;
      event.preventDefault();
      onApplyMatchByIndex(Number(event.key) - 1);
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      if (isImeKey(event)) return;
      event.preventDefault();
      onConfirm({
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
        which: event.which,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      });
      return;
    }
    if (event.currentTarget === surfaceRef.current && event.key.length === 1) {
      suggestions?.request(value, caretFallback);
    }
  };

  return (
    <div className="target-editor__shell">
      <div
        ref={surfaceRef}
        className={className}
        data-testid={`target-surface-${segmentId}`}
        data-target-text={value}
        role="textbox"
        aria-multiline="true"
        aria-label="Target"
        aria-disabled={disabled === true}
        contentEditable={disabled !== true}
        suppressContentEditableWarning
        onInput={() => {
          if (composing.current) return;
          emitFromSurface();
        }}
        onCompositionStart={() => {
          composing.current = true;
          onCompositionStart();
        }}
        onCompositionEnd={() => {
          composing.current = false;
          onCompositionEnd();
          emitFromSurface();
        }}
        onBlur={() => suggestions?.dismiss()}
        onKeyDown={(event) => {
          const caret = surfaceRef.current
            ? caretOffsetsInTaggedEditor(
                surfaceRef.current,
                event.currentTarget.ownerDocument.defaultView?.getSelection() ??
                  null,
              ).end
            : [...value].length;
          handleKeys(event, caret);
        }}
        onPaste={(event) => {
          event.preventDefault();
          const pasted = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, pasted);
        }}
      />
      <textarea
        ref={mirrorRef}
        className="sr-only"
        data-testid={`target-editor-${segmentId}`}
        aria-hidden="true"
        tabIndex={-1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          suggestions?.request(e.target.value, e.target.selectionStart ?? 0);
        }}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={(e) => {
          handleKeys(e, e.currentTarget.selectionStart ?? [...value].length);
        }}
      />
      <div className="target-editor__actions">
        <span className="target-editor__hint" aria-hidden="true">
          Ctrl+Enter
        </span>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={disabled === true || confirming || editState?.isComposing}
          onClick={() => void onConfirm({})}
          aria-label={
            confirmLabel
              ? `Confirm segment ${confirmLabel}`
              : "Confirm segment"
          }
          title="Confirm (Ctrl+Enter)"
          data-testid={`confirm-segment-${segmentId}`}
        >
          Confirm
        </button>
      </div>
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
