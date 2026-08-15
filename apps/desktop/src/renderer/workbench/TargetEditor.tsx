import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import type { EditorSuggestion, InlineTag } from "@translunar/contracts";

import { smartPastePlain, type EditorDisplay } from "../lib/editor-display";
import {
  adjacentPlaceholderGroupAt,
  extractPlaceables,
  formatPairForKey,
  pairSourceTags,
  pendingCloseGhosts,
  placeableSourceSpan,
  unmatchedSourceTags,
  type Placeable,
} from "../lib/quickplace";
import {
  buildTaggedEditorHtml,
  caretOffsetsInTaggedEditor,
  decodeInlineTag,
  deleteRangeFromTagged,
  deleteRangeKeepingTags,
  insertTextIntoTagged,
  mergeTargetTags,
  pasteTaggedSpan,
  placeTagAtCaret,
  rememberTaggedClip,
  rememberedTaggedClip,
  replaceSelectionInTagged,
  selectTagAtoms,
  serializeTaggedEditor,
  setCaretInTaggedEditor,
  sliceTaggedSpan,
  tagAtomsInSelection,
  tagsEqual,
  TAGGED_CLIPBOARD_TYPE,
  wrapSelectionWithTagPair,
  type TaggedClipboard,
} from "../lib/tagged-text";
import type { SourceHighlight } from "./TaggedText";
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
  onSourceHighlight?: (span: SourceHighlight | null) => void;
  protectTags?: boolean;
  onProtectTagsChange?: (next: boolean) => void;
  groupAdjacent?: boolean;
  onGroupAdjacentChange?: (next: boolean) => void;
  display?: EditorDisplay;
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
  onSourceHighlight,
  protectTags = false,
  onProtectTagsChange,
  groupAdjacent = true,
  onGroupAdjacentChange,
  display,
}: TargetEditorProps) {
  const mirrorRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const skipSync = useRef(false);
  const composing = useRef(false);
  const [quickIndex, setQuickIndex] = useState(0);
  const [followCaret, setFollowCaret] = useState(0);
  const [liveTags, setLiveTags] = useState<InlineTag[] | null>(null);
  const ghostEnds = useRef(new Map<string, number>());
  const ghostsAtRef = useRef<InlineTag[]>([]);
  const effectiveTags = liveTags ?? tags;
  const paintDisplay = useMemo(
    () => ({
      formatting: display?.formatting ?? ("full" as const),
      tagText: display?.tagText ?? ("partial" as const),
      whitespace: display?.whitespace === true,
    }),
    [display?.formatting, display?.tagText, display?.whitespace],
  );
  const paintHtml = (
    nextText: string,
    nextTags: readonly InlineTag[],
    nextGhosts: readonly InlineTag[],
  ) => buildTaggedEditorHtml(nextText, nextTags, nextGhosts, paintDisplay);
  const [caretBox, setCaretBox] = useState<{ left: number; top: number } | null>(
    null,
  );
  const measureCaret = () => {
    const surface = surfaceRef.current;
    const host = surface?.parentElement;
    const selection = surface?.ownerDocument.defaultView?.getSelection() ?? null;
    if (!surface || !host || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setCaretBox({ left: 8, top: 8 });
      return;
    }
    setCaretBox({
      left: Math.max(0, rect.left - box.left),
      top: Math.max(0, rect.top - box.top),
    });
  };
  const placeables = useMemo(
    () =>
      extractPlaceables(sourceText, sourceTags, effectiveTags, {
        groupAdjacent,
      }),
    [sourceText, sourceTags, effectiveTags, groupAdjacent],
  );
  const ghostsAt = useMemo(() => {
    const next = pendingCloseGhosts(
      sourceTags,
      effectiveTags,
      followCaret,
      ghostEnds.current,
      [...value].length,
    );
    const remembered = new Map<string, number>();
    for (const ghost of next) remembered.set(ghost.id, ghost.position);
    ghostEnds.current = remembered;
    ghostsAtRef.current = next;
    return next;
  }, [sourceTags, effectiveTags, value, followCaret]);
  const open = !quickPlaceOpen && (suggestions?.items.length ?? 0) > 0;

  useEffect(() => {
    if (quickPlaceOpen) setQuickIndex(0);
  }, [quickPlaceOpen, segmentId]);

  useEffect(() => {
    setQuickIndex((index) =>
      placeables.length === 0 ? 0 : Math.min(index, placeables.length - 1),
    );
  }, [placeables]);

  useEffect(() => {
    if (!onSourceHighlight) return;
    if (!quickPlaceOpen) {
      onSourceHighlight(null);
      return;
    }
    onSourceHighlight(placeableSourceSpan(placeables[quickIndex]));
  }, [quickPlaceOpen, quickIndex, placeables, onSourceHighlight]);

  useEffect(() => {
    ghostEnds.current = new Map();
    setFollowCaret(0);
    setLiveTags(null);
  }, [segmentId]);

  useEffect(() => {
    if (liveTags) {
      if (tagsEqual(tags, liveTags)) setLiveTags(null);
      return;
    }
  }, [tags, liveTags]);

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
    const next = paintHtml(value, effectiveTags, ghostsAt);
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
  }, [value, effectiveTags, ghostsAt, segmentId, paintDisplay]);

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

  const liveDocument = () => {
    const surface = surfaceRef.current;
    if (surface) return serializeTaggedEditor(surface);
    return { text: value, tags: effectiveTags };
  };

  const applyTags = (next: InlineTag[]) => {
    if (!onTagsChange || tagsEqual(next, effectiveTags)) return;
    setLiveTags(next);
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
    ghostsAtRef.current = nextGhosts;
    const surface = surfaceRef.current;
    if (!surface) return;
    skipSync.current = true;
    surface.innerHTML = paintHtml(nextText, nextTags, nextGhosts);
    if (surface.ownerDocument.activeElement === surface) {
      setCaretInTaggedEditor(surface, caret);
    }
  };

  const applyPlaceable = (item: Placeable) => {
    onQuickPlaceOpenChange?.(false);
    if (item.kind === "all-tags") {
      onPlaceAllTags?.();
      return;
    }
    const caret = currentCaret();
    const live = liveDocument();
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
          live.tags,
          wrapSelectionWithTagPair(pair.start, pair.end, caret.start, caret.end),
        );
        applyTags(next);
        paint(live.text, next, caret.end);
        return;
      }
    }
    if (item.kind === "tag-group" && item.tags && item.tags.length > 0) {
      const base = item.tags[0]!.position;
      const placed = item.tags.map((tag) =>
        placeTagAtCaret(tag, caret.start + (tag.position - base)),
      );
      const next = mergeTargetTags(live.tags, placed);
      applyTags(next);
      paint(live.text, next, caret.start);
      setFollowCaret(caret.start);
      return;
    }
    if (item.kind === "tag-pair" && item.tags?.[0] && item.tags[1]) {
      const next = mergeTargetTags(
        live.tags,
        wrapSelectionWithTagPair(
          item.tags[0],
          item.tags[1],
          caret.start,
          caret.end,
        ),
      );
      applyTags(next);
      paint(live.text, next, caret.end);
      return;
    }
    if (item.kind === "tag" && item.tags?.[0]) {
      const tag = item.tags[0];
      const next = mergeTargetTags(live.tags, [placeTagAtCaret(tag, caret.start)]);
      applyTags(next);
      const pair = pairs.find(
        (entry) => entry.start.id === tag.id || entry.end.id === tag.id,
      );
      if (tag.kind === "start" && pair) {
        ghostEnds.current.set(pair.end.id, caret.start);
      }
      if (tag.kind === "end" && pair) {
        ghostEnds.current.delete(pair.end.id);
        if (
          unmatchedSourceTags(sourceTags, next).some(
            (item) => item.id === pair.start.id,
          )
        ) {
          ghostEnds.current.set(pair.start.id, caret.start);
        }
      }
      paint(live.text, next, caret.start);
      setFollowCaret(caret.start);
      return;
    }
    if (!item.text) return;
    const inserted = insertTextIntoTagged(
      live.text,
      live.tags,
      caret.start,
      item.text,
    );
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
    const live = liveDocument();
    const at =
      ghost.position ??
      ghostsAtRef.current.find((item) => item.id === ghost.id)?.position ??
      currentCaret().start;
    const next = mergeTargetTags(live.tags, [placeTagAtCaret(ghost, at)]);
    applyTags(next);
    ghostEnds.current.delete(ghost.id);
    paint(live.text, next, at);
  };

  const applyFormatShortcut = (key: string) => {
    const pair = formatPairForKey(sourceTags, key);
    if (!pair) return;
    const caret = currentCaret();
    const live = liveDocument();
    if (caret.start !== caret.end) {
      const next = mergeTargetTags(
        live.tags,
        wrapSelectionWithTagPair(pair.start, pair.end, caret.start, caret.end),
      );
      applyTags(next);
      paint(live.text, next, caret.end);
      return;
    }
    const unmatched = unmatchedSourceTags(sourceTags, live.tags);
    const startPlaced = unmatched.every((tag) => tag.id !== pair.start.id);
    const endPlaced = unmatched.every((tag) => tag.id !== pair.end.id);
    if (startPlaced && !endPlaced) {
      placeGhost({ ...pair.end, position: caret.start });
      return;
    }
    if (!startPlaced && !endPlaced) {
      const next = mergeTargetTags(live.tags, [
        placeTagAtCaret(pair.start, caret.start),
      ]);
      applyTags(next);
      ghostEnds.current.set(pair.end.id, caret.start);
      paint(live.text, next, caret.start);
      setFollowCaret(caret.start);
    }
  };

  const commitLive = (nextText: string, nextTags: InlineTag[], caret: number) => {
    if (nextText !== value) onChange(nextText);
    applyTags(nextTags);
    setFollowCaret(caret);
    paint(nextText, nextTags, caret);
    const surface = surfaceRef.current;
    if (surface) setCaretInTaggedEditor(surface, caret);
  };

  const clipFromSurface = (): TaggedClipboard | null => {
    const live = liveDocument();
    const caret = currentCaret();
    const surface = surfaceRef.current;
    const atoms = surface
      ? tagAtomsInSelection(
          surface,
          surface.ownerDocument.defaultView?.getSelection() ?? null,
        )
      : [];
    if (caret.start === caret.end && atoms.length === 0) return null;
    if (caret.start === caret.end) {
      return {
        text: "",
        tags: atoms.map((tag, index) => ({ ...tag, position: 0, id: `clip:${index}:${tag.id}` })),
      };
    }
    return sliceTaggedSpan(live.text, live.tags, caret.start, caret.end);
  };

  const writeClip = (event: ClipboardEvent, clip: TaggedClipboard) => {
    rememberTaggedClip(clip);
    event.clipboardData.setData("text/plain", clip.text);
    event.clipboardData.setData(TAGGED_CLIPBOARD_TYPE, JSON.stringify(clip));
    event.preventDefault();
  };

  const atomBesideCaret = (side: "before" | "after"): boolean => {
    const surface = surfaceRef.current;
    const selection = surface?.ownerDocument.defaultView?.getSelection() ?? null;
    if (!surface || !selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (side === "before") {
      let node: Node | null = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        if (range.startOffset > 0) return false;
        node = node.previousSibling;
      } else if (range.startOffset > 0) {
        node = node.childNodes[range.startOffset - 1] ?? null;
      }
      return node instanceof HTMLElement && Boolean(node.dataset.tag);
    }
    let node: Node | null = range.endContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      if (range.endOffset < (node.textContent ?? "").length) return false;
      node = node.nextSibling;
    } else {
      node = node.childNodes[range.endOffset] ?? node.nextSibling;
    }
    return node instanceof HTMLElement && Boolean(node.dataset.tag);
  };

  const emitFromSurface = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const serialized = serializeTaggedEditor(surface);
    const have = new Set(
      serialized.tags.map(
        (tag) => `${tag.kind}\0${tag.displayText}\0${tag.payload}`,
      ),
    );
    const missing = protectTags
      ? effectiveTags.filter(
          (tag) => !have.has(`${tag.kind}\0${tag.displayText}\0${tag.payload}`),
        )
      : [];
    const length = [...serialized.text].length;
    const live = {
      text: serialized.text,
      tags:
        missing.length === 0
          ? serialized.tags
          : [
              ...serialized.tags,
              ...missing.map((tag) => ({
                ...tag,
                position: Math.min(tag.position, length),
              })),
            ],
    };
    skipSync.current = true;
    onChange(live.text);
    if (onTagsChange && !tagsEqual(live.tags, effectiveTags)) {
      setLiveTags(live.tags);
      onTagsChange(live.tags);
    }
    const caret = caretOffsetsInTaggedEditor(
      surface,
      surface.ownerDocument.defaultView?.getSelection() ?? null,
    ).end;
    setFollowCaret(caret);
    const nextGhosts = pendingCloseGhosts(
      sourceTags,
      live.tags,
      caret,
      ghostEnds.current,
      length,
    );
    const remembered = new Map<string, number>();
    for (const ghost of nextGhosts) remembered.set(ghost.id, ghost.position);
    ghostEnds.current = remembered;
    ghostsAtRef.current = nextGhosts;
    const painted = paintHtml(live.text, live.tags, nextGhosts);
    if (surface.innerHTML !== painted) {
      surface.innerHTML = painted;
      setCaretInTaggedEditor(surface, caret);
    }
    suggestions?.request(live.text, caret);
    measureCaret();
  };

  const handleKeys = (
    event: KeyboardEvent<HTMLElement>,
    caretFallback: number,
  ) => {
    if (protectTags && !isImeKey(event) && (event.key === "Backspace" || event.key === "Delete")) {
      const caret = currentCaret();
      if (caret.start !== caret.end) {
        event.preventDefault();
        const live = liveDocument();
        const next = deleteRangeKeepingTags(
          live.text,
          live.tags,
          caret.start,
          caret.end,
        );
        commitLive(next.text, next.tags, caret.start);
        return;
      }
      if (event.key === "Backspace" && atomBesideCaret("before")) {
        event.preventDefault();
        return;
      }
      if (event.key === "Delete" && atomBesideCaret("after")) {
        event.preventDefault();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && !isImeKey(event)) {
      const key = event.key.toLowerCase();
      if (!event.altKey && !event.shiftKey && (key === "b" || key === "i" || key === "u")) {
        event.preventDefault();
        applyFormatShortcut(key);
        return;
      }
      if (event.shiftKey && key === "g") {
        event.preventDefault();
        const ghost = ghostsAtRef.current[0];
        if (ghost) placeGhost(ghost);
        return;
      }
    }
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
          if (ghostEl instanceof HTMLElement) {
            event.preventDefault();
            if (disabled === true || composing.current) return;
            const id = ghostEl.dataset.ghost;
            const ghost =
              ghostsAtRef.current.find((item) => item.id === id) ??
              sourceTags.find((item) => item.id === id);
            if (ghost) placeGhost(ghost);
            return;
          }
          if (!groupAdjacent || disabled === true) return;
          const atom = target.closest("[data-tag]");
          if (!(atom instanceof HTMLElement) || !surfaceRef.current) return;
          const tag = decodeInlineTag(atom.dataset.tag ?? null);
          if (!tag) return;
          const group = adjacentPlaceholderGroupAt(effectiveTags, tag.id);
          if (group.length < 2) return;
          event.preventDefault();
          surfaceRef.current.focus();
          selectTagAtoms(
            surfaceRef.current,
            group.map((item) => item.id),
          );
        }}
        onDoubleClick={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement) || !surfaceRef.current) return;
          const atom = target.closest("[data-tag]");
          if (!(atom instanceof HTMLElement)) return;
          const tag = decodeInlineTag(atom.dataset.tag ?? null);
          if (!tag) return;
          const pair = pairSourceTags(effectiveTags).pairs.find(
            (item) => item.start.id === tag.id || item.end.id === tag.id,
          );
          if (!pair) return;
          event.preventDefault();
          selectTagAtoms(surfaceRef.current, [pair.start.id, pair.end.id]);
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
        onCopy={(event) => {
          const clip = clipFromSurface();
          if (clip) writeClip(event, clip);
        }}
        onCut={(event) => {
          const clip = clipFromSurface();
          if (!clip) return;
          writeClip(event, clip);
          const live = liveDocument();
          const caret = currentCaret();
          const next = protectTags
            ? deleteRangeKeepingTags(live.text, live.tags, caret.start, caret.end)
            : deleteRangeFromTagged(live.text, live.tags, caret.start, caret.end);
          commitLive(next.text, next.tags, Math.min(caret.start, caret.end));
        }}
        onPaste={(event) => {
          event.preventDefault();
          const live = liveDocument();
          const caret = currentCaret();
          const pasted = event.clipboardData.getData("text/plain");
          const raw = event.clipboardData.getData(TAGGED_CLIPBOARD_TYPE);
          let clip: TaggedClipboard | null = null;
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as TaggedClipboard;
              if (parsed && typeof parsed.text === "string" && Array.isArray(parsed.tags)) {
                clip = parsed;
              }
            } catch {
              clip = null;
            }
          }
          clip ??= rememberedTaggedClip(pasted);
          if (clip) {
            const next = pasteTaggedSpan(
              live.text,
              live.tags,
              caret.start,
              caret.end,
              clip,
            );
            commitLive(
              next.text,
              next.tags,
              caret.start + [...clip.text].length,
            );
            return;
          }
          const inserted = smartPastePlain(
            live.text,
            caret.start,
            caret.end,
            pasted,
          );
          const next = replaceSelectionInTagged(
            live.text,
            live.tags,
            caret.start,
            caret.end,
            inserted,
          );
          commitLive(next.text, next.tags, caret.start + [...inserted].length);
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
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-pressed={protectTags}
          data-testid={`protect-tags-${segmentId}`}
          title="Protect Tags — tags cannot be deleted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onProtectTagsChange?.(!protectTags)}
        >
          Protect
        </button>
      </div>
      {quickPlaceOpen ? (
        <QuickPlacePopup
          items={placeables}
          activeIndex={quickIndex}
          onHover={setQuickIndex}
          onAccept={applyPlaceable}
          onDismiss={() => onQuickPlaceOpenChange?.(false)}
          groupAdjacent={groupAdjacent}
          {...(onGroupAdjacentChange ? { onGroupAdjacentChange } : {})}
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
          {...(caretBox ? { anchor: caretBox } : {})}
        />
      ) : null}
    </div>
  );
}
