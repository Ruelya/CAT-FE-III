import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconX,
} from "@tabler/icons-react";

/**
 * Floating find/replace widget (VS Code form), summoned by Ctrl+F (find)
 * or Ctrl+H (replace) and dismissed with Esc. It never hides grid rows —
 * find jumps the selection (F4/Shift+F4 keep working while it is closed);
 * replace goes through the exact same segment.update / segment.replace
 * paths the old toolbar group used. Display filtering is a separate
 * channel (the filter chips on the grid toolbar).
 */
export interface FindWidgetProps {
  open: boolean;
  /** "replace" reveals the second row; "find" keeps it collapsed. */
  mode: "find" | "replace";
  query: string;
  replaceWith: string;
  includeConfirmed: boolean;
  /** Visible segments matching the query (honest count, no occurrences). */
  matchCount: number;
  busy: boolean;
  /**
   * Bumped by the owner on every summon chord, so Ctrl+F/Ctrl+H re-focus
   * and re-select the right input even when the widget is already open.
   */
  summon?: number;
  onQueryChange: (value: string) => void;
  onReplaceWithChange: (value: string) => void;
  onIncludeConfirmedChange: (value: boolean) => void;
  onModeChange: (mode: "find" | "replace") => void;
  onFindNext: () => void;
  onFindPrev: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

const ICON = { size: 14, stroke: 1.75, "aria-hidden": true } as const;

export function FindWidget({
  open,
  mode,
  query,
  replaceWith,
  includeConfirmed,
  matchCount,
  busy,
  summon = 0,
  onQueryChange,
  onReplaceWithChange,
  onIncludeConfirmedChange,
  onModeChange,
  onFindNext,
  onFindPrev,
  onReplace,
  onReplaceAll,
  onClose,
}: FindWidgetProps) {
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  // Focus follows the summon chord: Ctrl+F lands in the find box, Ctrl+H
  // in the replace box. Re-summoning while open re-selects, so the chord
  // always means "start typing here".
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const input =
      mode === "replace" ? replaceInputRef.current : findInputRef.current;
    input?.focus();
    input?.select();
  }, [open, mode, summon]);

  if (!open) {
    return null;
  }

  const hasQuery = query.trim().length > 0;

  const onWidgetKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="find-widget-anchor">
      <div
        className="find-widget"
        role="dialog"
        aria-label={mode === "replace" ? "查找替换" : "查找"}
        onKeyDown={onWidgetKeyDown}
      >
      <button
        type="button"
        className="find-widget__toggle"
        aria-label={mode === "replace" ? "收起替换" : "展开替换"}
        aria-expanded={mode === "replace"}
        title={mode === "replace" ? "收起替换" : "展开替换（Ctrl+H）"}
        onClick={() => onModeChange(mode === "replace" ? "find" : "replace")}
      >
        {mode === "replace" ? (
          <IconChevronDown {...ICON} />
        ) : (
          <IconChevronRight {...ICON} />
        )}
      </button>
      <div className="find-widget__rows">
        <div className="find-widget__row">
          <input
            ref={findInputRef}
            className="find-widget__input"
            aria-label="查找"
            placeholder="查找"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                // Enter mid-IME commits the composed text, not a jump.
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) {
                  onFindPrev();
                } else {
                  onFindNext();
                }
              }
            }}
          />
          <span className="find-widget__count tl-num" aria-label="匹配句段数">
            {hasQuery ? `${matchCount} 段` : ""}
          </span>
          <button
            type="button"
            className="find-widget__button"
            aria-label="查找上一个"
            title="查找上一个（Shift+F4）"
            disabled={!hasQuery}
            onClick={onFindPrev}
          >
            <IconChevronUp {...ICON} />
          </button>
          <button
            type="button"
            className="find-widget__button"
            aria-label="查找下一个"
            title="查找下一个（F4）"
            disabled={!hasQuery}
            onClick={onFindNext}
          >
            <IconChevronDown {...ICON} />
          </button>
          <button
            type="button"
            className="find-widget__button"
            aria-label="关闭查找"
            title="关闭（Esc）"
            onClick={onClose}
          >
            <IconX {...ICON} />
          </button>
        </div>
        {mode === "replace" ? (
          <div className="find-widget__row">
            <input
              ref={replaceInputRef}
              className="find-widget__input"
              aria-label="替换为"
              placeholder="替换为"
              value={replaceWith}
              onChange={(event) => onReplaceWithChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) {
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  onReplace();
                }
              }}
            />
            <button
              type="button"
              className="find-widget__action"
              disabled={!hasQuery || busy}
              onClick={onReplace}
            >
              替换
            </button>
            <button
              type="button"
              className="find-widget__action"
              disabled={!hasQuery || busy}
              onClick={onReplaceAll}
            >
              全部替换
            </button>
            <label className="find-widget__checkbox">
              <input
                type="checkbox"
                checked={includeConfirmed}
                onChange={(event) =>
                  onIncludeConfirmedChange(event.target.checked)
                }
              />
              含已确认
            </label>
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}
