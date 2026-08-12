import { useEffect, useRef, useState } from "react";

import type { AppState } from "../state/app-state";

/**
 * Surface transition continuity (motion class M1) plus the accessibility half
 * of the same event.
 *
 * On every surface change this moves focus to the new surface heading so a
 * keyboard user is not left on a control that no longer exists, and publishes
 * a polite announcement so a screen reader user hears where they landed. The
 * View Transition wrapper is feature-detected and skipped under reduced
 * motion, so the fallback is simply an instant swap.
 */

export interface SurfaceAnnouncement {
  /** Live-region text for the current surface. */
  message: string;
}

const SURFACE_LABELS: Record<string, string> = {
  boot: "Starting",
  recovery: "Draft recovery",
  welcome: "Welcome",
  projects: "Projects",
  "create-project": "New project",
  "import-document": "Import document",
  templates: "Templates",
  recycle: "Recycle",
  search: "Search",
  workbench: "Workbench",
  qa: "QA",
  export: "Export",
  insights: "Insights",
  assets: "Assets",
  "ai-control": "AI Control",
  plugins: "Plugins",
  collaboration: "Collaboration",
  settings: "Settings",
};

export function surfaceLabel(kind: string): string {
  return SURFACE_LABELS[kind] ?? kind;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Run a surface swap inside a view transition when the platform supports one.
 * Exported so callers that mutate route state directly can opt in.
 */
export function withSurfaceTransition(apply: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  if (prefersReducedMotion() || typeof doc.startViewTransition !== "function") {
    apply();
    return;
  }
  doc.startViewTransition(apply);
}

export function useSurfaceAnnouncement(state: AppState): SurfaceAnnouncement {
  const kind = state.surface.kind;
  const [message, setMessage] = useState("");
  const previousKind = useRef<string | null>(null);

  useEffect(() => {
    if (previousKind.current === kind) return;
    const firstRender = previousKind.current === null;
    previousKind.current = kind;

    const label = surfaceLabel(kind);
    setMessage(label);

    // Boot and recovery own their own focus; do not fight them.
    if (firstRender || kind === "boot" || kind === "recovery") return;

    // Wait a frame so the new surface has mounted its heading.
    const frame = requestAnimationFrame(() => {
      const stage = document.querySelector<HTMLElement>(".app-stage");
      if (!stage) return;

      // Only rescue focus that the transition actually stranded. If the user
      // has already reached a control in the new surface, or is inside a
      // dialog or the title strip, moving focus would interrupt them.
      const active = document.activeElement;
      const stranded =
        active === null ||
        active === document.body ||
        !document.contains(active);
      if (!stranded) return;

      const heading = stage.querySelector<HTMLElement>(
        "h1, [data-surface-heading]",
      );
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [kind]);

  return { message };
}
