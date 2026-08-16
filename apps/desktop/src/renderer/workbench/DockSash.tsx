import { useRef } from "react";

export interface DockSashProps {
  label: string;
  onDelta: (delta: number) => void;
}

/**
 * Drag handle between docks. The visible rule is 4px; the hit area stays 32px
 * so it meets the control-height floor without looking like a fat splitter.
 */
export function DockSash({ label, onDelta }: DockSashProps) {
  const lastX = useRef<number | null>(null);

  return (
    <div
      className="dock-sash"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      data-testid="dock-sash"
      onPointerDown={(event) => {
        lastX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (lastX.current === null) return;
        const delta = event.clientX - lastX.current;
        lastX.current = event.clientX;
        if (delta !== 0) onDelta(delta);
      }}
      onPointerUp={(event) => {
        lastX.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
    />
  );
}
