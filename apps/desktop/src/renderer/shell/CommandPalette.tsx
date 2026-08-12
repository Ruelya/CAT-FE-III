import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";

import {
  filterCommands,
  groupCommands,
  nextIndex,
  type PaletteCommand,
} from "./command-palette-model";

export interface CommandPaletteProps {
  commands: readonly PaletteCommand[];
  onClose: () => void;
}

/**
 * Ctrl/Cmd+K command palette.
 *
 * A combobox over the commands the app controller already exposes: it never
 * calls the Engine itself and never becomes a second route authority. Focus is
 * trapped, Escape closes and restores the opener, and the active option is
 * published through aria-activedescendant so the input keeps DOM focus while
 * the arrow keys move the selection.
 */
export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const matches = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );
  const sections = useMemo(() => groupCommands(matches), [matches]);
  // Sections preserve the group order, so the flat list must follow them.
  const ordered = useMemo(
    () => sections.flatMap((section) => section.commands),
    [sections],
  );
  const active = ordered[Math.min(activeIndex, ordered.length - 1)] ?? null;

  useEffect(() => {
    const previous = document.activeElement;
    restoreFocusRef.current = previous instanceof HTMLElement ? previous : null;
    inputRef.current?.focus();
    return () => {
      const trigger = restoreFocusRef.current;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!active) return;
    const option = listRef.current?.querySelector(
      `[data-command-id="${CSS.escape(active.id)}"]`,
    );
    // jsdom has no scrollIntoView; keep the keyboard model testable.
    if (option && typeof option.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  const run = (command: PaletteCommand) => {
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => nextIndex(index, ordered.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => nextIndex(index, ordered.length, -1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, ordered.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (active) run(active);
      return;
    }
    if (event.key === "Tab") {
      // A palette is a single control; keep focus inside it.
      event.preventDefault();
    }
  };

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
      >
        <div className="command-palette__search">
          <MagnifyingGlass size={18} weight="regular" aria-hidden="true" />
          <input
            ref={inputRef}
            className="command-palette__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-label="Search commands"
            {...(active
              ? { "aria-activedescendant": optionId(active.id) }
              : {})}
            placeholder="Search commands"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            data-testid="command-palette-input"
          />
        </div>

        {ordered.length === 0 ? (
          <p className="command-palette__empty" role="status">
            No command matches {`"${query.trim()}"`}
          </p>
        ) : (
          <ul
            ref={listRef}
            id={listboxId}
            className="command-palette__list"
            role="listbox"
            aria-label="Commands"
          >
            {sections.map((section) => (
              <li key={section.group} role="presentation">
                <div
                  className="command-palette__group-label"
                  role="presentation"
                >
                  {section.group}
                </div>
                <ul role="group" aria-label={section.group}>
                  {section.commands.map((command) => (
                    <li key={command.id} role="presentation">
                      <button
                        type="button"
                        id={optionId(command.id)}
                        role="option"
                        aria-selected={command.id === active?.id}
                        data-active={command.id === active?.id}
                        data-command-id={command.id}
                        className="command-palette__item"
                        tabIndex={-1}
                        onMouseMove={() =>
                          setActiveIndex(
                            ordered.findIndex((c) => c.id === command.id),
                          )
                        }
                        onClick={() => run(command)}
                      >
                        <span className="command-palette__item-label">
                          {command.label}
                        </span>
                        {command.hint ? (
                          <span className="command-palette__item-hint">
                            {command.hint}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="command-palette__footer">
          <span>
            <span className="kbd">Up</span> <span className="kbd">Down</span> to
            move
          </span>
          <span>
            <span className="kbd">Enter</span> to run
          </span>
          <span>
            <span className="kbd">Esc</span> to close
          </span>
        </div>
      </div>
    </div>
  );
}

function optionId(commandId: string): string {
  return `command-option-${commandId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
