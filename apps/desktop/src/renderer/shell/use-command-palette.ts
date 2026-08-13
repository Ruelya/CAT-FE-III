import { useCallback, useEffect, useState } from "react";

import { isImeKeyboardEvent } from "../lib/ime";

/**
 * Ctrl/Cmd+K ownership.
 *
 * The chord is renderer-owned; Electron main must not swallow it. It is
 * ignored while an IME composition is active so a CJK candidate window is
 * never interrupted, and the palette closes itself on Escape.
 */
export function useCommandPalette(enabled: boolean): {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
} {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      if (isImeKeyboardEvent(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  return { open, openPalette, closePalette };
}
