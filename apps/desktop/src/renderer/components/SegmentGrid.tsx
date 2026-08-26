import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";

import { IconDots } from "@tabler/icons-react";

import type { Segment, SegmentState, TmMatchItem } from "@translunar/contracts";
import { MatchBadge } from "@translunar/ui";
import type { MatchGrade } from "@translunar/ui";

import { TokenText } from "./TokenText.js";

/**
 * Studio-style confirm chord family, all mapped onto the same
 * `segment.confirm` call — only the navigation afterwards differs:
 * - `nextUnconfirmed`: Ctrl+Enter, advance to the next unconfirmed row.
 * - `nextAny`: Ctrl+Alt+Enter, advance to the next row regardless of state.
 * - `stay`: Ctrl+Alt+Shift+Enter, no navigation.
 */
export type ConfirmMode = "nextUnconfirmed" | "nextAny" | "stay";

/** Open placeholder QA evidence for one segment (from qa.tag-placeholder_*). */
export interface PlaceholderAlert {
  /** Tokens the target lacks — flagged on the source side. */
  missing: ReadonlySet<string>;
  /** Tokens the target invented — flagged on the target side. */
  extra: ReadonlySet<string>;
}

/** Caret line/column (1-based) inside the mounted target editor. */
export interface EditorCaret {
  line: number;
  column: number;
}

export interface SegmentGridHandle {
  /**
   * Splice text into the mounted target editor at the caret (replacing any
   * selection) without saving, then put the caret after the inserted text
   * and refocus the editor so Ctrl+Enter still confirms. During an IME
   * composition the text is queued and applied on compositionend instead of
   * corrupting the composed input. Returns false when no editor is mounted
   * so callers can fall back.
   */
  insertAtCaret: (text: string) => boolean;
  /**
   * Confirm the segment currently being edited with the live (unsaved)
   * editor text — the same command the editor's Ctrl+Enter chord fires.
   * Returns false when no editor is mounted or an IME composition is in
   * flight, so callers can report honestly instead of guessing.
   */
  confirmActive: (mode?: ConfirmMode) => boolean;
  /**
   * Return keyboard focus to the grid: the mounted target editor if one
   * exists, otherwise the active row. Used when a floating surface (find
   * widget) closes so the keyboard loop continues where it left off.
   * Returns false when there is nothing to focus.
   */
  focusActive: () => boolean;
}

export interface SegmentGridProps {
  segments: Segment[];
  activeSegmentId: string | null;
  /** Best TM match for the active segment (live lookup, never stored). */
  activeMatch?: TmMatchItem | null;
  /** Language pair shown in the column headers (e.g. "en-US"). */
  sourceLocale?: string;
  targetLocale?: string;
  /** Segment ids with open QA issues. */
  qaSegmentIds: ReadonlySet<string>;
  /** Open-issue counts per segment (from qa.list); drives the ⚠n badge. */
  qaCounts?: ReadonlyMap<string, number>;
  /**
   * Open placeholder-QA evidence per segment id; the matching tokens turn
   * the danger outline. Comes straight from qa.list — never re-judged here.
   */
  placeholderAlerts?: ReadonlyMap<string, PlaceholderAlert>;
  onSelect: (segmentId: string) => void;
  /**
   * Persists the segment's draft text (Trados-style: typing keeps the
   * segment a draft with no save button). The grid debounces this while
   * typing and flushes it when the selection leaves the segment or the
   * editor unmounts. A returned promise resolving to `false` means the
   * engine never acked the write; the grid then re-arms so its next flush
   * retries the same text instead of silently dropping it.
   */
  onSaveDraft: (
    segment: Segment,
    targetText: string,
  ) => void | boolean | Promise<void | boolean>;
  onConfirm: (segment: Segment, targetText: string, mode: ConfirmMode) => void;
  /** Row menu 复制源文 — segment.update with the source text. */
  onCopySource?: (segment: Segment) => void;
  /** Row menu 清空译文 — segment.update with an empty string. */
  onClearTarget?: (segment: Segment) => void;
  /**
   * Status-bar caret readout: reports the caret's line/column inside the
   * mounted target editor, and null whenever no editor is mounted. Editor
   * local facts only — never guessed from segment text.
   */
  onCaretChange?: (caret: EditorCaret | null) => void;
  /** Debounce for the typing auto-save; tests may shorten it. */
  autoSaveDelayMs?: number;
  /** Imperative access to the target editor (dock term insertion). */
  ref?: Ref<SegmentGridHandle>;
}

