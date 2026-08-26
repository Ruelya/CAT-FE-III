import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Kbd } from "@translunar/ui";

/**
 * One executable row in the command palette. Entries are built by the
 * workbench from the MenuCommand catalog (dispatched through the same
 * handleMenuCommand path as the application menu), the dock switches, and
 * document jumps — the palette itself never owns behavior.
 */
export interface PaletteEntry {
  id: string;
  label: string;
  /** Display-only shortcut, e.g. "Ctrl+Enter"; ownership stays put. */
  shortcut?: string | undefined;
  /** Mirrors menu enablement; disabled rows render but never execute. */
  enabled: boolean;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  entries: PaletteEntry[];
  onClose: () => void;
}

function highlight(label: string, query: string): ReactNode {
  if (query.length === 0) {
    return label;
  }
  const index = label.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return label;
  }
  return (
    <>
      {label.slice(0, index)}
      <mark>{label.slice(index, index + query.length)}</mark>
      {label.slice(index + query.length)}
    </>
  );
}

export function CommandPalette({ open, entries, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return entries;
    }
    return entries.filter((entry) =>
      entry.label.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  // Fresh session per summon: the query resets and the top row is armed.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Keep the armed row inside the scroll window during keyboard travel.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, matches]);

  if (!open) {
    return null;
  }

  const execute = (entry: PaletteEntry | undefined) => {
    if (!entry || !entry.enabled) {
      return;
    }
    onClose();
    entry.run();
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <input
          className="palette__input"
          aria-label="搜索命令"
          placeholder="输入命令名称"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((current) =>
                Math.min(matches.length - 1, current + 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              execute(matches[selected]);
            }
          }}
        />
        <div className="palette__list" role="listbox" ref={listRef}>
          {matches.length === 0 ? (
            <p className="palette__empty">没有匹配的命令</p>
          ) : (
            matches.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="option"
                className="palette__item"
                data-selected={index === selected}
                aria-selected={index === selected}
                aria-disabled={!entry.enabled || undefined}
                onMouseEnter={() => setSelected(index)}
                onClick={() => execute(entry)}
              >
                <span className="palette__label">
                  {highlight(entry.label, query.trim())}
                </span>
                {entry.shortcut ? <Kbd>{entry.shortcut}</Kbd> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
