import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Ref } from "react";

import type { Segment, SegmentState, TmMatchItem } from "@translunar/contracts";
import { Badge, Kbd, MatchBadge } from "@translunar/ui";
import type { BadgeTone } from "@translunar/ui";

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
  confirmActive: () => boolean;
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
  onConfirm: (segment: Segment, targetText: string) => void;
  /** Debounce for the typing auto-save; tests may shorten it. */
  autoSaveDelayMs?: number;
  /** Imperative access to the target editor (dock term insertion). */
  ref?: Ref<SegmentGridHandle>;
}

const STATE_LABEL: Record<SegmentState, [string, BadgeTone]> = {
  untranslated: ["未译", "neutral"],
  draft: ["草稿", "accent"],
  confirmed: ["已确认", "ok"],
};

/** Rows above this count are windowed instead of fully rendered. */
const VIRTUAL_THRESHOLD = 120;
const ESTIMATED_ROW_HEIGHT = 56;
const OVERSCAN_PX = 400;
const FALLBACK_VIEWPORT = 600;
/** Pause after the last keystroke before the draft is persisted. */
const AUTO_SAVE_DELAY_MS = 700;

export function SegmentGrid({
  segments,
  activeSegmentId,
  activeMatch = null,
  sourceLocale,
  targetLocale,
  qaSegmentIds,
  onSelect,
  onSaveDraft,
  onConfirm,
  autoSaveDelayMs = AUTO_SAVE_DELAY_MS,
  ref,
}: SegmentGridProps) {
  const [draft, setDraft] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
  // edited (TM apply, AI draft, replace): re-seed the editor. Our own
  // auto-save echo is recognized by matching the handed-off text and never
  // clobbers typing that happened while the save was in flight.
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
      confirmActive: () => {
        if (!textareaRef.current || !activeSegment || composingRef.current) {
          return false;
        }
        handOffToConfirm(draft);
        onConfirm(activeSegment, draft);
        return true;
      },
    }),
    [spliceIntoEditor, activeSegment, draft, onConfirm, handOffToConfirm],
  );

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
        return;
      }
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
            const [label, tone] = STATE_LABEL[segment.state];
            return (
              <tr
                key={segment.id}
                data-active={isActive}
                data-state={segment.state}
                data-qa={qaSegmentIds.has(segment.id) || undefined}
                data-segment-id={segment.id}
                ref={(element) => measureRow(segment.id, element)}
                onClick={() => onSelect(segment.id)}
              >
                <td className="segment-grid__ordinal">{segment.ordinal + 1}</td>
                <td className="segment-grid__source">{segment.sourceText}</td>
                <td className="segment-grid__target">
                  {isActive ? (
                    <div className="segment-grid__target-editor">
                      <textarea
                        aria-label={`句段 ${segment.ordinal + 1} 译文`}
                        ref={textareaRef}
                        value={draft}
                        autoFocus
                        onChange={(event) => setDraft(event.target.value)}
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
                            // Enter mid-composition commits the IME text,
                            // never the segment.
                            return;
                          }
                          if (
                            (event.ctrlKey || event.metaKey) &&
                            event.key === "Enter"
                          ) {
                            event.preventDefault();
                            handOffToConfirm(draft);
                            onConfirm(segment, draft);
                          }
                        }}
                      />
                      <span className="segment-grid__hint">
                        <Kbd>Ctrl+Enter</Kbd> 确认并写入 TM
                        <span className="segment-grid__hint-sep">·</span>
                        <Kbd>Alt+↑/↓</Kbd> 切换句段
                        <span className="segment-grid__hint-sep">·</span>
                        输入自动保存草稿
                      </span>
                    </div>
                  ) : segment.targetText ? (
                    segment.targetText
                  ) : (
                    <span className="segment-grid__placeholder">—</span>
                  )}
                </td>
                <td className="segment-grid__state">
                  <span className="segment-grid__state-stack">
                    <Badge tone={tone}>{label}</Badge>
                    {qaSegmentIds.has(segment.id) ? (
                      <Badge tone="danger" title="存在未解决的 QA 问题">
                        QA
                      </Badge>
                    ) : null}
                    {isActive && activeMatch ? (
                      <span className="segment-grid__match">
                        <MatchBadge
                          score={activeMatch.score}
                          grade={activeMatch.grade}
                          title={`TM 最佳匹配 ${activeMatch.score}%`}
                        />
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