/* One combined status chip per row: glyph first, color second — the state
   is readable without color, and no text badges stack in the column. */
const STATE_CHIP: Record<SegmentState, { glyph: string; label: string }> = {
  untranslated: { glyph: "○", label: "未译" },
  draft: { glyph: "✎", label: "草稿" },
  confirmed: { glyph: "✓", label: "已确认" },
};

/** Persisted-origin chip for one row (`95 TM` / `AI`), straight from the
   stored Segment.origin. Rows without an origin — history from before the
   field existed, or plain human typing — render nothing, never a guess.
   The tooltip lists 状态/来源/分值/模型, each line only when it exists. */
interface OriginChip {
  score?: number | undefined;
  grade?: MatchGrade | undefined;
  label: string;
  /** Edited after the origin write: tone dropped, value kept (§5.4). */
  muted: boolean;
  title: string;
}

function originChipFor(
  segment: Segment,
  stateLabel: string,
): OriginChip | null {
  const origin = segment.origin;
  if (!origin || origin.kind === "human") {
    return null;
  }
  const isTm = origin.kind === "tmExact" || origin.kind === "tmFuzzy";
  // Scores exist only for TM origins; an AI chip never carries a number
  // (no provider returns confidence — NEVER-FAKE).
  const score =
    isTm && typeof origin.score === "number" ? origin.score : undefined;
  const sourceLabel =
    origin.kind === "tmExact"
      ? "TM 精确"
      : origin.kind === "tmFuzzy"
        ? "TM 模糊"
        : "AI";
  const lines = [`状态：${stateLabel}`, `来源：${sourceLabel}`];
  if (score !== undefined) {
    lines.push(`分值：${score}`);
  }
  if (origin.model) {
    lines.push(`模型：${origin.model}`);
  }
  return {
    score,
    grade: isTm ? (origin.kind === "tmFuzzy" ? "fuzzy" : "exact") : undefined,
    label: isTm ? "TM" : "AI",
    muted: origin.edited === true,
    title: lines.join("\n"),
  };
}

/** Rows above this count are windowed instead of fully rendered. */
const VIRTUAL_THRESHOLD = 120;
const ESTIMATED_ROW_HEIGHT = 56;
const OVERSCAN_PX = 400;
const FALLBACK_VIEWPORT = 600;
/** Pause after the last keystroke before the draft is persisted. */
const AUTO_SAVE_DELAY_MS = 700;

/** Resolve the chord variant from a Ctrl/Cmd+Enter keydown, if any. */
function confirmModeForKey(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): ConfirmMode | null {
  if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") {
    return null;
  }
  if (event.altKey) {
    return event.shiftKey ? "stay" : "nextAny";
  }
  if (event.shiftKey) {
    // Ctrl+Shift+Enter is reserved for confirm-without-TM (an engine
    // contract extension); the chord stays vacant until that exists.
    return null;
  }
  return "nextUnconfirmed";
}

/** 1-based line/column of `index` inside `value` (newline-separated). */
function caretPosition(value: string, index: number): EditorCaret {
  const before = value.slice(0, index);
  let line = 1;
  for (const character of before) {
    if (character === "\n") {
      line += 1;
    }
  }
  return { line, column: index - before.lastIndexOf("\n") };
}

