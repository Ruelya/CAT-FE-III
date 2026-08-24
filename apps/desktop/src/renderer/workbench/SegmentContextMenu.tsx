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
 * Keyboard model is the shared APG menu (Escape, arrows, type-ahead). The
 * invisible trigger exists so that model can restore focus after dismiss.
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
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    node.style.left = `${Math.max(8, left)}px`;
    node.style.top = `${Math.max(8, top)}px`;
  }, [x, y, items]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
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
            <div
              key={item.id}
              className="menu__separator"
              role="separator"
            />
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
    </>
  );
}
