import { useRef } from "react";

export interface DockSashProps {
  label: string;
  onDelta: (delta: number) => void;
  orientation?: "vertical" | "horizontal";
}

/**
 * Drag handle between docks. The visible rule is 4px; the hit area stays 32px
 * so it meets the control-height floor without looking like a fat splitter.
 */
export function DockSash({
  label,
  onDelta,
  orientation = "vertical",
}: DockSashProps) {
  const last = useRef<number | null>(null);
  const horizontal = orientation === "horizontal";

  return (
    <div
      className={`dock-sash${horizontal ? " dock-sash--horizontal" : ""}`}
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={label}
      data-testid="dock-sash"
      onPointerDown={(event) => {
        last.current = horizontal ? event.clientY : event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (last.current === null) return;
        const pos = horizontal ? event.clientY : event.clientX;
        const delta = pos - last.current;
        last.current = pos;
        if (delta !== 0) onDelta(delta);
      }}
      onPointerUp={(event) => {
        last.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
    />
  );
}
