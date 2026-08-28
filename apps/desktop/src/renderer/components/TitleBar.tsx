/**
 * Integrated titlebar for hosts where the OS caption is hidden (Windows/
 * Linux): brand, the seven application menus, and the live window title on
 * one strip, with the native window buttons overlaid by the OS at the right
 * edge (`titleBarOverlay` — Snap Layouts and double-click-maximize stay
 * system-owned).
 *
 * The menu buttons own no menu tree: each click pops the matching top-level
 * submenu of the one `menu-template.ts` template through the main process,
 * so this strip and the (hidden) classic menu bar can never disagree.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { MENU_BAR_ITEMS } from "../../shared/desktop-api.js";
import type { MenuBarItemId } from "../../shared/desktop-api.js";
import { useTheme } from "../lib/theme.js";

/**
 * A computed CSS color (`rgb(...)` / `rgba(...)` / `#rrggbb`) as plain
 * 6-digit hex, which is what the native overlay accepts. Null when the
 * value cannot be resolved (e.g. an unstyled test environment).
 */
export function cssColorToHex(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const match =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(
      trimmed,
    );
  if (!match) {
    return null;
  }
  const channel = (raw: string): string =>
    Math.min(255, Number(raw)).toString(16).padStart(2, "0");
  return `#${channel(match[1]!)}${channel(match[2]!)}${channel(match[3]!)}`;
}

export interface TitleBarProps {
  /** The same working-object string document.title reports. */
  title: string;
}

export function TitleBar({ title }: TitleBarProps) {
  const { theme } = useTheme();
  const barRef = useRef<HTMLElement | null>(null);
  const menubarRef = useRef<HTMLElement | null>(null);
  const [openMenu, setOpenMenu] = useState<MenuBarItemId | null>(null);

  // The native window-button overlay repaints with the strip: measure the
  // themed colors off the real element after each theme switch and report.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const styles = getComputedStyle(bar);
    const color = cssColorToHex(styles.backgroundColor);
    const symbolColor = cssColorToHex(styles.color);
    if (color && symbolColor) {
      window.tl.setTitlebarOverlay({ color, symbolColor });
    }
  }, [theme.id]);

  const popup = useCallback(
    async (menuId: MenuBarItemId, button: HTMLElement) => {
      const rect = button.getBoundingClientRect();
      setOpenMenu(menuId);
      try {
        // Resolves when the native menu closes; the open highlight holds
        // for exactly that long.
        await window.tl.popupAppMenu(
          menuId,
          Math.round(rect.left),
          Math.round(rect.bottom),
        );
      } finally {
        setOpenMenu(null);
      }
    },
    [],
  );

  // Menubar arrow-key convention: Left/Right walk the seven buttons.
  const onMenubarKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      const menubar = menubarRef.current;
      if (!menubar) {
        return;
      }
      const buttons = Array.from(
        menubar.querySelectorAll<HTMLButtonElement>("button"),
      );
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (current < 0) {
        return;
      }
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = (current + step + buttons.length) % buttons.length;
      buttons[next]?.focus();
    },
    [],
  );

  return (
    <header className="titlebar" ref={barRef}>
      <div className="titlebar__brand">
        <span className="titlebar__mark" aria-hidden="true" />
        Translunar
      </div>
      <nav
        className="titlebar__menubar"
        role="menubar"
        aria-label="应用菜单"
        ref={menubarRef}
        onKeyDown={onMenubarKeyDown}
      >
        {MENU_BAR_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openMenu === item.id}
            className="titlebar__menu"
            data-open={openMenu === item.id ? "" : undefined}
            onClick={(event) => void popup(item.id, event.currentTarget)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="titlebar__title">{title}</div>
    </header>
  );
}
