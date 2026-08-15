import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { EditorSuggestion, InlineTag } from "@translunar/contracts";

import {
  extractPlaceables,
  pairSourceTags,
  unmatchedSourceTags,
  type Placeable,
} from "../lib/quickplace";
import {
  buildTaggedEditorHtml,
  caretOffsetsInTaggedEditor,
  alignGhostPositions,
  insertTextIntoTagged,
  mergeTargetTags,
  serializeTaggedEditor,
  setCaretInTaggedEditor,
  tagsEqual,
  wrapSelectionWithTagPair,
} from "../lib/tagged-text";
import type { SegmentEditState } from "../state/save-coordinator";
import { QuickPlacePopup } from "./QuickPlacePopup";
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
  sourceText?: string;
  sourceTags?: readonly InlineTag[];
  quickPlaceOpen?: boolean;
  onQuickPlaceOpenChange?: (open: boolean) => void;
  onPlaceAllTags?: () => void;
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
  sourceText = "",
  sourceTags = [],
  quickPlaceOpen = false,
  onQuickPlaceOpenChange,
  onPlaceAllTags,
}: TargetEditorProps) {
  const mirrorRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const skipSync = useRef(false);
  const composing = useRef(false);
  const [quickIndex, setQuickIndex] = useState(0);
  const placeables = useMemo(
    () => extractPlaceables(sourceText, sourceTags),
    [sourceText, sourceTags],
  );
  const ghosts = useMemo(
    () => unmatchedSourceTags(sourceTags, tags),
    [sourceTags, tags],
  );
  const ghostsAt = useMemo(
    () => alignGhostPositions(sourceText, value, ghosts),
    [ghosts, sourceText, value],
  );
  const open = !quickPlaceOpen && (suggestions?.items.length ?? 0) > 0;

  useEffect(() => {
    if (quickPlaceOpen) setQuickIndex(0);
  }, [quickPlaceOpen, segmentId]);

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
    const next = buildTaggedEditorHtml(value, tags, ghostsAt);
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
  }, [value, tags, ghostsAt, segmentId]);

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

  const currentCaret = () => {
    const surface = surfaceRef.current;
    if (!surface) {
      const end = [...value].length;
      return { start: end, end };
    }
    return caretOffsetsInTaggedEditor(
      surface,
      surface.ownerDocument.defaultView?.getSelection() ?? null,
    );
  };

  const applyTags = (next: InlineTag[]) => {
    if (!onTagsChange || tagsEqual(next, tags)) return;
    onTagsChange(next);
  };

  const applyPlaceable = (item: Placeable) => {
    onQuickPlaceOpenChange?.(false);
    if (item.kind === "all-tags") {
      onPlaceAllTags?.();
      return;
    }
    const caret = currentCaret();
    if (item.kind === "tag-pair" && item.tags?.[0] && item.tags[1]) {
      applyTags(
        mergeTargetTags(
          tags,
          wrapSelectionWithTagPair(
            item.tags[0],
            item.tags[1],
            caret.start,
            caret.end,
          ),
        ),
      );
      return;
    }
    if (item.kind === "tag" && item.tags?.[0]) {
      const tag = item.tags[0];
      applyTags(
        mergeTargetTags(tags, [
          {
            ...tag,
            id: `placed-g:${tag.id}`,
            side: "target",
            position: caret.start,
            protected: true,
          },
        ]),
      );
      return;
    }
    if (!item.text) return;
    const inserted = insertTextIntoTagged(value, tags, caret.start, item.text);
    skipSync.current = true;
    onChange(inserted.text);
    applyTags(inserted.tags);
    const surface = surfaceRef.current;
    if (surface) {
      surface.innerHTML = buildTaggedEditorHtml(
        inserted.text,
        inserted.tags,
        alignGhostPositions(
          sourceText,
          inserted.text,
          unmatchedSourceTags(sourceTags, inserted.tags),
        ),
      );
      setCaretInTaggedEditor(
        surface,
        caret.start + [...item.text].length,
      );
    }
  };

  const paintTags = (nextTags: InlineTag[]) => {
    applyTags(nextTags);
    const surface = surfaceRef.current;
    if (!surface) return;
    skipSync.current = true;
    const nextGhosts = alignGhostPositions(
      sourceText,
      value,
      unmatchedSourceTags(sourceTags, nextTags),
    );
    surface.innerHTML = buildTaggedEditorHtml(value, nextTags, nextGhosts);
  };

  const placeGhost = (ghost: InlineTag) => {
    const caret = currentCaret();
    const { pairs } = pairSourceTags(sourceTags);
    const pair = pairs.find(
      (item) => item.start.id === ghost.id || item.end.id === ghost.id,
    );
    if (pair) {
      const selected = caret.start !== caret.end;
      const from = selected
        ? caret.start
        : (ghostsAt.find((item) => item.id === pair.start.id)?.position ??
          caret.start);
      const to = selected
        ? caret.end
        : (ghostsAt.find((item) => item.id === pair.end.id)?.position ??
          caret.end);
      paintTags(
        mergeTargetTags(
          tags,
          wrapSelectionWithTagPair(pair.start, pair.end, from, to),
        ),
      );
      return;
    }
    const at =
      ghostsAt.find((item) => item.id === ghost.id)?.position ?? caret.start;
    paintTags(
      mergeTargetTags(tags, [
        {
          ...ghost,
          id: `placed-g:${ghost.id}`,
          side: "target",
          position: at,
          protected: true,
        },
      ]),
    );
  };

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
    if (quickPlaceOpen && !isImeKey(event)) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setQuickIndex((index) =>
          placeables.length === 0 ? 0 : (index + 1) % placeables.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setQuickIndex((index) =>
          placeables.length === 0
            ? 0
            : (index - 1 + placeables.length) % placeables.length,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onQuickPlaceOpenChange?.(false);
        return;
      }
      if (
        event.key === "Tab" ||
        (event.key === "Enter" && !event.ctrlKey && !event.metaKey)
      ) {
        const chosen = placeables[quickIndex] ?? placeables[0];
        if (chosen) {
          event.preventDefault();
          applyPlaceable(chosen);
          return;
        }
      }
    }
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
      onQuickPlaceOpenChange?.(false);
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
        data-ghost-count={ghosts.length}
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
        onMouseDown={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const ghostEl = target.closest("[data-ghost]");
          if (!(ghostEl instanceof HTMLElement)) return;
          event.preventDefault();
          if (disabled === true || composing.current) return;
          const id = ghostEl.dataset.ghost;
          const ghost = ghosts.find((item) => item.id === id);
          if (ghost) placeGhost(ghost);
        }}
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
      {ghosts.length > 0 ? (
        <span className="sr-only" data-testid="target-ghosts">
          {ghosts.length} missing tags
        </span>
      ) : null}
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
          onClick={() => {
            onQuickPlaceOpenChange?.(false);
            void onConfirm({});
          }}
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
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={disabled === true}
          data-testid={`quickplace-open-${segmentId}`}
          title="QuickPlace (Ctrl+Shift+,)"
          aria-expanded={quickPlaceOpen}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setQuickIndex(0);
            onQuickPlaceOpenChange?.(!quickPlaceOpen);
          }}
        >
          Place
        </button>
      </div>
      {quickPlaceOpen ? (
        <QuickPlacePopup
          items={placeables}
          activeIndex={quickIndex}
          onHover={setQuickIndex}
          onAccept={applyPlaceable}
          onDismiss={() => onQuickPlaceOpenChange?.(false)}
        />
      ) : null}
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
