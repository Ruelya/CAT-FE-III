import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Shared APG menu-button keyboard model.
 *
 * Any element that claims `aria-haspopup="menu"` owes the user this behaviour:
 * opening moves focus into the menu, ArrowUp opens onto the last item, Arrow,
 * Home, End and type-ahead move between items, disabled items are skipped, and
 * Escape or an outside pointer closes and returns focus to the trigger.
 * Claiming the role without it is worse than using a plain button row.
 */

const FOCUSABLE_ITEM = '[role="menuitem"]:not([aria-disabled="true"])';

export interface MenuKeyboard {
  /** Attach to the trigger's onKeyDown. */
  onTriggerKeyDown: (event: React.KeyboardEvent) => void;
  /** Attach to the menu container's onKeyDown. */
  onMenuKeyDown: (event: React.KeyboardEvent) => void;
  /** Call when the trigger is clicked. */
  toggle: () => void;
  /** Close without moving focus, for example after running an item. */
  close: (restoreFocus: boolean) => void;
}

export function useMenuKeyboard(options: {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLElement | null>;
}): MenuKeyboard {
  const { open, setOpen, triggerRef, menuRef } = options;
  const pendingFocus = useRef<"first" | "last">("first");

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [setOpen, triggerRef],
  );

  useEffect(() => {
    if (!open) return;
    const items =
      menuRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM);
    if (!items || items.length === 0) return;
    const target =
      pendingFocus.current === "last" ? items[items.length - 1]! : items[0]!;
    target.focus();
  }, [open, menuRef]);

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
  }, [open, menuRef, setOpen, triggerRef]);

  const onTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
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
    },
    [setOpen],
  );

  const onMenuKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const menu = menuRef.current;
      if (!menu) return;
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM),
      );
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          close(true);
          return;
        case "Tab":
          close(false);
          return;
        case "ArrowDown":
          event.preventDefault();
          items[(index + 1 + items.length) % items.length]!.focus();
          return;
        case "ArrowUp":
          event.preventDefault();
          items[(index - 1 + items.length) % items.length]!.focus();
          return;
        case "Home":
          event.preventDefault();
          items[0]!.focus();
          return;
        case "End":
          event.preventDefault();
          items[items.length - 1]!.focus();
          return;
        default:
          break;
      }

      if (event.key.length === 1 && /\S/.test(event.key)) {
        const initial = event.key.toLowerCase();
        const ordered = [
          ...items.slice(index + 1),
          ...items.slice(0, index + 1),
        ];
        const match = ordered.find((item) =>
          (item.textContent ?? "").trim().toLowerCase().startsWith(initial),
        );
        if (match) {
          event.preventDefault();
          match.focus();
        }
      }
    },
    [close, menuRef],
  );

  const toggle = useCallback(() => {
    pendingFocus.current = "first";
    setOpen(!open);
  }, [open, setOpen]);

  return { onTriggerKeyDown, onMenuKeyDown, toggle, close };
}

/**
 * Roving tabindex for a `role="toolbar"`.
 *
 * A toolbar is one Tab stop; Arrow keys move within it. Without this the role
 * is a promise the widget does not keep, and a dense command bar becomes a
 * dozen tab stops between the grid and the editor.
 */
export function useToolbarRoving(
  toolbarRef: RefObject<HTMLElement | null>,
): (event: React.KeyboardEvent) => void {
  return useCallback(
    (event: React.KeyboardEvent) => {
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const toolbar = toolbarRef.current;
      if (!toolbar) return;
      // Only the enabled controls participate; a disabled command is skipped
      // rather than becoming a dead stop in the sequence.
      const items = Array.from(
        toolbar.querySelectorAll<HTMLElement>("button:not([disabled])"),
      );
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index === -1) return;

      event.preventDefault();
      if (event.key === "Home") {
        items[0]!.focus();
        return;
      }
      if (event.key === "End") {
        items[items.length - 1]!.focus();
        return;
      }
      const delta = event.key === "ArrowRight" ? 1 : -1;
      items[(index + delta + items.length) % items.length]!.focus();
    },
    [toolbarRef],
  );
}
