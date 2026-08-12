import { useEffect, useRef } from "react";

/**
 * Container-responsive density band.
 *
 * Dock state changes the editor width without changing the window width, so a
 * viewport media query cannot express the Workbench compact rule. A
 * ResizeObserver on the container writes `data-density` and CSS reacts to the
 * attribute.
 *
 * Contract: `.trellis/spec/frontend/electron-workbench.md`.
 */

export type DensityBand = "comfortable" | "compact";

/** Below this container width, command labels collapse to icons. */
export const COMPACT_THRESHOLD_PX = 720;

export function resolveDensity(
  width: number,
  threshold = COMPACT_THRESHOLD_PX,
): DensityBand {
  return width < threshold ? "compact" : "comfortable";
}

/**
 * Observes the returned element and keeps `data-density` current.
 * Falls back to `comfortable` where ResizeObserver is unavailable, which keeps
 * every label visible rather than hiding capability.
 */
export function useContainerDensity<T extends HTMLElement>(
  threshold = COMPACT_THRESHOLD_PX,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const apply = (width: number) => {
      const band = resolveDensity(width, threshold);
      if (node.dataset.density !== band) node.dataset.density = band;
    };

    if (typeof ResizeObserver === "undefined") {
      node.dataset.density = "comfortable";
      return;
    }

    apply(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width =
          entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        apply(width);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return ref;
}