export function SegmentGrid({
  segments,
  activeSegmentId,
  activeMatch = null,
  sourceLocale,
  targetLocale,
  qaSegmentIds,
  qaCounts,
  placeholderAlerts,
  onSelect,
  onSaveDraft,
  onConfirm,
  onCopySource,
  onClearTarget,
  onCaretChange,
  autoSaveDelayMs = AUTO_SAVE_DELAY_MS,
  ref,
}: SegmentGridProps) {
  const [draft, setDraft] = useState("");
  // Selection and editing are separate states (Trados grid model): the
  // selected row is the query pivot, editing mounts the target editor.
  // Editing starts on (selection lands in the editor so the type→confirm
  // loop never needs an extra keypress); Esc drops to row-navigation mode
  // where ↑/↓ move the selection and Enter re-enters the editor.
  const [editing, setEditing] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  // Set when Esc leaves the editor, so focus lands on the row (the
  // textarea is gone by the time the effect runs).
  const pendingRowFocusRef = useRef(false);
  // Splicing into the value mid-IME-composition would corrupt the composed
  // input, so inserts requested while composing are queued and flushed on
  // compositionend.
  const composingRef = useRef(false);
  const pendingInsertRef = useRef("");
  const pendingCaretRef = useRef<number | null>(null);
  const heightsRef = useRef(new Map<string, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT);
  // Bumped when a measured row height changes so offsets are recomputed.
  const [, setMeasureVersion] = useState(0);
  // Row whose ⋯ menu is open (right-click or the hover dots).
  const [menuSegmentId, setMenuSegmentId] = useState<string | null>(null);

  const activeSegment =
    segments.find((segment) => segment.id === activeSegmentId) ?? null;

  // --- Trados-style draft lifecycle -------------------------------------
  // Typing never needs a save button: the text is handed to onSaveDraft
  // after a short pause and flushed when the selection leaves the segment.
  // These mirrors let the flush/debounce callbacks (which outlive renders)
  // read the live values without re-subscribing.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onSaveDraftRef = useRef(onSaveDraft);
  onSaveDraftRef.current = onSaveDraft;
  // The last text handed off for persistence (or seeded from the committed
  // target). Anything newer than this is "unsaved typing".
  const savedTextRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped to re-arm the debounce when no draft change occurs (IME commit).
  const [saveTick, setSaveTick] = useState(0);
  // Latest object for the selected segment (fresh revision after saves);
  // set by an effect below AFTER the segment-switch flush has run, so a
  // flush always targets the segment the text belongs to.
  const flushSegmentRef = useRef<Segment | null>(null);

  // Persist the pending draft now (leave-segment flush and timer body).
  const commitDraftSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const segment = flushSegmentRef.current;
    if (!segment) {
      return;
    }
    const text = draftRef.current;
    if (text === savedTextRef.current) {
      return;
    }
    savedTextRef.current = text;
    const outcome = onSaveDraftRef.current(segment, text);
    if (
      outcome &&
      typeof (outcome as Promise<void | boolean>).then === "function"
    ) {
      void (outcome as Promise<void | boolean>).then((acked) => {
        // The engine never acked this write: forget the hand-off (unless
        // newer text was handed off meanwhile) so the next flush retries
        // the same text instead of silently dropping it.
        if (acked === false && savedTextRef.current === text) {
          savedTextRef.current = segment.targetText;
        }
      });
    }
  }, []);

  // Confirm persists the exact editor text itself; drop any pending
  // auto-save so the same write is never sent twice.
  const handOffToConfirm = useCallback((text: string) => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    savedTextRef.current = text;
  }, []);

  // Selection moved to another segment: leaving never confirms (Studio
  // semantics), but unsaved typing is flushed as a draft first. Then the
  // editor re-seeds from the newly selected segment; any in-flight
  // composition or queued insert belonged to the old text.
  useEffect(() => {
    commitDraftSave();
    const seeded = activeSegment?.targetText ?? "";
    setDraft(seeded);
    savedTextRef.current = seeded;
    composingRef.current = false;
    pendingInsertRef.current = "";
    pendingCaretRef.current = null;
  }, [activeSegment?.id]);

  // An outside write landed in the committed target of the segment being
  // edited (TM apply, AI draft, replace, row menu): re-seed the editor.
  // Our own auto-save echo is recognized by matching the handed-off text
  // and never clobbers typing that happened while the save was in flight.
  useEffect(() => {
    if (!activeSegment) {
      return;
    }
    const target = activeSegment.targetText;
    if (target === draftRef.current || target === savedTextRef.current) {
      return;
    }
    setDraft(target);
    savedTextRef.current = target;
    composingRef.current = false;
    pendingInsertRef.current = "";
    pendingCaretRef.current = null;
  }, [activeSegment?.targetText]);

  // Runs after the two effects above, so the segment-switch flush still
  // saw the previous segment while this keeps revisions fresh in between.
  useEffect(() => {
    flushSegmentRef.current = activeSegment;
  });

  // Debounced auto-save: re-armed on every keystroke, quiet during IME
  // composition (compositionend bumps saveTick to re-arm).
  useEffect(() => {
    if (!activeSegment || composingRef.current) {
      return;
    }
    if (draft === savedTextRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      if (saveTimerRef.current === timer) {
        saveTimerRef.current = null;
      }
      if (!composingRef.current) {
        commitDraftSave();
      }
    }, autoSaveDelayMs);
    saveTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (saveTimerRef.current === timer) {
        saveTimerRef.current = null;
      }
    };
  }, [draft, saveTick, activeSegment?.id, autoSaveDelayMs, commitDraftSave]);

  // The editor can unmount with pending text (filter hides the row, the
  // document or project closes): flush it, exactly like leaving a segment.
  useEffect(() => {
    return () => commitDraftSave();
  }, [commitDraftSave]);

  const spliceIntoEditor = useCallback(
    (textarea: HTMLTextAreaElement, text: string) => {
      const value = textarea.value;
      const start = textarea.selectionStart ?? value.length;
      const end = textarea.selectionEnd ?? start;
      pendingCaretRef.current = start + text.length;
      setDraft(value.slice(0, start) + text + value.slice(end));
    },
    [],
  );

  // After an insert re-renders the controlled textarea, place the caret
  // right after the inserted text and return focus to the editor so the
  // Ctrl+Enter confirm shortcut keeps working.
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    const textarea = textareaRef.current;
    if (caret === null || !textarea) {
      return;
    }
    pendingCaretRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  }, [draft]);

  /** Reads the caret straight off the mounted textarea (never guessed). */
  const reportCaret = useCallback(() => {
    if (!onCaretChange) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    onCaretChange(
      caretPosition(
        textarea.value,
        textarea.selectionStart ?? textarea.value.length,
      ),
    );
  }, [onCaretChange]);

  // Status-bar caret readout: report when an editor mounts (or the active
  // row changes), clear the moment there is no editor — including unmount.
  useEffect(() => {
    if (!onCaretChange) {
      return;
    }
    if (!editing || !activeSegment) {
      onCaretChange(null);
      return;
    }
    reportCaret();
  }, [onCaretChange, editing, activeSegment, reportCaret]);
  useEffect(() => {
    return () => onCaretChange?.(null);
  }, [onCaretChange]);

  useImperativeHandle(
    ref,
    () => ({
      insertAtCaret: (text: string) => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return false;
        }
        if (composingRef.current) {
          pendingInsertRef.current += text;
          return true;
        }
        spliceIntoEditor(textarea, text);
        return true;
      },
      confirmActive: (mode: ConfirmMode = "nextUnconfirmed") => {
        if (!textareaRef.current || !activeSegment || composingRef.current) {
          return false;
        }
        handOffToConfirm(draft);
        onConfirm(activeSegment, draft, mode);
        return true;
      },
      focusActive: () => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          return true;
        }
        if (activeSegmentId) {
          const row = rowRefs.current.get(activeSegmentId);
          if (row) {
            row.focus();
            return true;
          }
        }
        return false;
      },
    }),
    [
      spliceIntoEditor,
      activeSegment,
      activeSegmentId,
      draft,
      onConfirm,
      handOffToConfirm,
    ],
  );

  // --- Roving focus ------------------------------------------------------
  // Only the active row is tabbable; Esc drops focus onto it, ↑/↓ move the
  // selection and follow with focus, Enter mounts the editor again.
  useLayoutEffect(() => {
    if (editing || !activeSegmentId) {
      return;
    }
    const shouldFocus =
      pendingRowFocusRef.current ||
      (containerRef.current?.contains(document.activeElement) ?? false);
    pendingRowFocusRef.current = false;
    if (shouldFocus) {
      rowRefs.current.get(activeSegmentId)?.focus();
    }
  }, [editing, activeSegmentId]);

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      if (!activeSegmentId) {
        return;
      }
      const index = segments.findIndex(
        (segment) => segment.id === activeSegmentId,
      );
      if (index < 0) {
        return;
      }
      const next =
        segments[Math.min(segments.length - 1, Math.max(0, index + delta))];
      if (next && next.id !== activeSegmentId) {
        onSelect(next.id);
      }
    },
    [segments, activeSegmentId, onSelect],
  );

  const handleRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTableRowElement>, segment: Segment) => {
      // Keys typed inside the editor belong to the editor.
      if (event.target !== event.currentTarget) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        setEditing(true);
        return;
      }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        setMenuSegmentId(segment.id);
      }
    },
    [moveSelection],
  );

  // The row menu closes on outside pointer or Escape, like a native menu.
  useEffect(() => {
    if (!menuSegmentId) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !target.closest(".segment-grid__menu-wrap")
      ) {
        setMenuSegmentId(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Mark the event consumed so workbench-level Escape fallbacks
        // (clear the display filter) don't also fire on the same press.
        event.preventDefault();
        setMenuSegmentId(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuSegmentId]);

  const virtualized = segments.length > VIRTUAL_THRESHOLD;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const measure = () => {
      setViewportHeight(container.clientHeight || FALLBACK_VIEWPORT);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const rowHeight = useCallback((segmentId: string): number => {
    return heightsRef.current.get(segmentId) ?? ESTIMATED_ROW_HEIGHT;
  }, []);

  const measureRow = useCallback(
    (segmentId: string, element: HTMLTableRowElement | null) => {
      if (!element) {
        rowRefs.current.delete(segmentId);
        return;
      }
      rowRefs.current.set(segmentId, element);
      const height = element.offsetHeight;
      if (height > 0 && heightsRef.current.get(segmentId) !== height) {
        heightsRef.current.set(segmentId, height);
        setMeasureVersion((version) => version + 1);
      }
    },
    [],
  );

  const rowWindow = useMemo(() => {
    if (!virtualized) {
      return {
        start: 0,
        end: segments.length - 1,
        topPad: 0,
        bottomPad: 0,
      };
    }
    const windowTop = scrollTop - OVERSCAN_PX;
    const windowBottom = scrollTop + viewportHeight + OVERSCAN_PX;
    let offset = 0;
    let start = 0;
    let end = segments.length - 1;
    let topPad = 0;
    let started = false;
    let usedHeight = 0;
    for (let index = 0; index < segments.length; index += 1) {
      const height = rowHeight(segments[index]!.id);
      if (!started && offset + height > windowTop) {
        start = index;
        topPad = offset;
        started = true;
      }
      if (started) {
        usedHeight += height;
      }
      offset += height;
      if (started && offset >= windowBottom) {
        end = index;
        break;
      }
    }
    if (!started) {
      // Scrolled past the end (e.g. after filtering); clamp to the tail.
      start = Math.max(0, segments.length - 1);
      end = segments.length - 1;
      topPad = offset - rowHeight(segments[start]?.id ?? "");
      usedHeight = offset - topPad;
    }
    let total = offset;
    for (let index = end + 1; index < segments.length; index += 1) {
      total += rowHeight(segments[index]!.id);
    }
    // `offset` already includes rows up to `end`; the remainder is padding.
    const bottomPad = Math.max(0, total - topPad - usedHeight);
    return { start, end, topPad, bottomPad };
    // Heights live in a ref; the measureVersion state bump forces a
    // recompute whenever a rendered row reports a new height.
  }, [virtualized, segments, scrollTop, viewportHeight, rowHeight]);

  // Bring the active row into the scroll window when selection jumps
  // (QA "定位句段", concordance hits, filters).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeSegmentId) {
      return;
    }
    const index = segments.findIndex(
      (segment) => segment.id === activeSegmentId,
    );
    if (index < 0) {
      return;
    }
    if (virtualized) {
      let offset = 0;
      for (let i = 0; i < index; i += 1) {
        offset += rowHeight(segments[i]!.id);
      }
      const height = rowHeight(segments[index]!.id);
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + (container.clientHeight || viewportHeight);
      if (
        (offset < viewTop || offset + height > viewBottom) &&
        typeof container.scrollTo === "function"
      ) {
        container.scrollTo({ top: Math.max(0, offset - viewportHeight / 3) });
        setScrollTop(Math.max(0, offset - viewportHeight / 3));
      }
    } else {
      const row = container.querySelector(
        `tr[data-segment-id="${activeSegmentId}"]`,
      );
      if (row && typeof row.scrollIntoView === "function") {
        row.scrollIntoView({ block: "nearest" });
      }
    }
    // Only reposition when the selection itself changes, not on every
    // data refresh, so background updates never yank the scroll position.
  }, [activeSegmentId]);

  const visible = segments.slice(rowWindow.start, rowWindow.end + 1);

  return (
    <div
      className="segment-grid"
      ref={containerRef}
      onScroll={
        virtualized
          ? (event) => setScrollTop(event.currentTarget.scrollTop)
          : undefined
      }
    >
      <table>
        <thead>
          <tr>
            <th className="segment-grid__ordinal">#</th>
            <th className="segment-grid__source">
              源文
              {sourceLocale ? (
                <span className="segment-grid__locale">{sourceLocale}</span>
              ) : null}
            </th>
            <th className="segment-grid__target">
              译文
              {targetLocale ? (
                <span className="segment-grid__locale">{targetLocale}</span>
              ) : null}
            </th>
            <th className="segment-grid__state">状态</th>
          </tr>
        </thead>
        <tbody>
          {rowWindow.topPad > 0 ? (
            <tr className="segment-grid__spacer" aria-hidden="true">
              <td colSpan={4} style={{ height: rowWindow.topPad }} />
            </tr>
          ) : null}
          {visible.map((segment) => {
            const isActive = segment.id === activeSegmentId;
            const isEditing = isActive && editing;
            const { glyph, label } = STATE_CHIP[segment.state];
            const hasQa = qaSegmentIds.has(segment.id);
            const qaCount = qaCounts?.get(segment.id) ?? 0;
            const alert = placeholderAlerts?.get(segment.id);
            const statusLabel = hasQa
              ? `${label}，${qaCount > 0 ? `${qaCount} 个` : "存在"}未解决 QA 问题`
              : label;
            const originChip = originChipFor(segment, label);
            return (
              <tr
                key={segment.id}
                data-active={isActive}
                data-editing={isEditing || undefined}
                data-state={segment.state}
                data-qa={qaSegmentIds.has(segment.id) || undefined}
                data-segment-id={segment.id}
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-label={`句段 ${segment.ordinal + 1}`}
                ref={(element) => measureRow(segment.id, element)}
                onClick={() => {
                  onSelect(segment.id);
                  setEditing(true);
                }}
                onKeyDown={(event) => handleRowKeyDown(event, segment)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelect(segment.id);
                  setMenuSegmentId(segment.id);
                }}
              >
                <td className="segment-grid__ordinal">{segment.ordinal + 1}</td>
                <td className="segment-grid__source">
                  <TokenText
                    text={segment.sourceText}
                    dangerTokens={alert?.missing}
                  />
                </td>
                <td className="segment-grid__target">
                  {isEditing ? (
                    <div className="segment-grid__target-editor">
                      <textarea
                        aria-label={`句段 ${segment.ordinal + 1} 译文`}
                        ref={textareaRef}
                        value={draft}
                        autoFocus
                        onChange={(event) => {
                          setDraft(event.target.value);
                          reportCaret();
                        }}
                        // Fires on every caret move (keyboard or mouse), so
                        // the status-bar readout tracks the real position.
                        onSelect={reportCaret}
                        onCompositionStart={() => {
                          composingRef.current = true;
                        }}
                        onCompositionEnd={(event) => {
                          composingRef.current = false;
                          const pending = pendingInsertRef.current;
                          if (pending.length > 0) {
                            pendingInsertRef.current = "";
                            spliceIntoEditor(event.currentTarget, pending);
                          }
                          // Text committed by the IME must reach the
                          // debounced draft save even when no further
                          // input follows.
                          setSaveTick((tick) => tick + 1);
                        }}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) {
                            // Mid-composition keys belong to the IME:
                            // Enter commits the composed text, Esc cancels
                            // the composition — never the segment.
                            return;
                          }
                          const mode = confirmModeForKey(event);
                          if (mode) {
                            event.preventDefault();
                            handOffToConfirm(draft);
                            onConfirm(segment, draft, mode);
                            return;
                          }
                          if (event.key === "Escape") {
                            // Exit editing without confirming and without
                            // losing typing: the draft flushes as a draft
                            // and focus drops to the row for ↑/↓ travel.
                            event.preventDefault();
                            commitDraftSave();
                            pendingRowFocusRef.current = true;
                            setEditing(false);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <TokenText
                      text={segment.targetText}
                      dangerTokens={alert?.extra}
                    />
                  )}
                </td>
                <td className="segment-grid__state">
                  <span className="segment-grid__status">
                    <span
                      className="segment-grid__chip"
                      data-state={segment.state}
                      role="img"
                      aria-label={statusLabel}
                      title={statusLabel}
                    >
                      <span aria-hidden="true">{glyph}</span>
                      {hasQa ? (
                        <span
                          className="segment-grid__chip-qa"
                          aria-hidden="true"
                        >
                          ⚠{qaCount > 0 ? qaCount : ""}
                        </span>
                      ) : null}
                    </span>
                    {originChip ? (
                      // Persisted origin wins over the live lookup: the
                      // stored score is what actually produced this target.
                      <MatchBadge
                        score={originChip.score}
                        grade={originChip.grade}
                        label={originChip.label}
                        muted={originChip.muted}
                        title={originChip.title}
                      />
                    ) : isActive && activeMatch ? (
                      <MatchBadge
                        score={activeMatch.score}
                        grade={activeMatch.grade}
                        title={`TM 最佳匹配 ${activeMatch.score}%`}
                      />
                    ) : null}
                    {onCopySource || onClearTarget ? (
                      <span className="segment-grid__menu-wrap">
                        <button
                          type="button"
                          className="segment-grid__menu-button"
                          aria-label={`句段 ${segment.ordinal + 1} 菜单`}
                          aria-haspopup="menu"
                          aria-expanded={menuSegmentId === segment.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuSegmentId((current) =>
                              current === segment.id ? null : segment.id,
                            );
                          }}
                        >
                          <IconDots size={14} stroke={1.75} aria-hidden />
                        </button>
                        {menuSegmentId === segment.id ? (
                          <span className="segment-grid__menu" role="menu">
                            {onCopySource ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="segment-grid__menu-item"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setMenuSegmentId(null);
                                  onCopySource(segment);
                                }}
                              >
                                复制源文
                              </button>
                            ) : null}
                            {onClearTarget ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="segment-grid__menu-item"
                                disabled={segment.targetText.length === 0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setMenuSegmentId(null);
                                  onClearTarget(segment);
                                }}
                              >
                                清空译文
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
          {rowWindow.bottomPad > 0 ? (
            <tr className="segment-grid__spacer" aria-hidden="true">
              <td colSpan={4} style={{ height: rowWindow.bottomPad }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
