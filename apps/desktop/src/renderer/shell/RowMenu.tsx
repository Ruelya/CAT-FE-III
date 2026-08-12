import { useEffect, useId, useRef, useState } from "react";
import { DotsThree } from "@phosphor-icons/react";

export interface RowMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}

export interface RowMenuProps {
  /**
   * Accessible name for the trigger. Must identify the row, for example
   * "More actions for Aurora Field Guide", so repeated rows are
   * distinguishable to a screen reader.
   */
  label: string;
  items: RowMenuItem[];
  disabled?: boolean;
  testId?: string;
}

const FOCUSABLE_ITEM = '[role="menuitem"]:not([aria-disabled="true"])';

/**
 * Overflow menu for secondary and destructive row actions.
 *
 * Implements the full APG menu button pattern rather than a click-only popup:
 * opening moves focus to the first enabled item, ArrowUp opens onto the last,
 * Arrow/Home/End navigate, typing jumps to the next item with that initial,
 * and Escape, outside click, or selection closes and returns focus to the
 * trigger. Anything less is a semantic promise the widget does not keep.
 */
export function RowMenu({ label, items, disabled, testId }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"first" | "last">("first");

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const options = menu.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM);
    if (options.length === 0) return;
    const target =
      pendingFocus.current === "last"
        ? options[options.length - 1]!
        : options[0]!;
    target.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      pendingFocus.current = "first";
      setOpen(true);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      pendingFocus.current = "last";
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const menu = menuRef.current;
    if (!menu) return;
    const options = Array.from(
      menu.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM),
    );
    if (options.length === 0) return;
    const index = options.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        // A menu is a single stop; leaving it closes it.
        close(false);
        return;
      case "ArrowDown":
        event.preventDefault();
        options[(index + 1 + options.length) % options.length]!.focus();
        return;
      case "ArrowUp":
        event.preventDefault();
        options[(index - 1 + options.length) % options.length]!.focus();
        return;
      case "Home":
        event.preventDefault();
        options[0]!.focus();
        return;
      case "End":
        event.preventDefault();
        options[options.length - 1]!.focus();
        return;
      default:
        break;
    }

    if (event.key.length === 1 && /\S/.test(event.key)) {
      const initial = event.key.toLowerCase();
      const ordered = [
        ...options.slice(index + 1),
        ...options.slice(0, index + 1),
      ];
      const match = ordered.find((option) =>
        (option.textContent ?? "").trim().toLowerCase().startsWith(initial),
      );
      if (match) {
        event.preventDefault();
        match.focus();
      }
    }
  };

  const enabled = items.filter((item) => !item.disabled);

  return (
    <div className="row-menu">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled || enabled.length === 0}
        onClick={() => {
          pendingFocus.current = "first";
          setOpen((current) => !current);
        }}
        onKeyDown={onTriggerKeyDown}
        {...(testId ? { "data-testid": testId } : {})}
      >
        <DotsThree size={16} weight="bold" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="menu row-menu__menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={
                item.danger ? "menu__item menu__item--danger" : "menu__item"
              }
              aria-disabled={item.disabled ? true : undefined}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              {...(item.testId ? { "data-testid": item.testId } : {})}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
