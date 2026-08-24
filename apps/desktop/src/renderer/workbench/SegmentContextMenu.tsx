import { useEffect, useRef } from "react";

import { useMenuKeyboard } from "../shell/use-menu-keyboard";
import type { ContextMenuEntry } from "./segment-context-menu";

export interface SegmentContextMenuProps {
  x: number;
  y: number;
  items: readonly ContextMenuEntry[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

/**
 * Pointer context menu for a segment row.
 *
 * Keyboard model is the shared APG menu (Escape, arrows, type-ahead). There
 * is no visible trigger button: the menu opens from a right-click, so on
 * dismiss focus goes back to wherever the translator was standing — usually
 * the target editor — rather than to a synthetic element or to nothing.
 */
export function SegmentContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: SegmentContextMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Captured during the first render, before the menu takes focus.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (restoreFocusRef.current === null) {
    const previous = document.activeElement;
    if (previous instanceof HTMLElement && previous !== document.body) {
      restoreFocusRef.current = previous;
    }
  }
  const open = true;
  const menu = useMenuKeyboard({
    open,
    setOpen: (next) => {
      if (!next) onClose();
    },
    triggerRef,
    menuRef,
  });

  useEffect(() => {
    const menuEl = menuRef.current;
    return () => {
      // Escape or running an item leaves focus on a menu item that is about
      // to be removed; hand it back. An outside click already focused
      // something else on purpose — leave that alone.
      const active = document.activeElement;
      const focusLost =
        active === null ||
        active === document.body ||
        (menuEl?.contains(active) ?? false);
      const target = restoreFocusRef.current;
      if (focusLost && target && document.contains(target)) {
        target.focus();
      }
    };
  }, []);

  useEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    node.style.left = `${Math.max(8, left)}px`;
    node.style.top = `${Math.max(8, top)}px`;
  }, [x, y, items]);

  return (
    <div
      ref={menuRef}
      className="menu segment-context-menu"
      role="menu"
      aria-label="Segment actions"
      data-testid="segment-context-menu"
      data-geometry="menu opens at the pointer"
      style={{ left: x, top: y }}
      onKeyDown={menu.onMenuKeyDown}
    >
      {items.map((item) =>
        "separator" in item ? (
          <div key={item.id} className="menu__separator" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={
              item.danger ? "menu__item menu__item--danger" : "menu__item"
            }
            disabled={item.disabled}
            aria-disabled={item.disabled ? true : undefined}
            data-testid={`segment-context-${item.id}`}
            onClick={() => {
              if (item.disabled) return;
              menu.close(false);
              onSelect(item.id);
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? (
              <span className="menu__shortcut">{item.shortcut}</span>
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}
