import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { EditorSuggestion, InlineTag } from "@translunar/contracts";

import {
  extractPlaceables,
  pairSourceTags,
  pendingCloseGhosts,
  type Placeable,
} from "../lib/quickplace";
import {
  buildTaggedEditorHtml,
  caretOffsetsInTaggedEditor,
  insertTextIntoTagged,
  mergeTargetTags,
  placeTagAtCaret,
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
  const [followCaret, setFollowCaret] = useState(0);
  const ghostEnds = useRef(new Map<string, number>());
  const placeables = useMemo(
    () => extractPlaceables(sourceText, sourceTags, tags),
    [sourceText, sourceTags, tags],
  );
  const ghostsAt = useMemo(() => {
    const next = pendingCloseGhosts(
      sourceTags,
      tags,
      followCaret,
      ghostEnds.current,
      [...value].length,
    );
    const remembered = new Map<string, number>();
    for (const ghost of next) remembered.set(ghost.id, ghost.position);
    ghostEnds.current = remembered;
    return next;
  }, [sourceTags, tags, value, followCaret]);
  const open = !quickPlaceOpen && (suggestions?.items.length ?? 0) > 0;

  useEffect(() => {
    if (quickPlaceOpen) setQuickIndex(0);
  }, [quickPlaceOpen, segmentId]);

  useEffect(() => {
    ghostEnds.current = new Map();
    setFollowCaret(0);
  }, [segmentId]);

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

  const paint = (nextText: string, nextTags: InlineTag[], caret = followCaret) => {
    const nextGhosts = pendingCloseGhosts(
      sourceTags,
      nextTags,
      caret,
      ghostEnds.current,
      [...nextText].length,
    );
    const remembered = new Map<string, number>();
    for (const ghost of nextGhosts) remembered.set(ghost.id, ghost.position);
    ghostEnds.current = remembered;
    const surface = surfaceRef.current;
    if (!surface) return;
    skipSync.current = true;
    surface.innerHTML = buildTaggedEditorHtml(nextText, nextTags, nextGhosts);
  };

  const applyPlaceable = (item: Placeable) => {
    onQuickPlaceOpenChange?.(false);
    if (item.kind === "all-tags") {
      onPlaceAllTags?.();
      return;
    }
    const caret = currentCaret();
    const { pairs } = pairSourceTags(sourceTags);
    if (
      (item.kind === "tag-pair" || item.kind === "tag") &&
      item.tags?.[0] &&
      caret.start !== caret.end
    ) {
      const start = item.tags[0];
      const pair =
        item.tags[1] && item.tags[0]
          ? { start: item.tags[0], end: item.tags[1] }
          : pairs.find(
              (entry) =>
                entry.start.id === start.id || entry.end.id === start.id,
            );
      if (pair) {
        const next = mergeTargetTags(
          tags,
          wrapSelectionWithTagPair(pair.start, pair.end, caret.start, caret.end),
        );
        applyTags(next);
        paint(value, next, caret.end);
        return;
      }
    }
    if (item.kind === "tag-pair" && item.tags?.[0] && item.tags[1]) {
      const next = mergeTargetTags(
        tags,
        wrapSelectionWithTagPair(
          item.tags[0],
          item.tags[1],
          caret.start,
          caret.end,
        ),
      );
      applyTags(next);
      paint(value, next, caret.end);
      return;
    }
    if (item.kind === "tag" && item.tags?.[0]) {
      const tag = item.tags[0];
      const next = mergeTargetTags(tags, [placeTagAtCaret(tag, caret.start)]);
      applyTags(next);
      if (tag.kind === "start") {
        ghostEnds.current.set(
          pairs.find((entry) => entry.start.id === tag.id)?.end.id ?? tag.id,
          caret.start,
        );
      }
      paint(value, next, caret.start);
      setFollowCaret(caret.start);
      return;
    }
    if (!item.text) return;
    const inserted = insertTextIntoTagged(value, tags, caret.start, item.text);
    skipSync.current = true;
    onChange(inserted.text);
    applyTags(inserted.tags);
    const nextCaret = caret.start + [...item.text].length;
    setFollowCaret(nextCaret);
    paint(inserted.text, inserted.tags, nextCaret);
    const surface = surfaceRef.current;
    if (surface) setCaretInTaggedEditor(surface, nextCaret);
  };

  const placeGhost = (ghost: InlineTag) => {
    const at =
      ghostsAt.find((item) => item.id === ghost.id)?.position ??
      currentCaret().start;
    const next = mergeTargetTags(tags, [placeTagAtCaret(ghost, at)]);
    applyTags(next);
    ghostEnds.current.delete(ghost.id);
    paint(value, next, at);
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
    setFollowCaret(caret);
    const nextGhosts = pendingCloseGhosts(
      sourceTags,
      serialized.tags,
      caret,
      ghostEnds.current,
      [...serialized.text].length,
    );
    const remembered = new Map<string, number>();
    for (const ghost of nextGhosts) remembered.set(ghost.id, ghost.position);
    ghostEnds.current = remembered;
    const painted = buildTaggedEditorHtml(
      serialized.text,
      serialized.tags,
      nextGhosts,
    );
    if (surface.innerHTML !== painted) {
      surface.innerHTML = painted;
      setCaretInTaggedEditor(surface, caret);
    }
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
        data-ghost-count={ghostsAt.length}
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
          const ghost = ghostsAt.find((item) => item.id === id);
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
      {ghostsAt.length > 0 ? (
        <span className="sr-only" data-testid="target-ghosts">
          {ghostsAt.length} unclosed tags
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
