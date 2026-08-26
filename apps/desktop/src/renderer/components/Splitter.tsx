import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
} from "@tabler/icons-react";

/**
 * Per-project workbench layout: rail widths, collapse states, and the
 * bottom preview pane. Pure UI preference — it lives in localStorage
 * (key includes the projectId), never in the engine.
 */
export interface WorkbenchLayout {
  /** Left explorer rail width (px). */
  left: number;
  /** Right dock rail width (px). */
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** Bottom preview pane. */
  previewOpen: boolean;
  previewHeight: number;
}

export const DEFAULT_LAYOUT: WorkbenchLayout = {
  left: 260,
  right: 336,
  leftCollapsed: false,
  rightCollapsed: false,
  previewOpen: false,
  previewHeight: 240,
};

/** Rail/pane size clamps (PRD §3.4): the center grid keeps ≥480px. */
export const LAYOUT_LIMITS = {
  left: { min: 180, max: 400 },
  right: { min: 240, max: 480 },
  preview: { min: 120, max: 560 },
} as const;

export function layoutStorageKey(projectId: string): string {
  return `tl.layout.${projectId}`;
}

function clampLayout(layout: WorkbenchLayout): WorkbenchLayout {
  return {
    ...layout,
    left: Math.min(
      LAYOUT_LIMITS.left.max,
      Math.max(LAYOUT_LIMITS.left.min, layout.left),
    ),
    right: Math.min(
      LAYOUT_LIMITS.right.max,
      Math.max(LAYOUT_LIMITS.right.min, layout.right),
    ),
    previewHeight: Math.min(
      LAYOUT_LIMITS.preview.max,
      Math.max(LAYOUT_LIMITS.preview.min, layout.previewHeight),
    ),
  };
}

function readLayout(projectId: string): WorkbenchLayout {
  try {
    const raw = localStorage.getItem(layoutStorageKey(projectId));
    if (!raw) {
      return DEFAULT_LAYOUT;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_LAYOUT;
    }
    return clampLayout({ ...DEFAULT_LAYOUT, ...parsed });
  } catch {
    // Corrupt or unavailable storage falls back to defaults; layout is a
    // preference, never worth an error surface.
    return DEFAULT_LAYOUT;
  }
}

/**
 * Loads and persists the per-project layout. Every update writes through
 * to localStorage so the layout survives restarts.
 */
export function useWorkbenchLayout(
  projectId: string,
): [WorkbenchLayout, (patch: Partial<WorkbenchLayout>) => void] {
  const [layout, setLayout] = useState<WorkbenchLayout>(() =>
    readLayout(projectId),
  );
  const projectRef = useRef(projectId);
  useEffect(() => {
    if (projectRef.current !== projectId) {
      projectRef.current = projectId;
      setLayout(readLayout(projectId));
    }
  }, [projectId]);
  const update = useCallback(
    (patch: Partial<WorkbenchLayout>) => {
      setLayout((current) => {
        const next = clampLayout({ ...current, ...patch });
        try {
          localStorage.setItem(
            layoutStorageKey(projectId),
            JSON.stringify(next),
          );
        } catch {
          // Storage full/blocked: the session keeps the layout in memory.
        }
        return next;
      });
    },
    [projectId],
  );
  return [layout, update];
}

export interface SplitterProps {
  /** vertical = column divider (drags left/right); horizontal = row. */
  orientation: "vertical" | "horizontal";
  /** Extra class for grid placement (e.g. splitter--left). */
  className?: string;
  label: string;
  /** Current size of the pane this splitter controls. */
  value: number;
  min: number;
  max: number;
  /**
   * +1 when dragging right/down grows the controlled pane, -1 when it
   * shrinks it (pane sits on the far side of the splitter).
   */
  sign: 1 | -1;
  collapsed?: boolean;
  onResize: (next: number) => void;
  /** Double-click: reset to the default size. */
  onReset: () => void;
  /** Chevron / Enter: collapse or restore (remembered width). */
  onToggleCollapse?: (() => void) | undefined;
}

/** Keyboard resize step (arrow keys on the focused splitter). */
const KEY_STEP = 16;

/**
 * Draggable pane divider. 4px hit area, hover accent; double-click resets
 * the default size; the chevron (or Enter on the focused splitter)
 * collapses/restores; arrow keys resize from the keyboard.
 */
export function Splitter({
  orientation,
  className,
  label,
  value,
  min,
  max,
  sign,
  collapsed = false,
  onResize,
  onReset,
  onToggleCollapse,
}: SplitterProps) {
  const dragRef = useRef<{ start: number; base: number } | null>(null);

  const clamp = useCallback(
    (next: number) => Math.min(max, Math.max(min, next)),
    [min, max],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (collapsed || event.button !== 0) {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest("button")) {
        // The chevron owns its own clicks.
        return;
      }
      dragRef.current = {
        start: orientation === "vertical" ? event.clientX : event.clientY,
        base: value,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [collapsed, orientation, value],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const position =
        orientation === "vertical" ? event.clientX : event.clientY;
      onResize(clamp(drag.base + sign * (position - drag.start)));
    },
    [orientation, sign, clamp, onResize],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const chevron = (() => {
    if (!onToggleCollapse) {
      return null;
    }
    const size = 12;
    if (orientation === "horizontal") {
      return collapsed ? (
        <IconChevronUp size={size} stroke={2} aria-hidden />
      ) : (
        <IconChevronDown size={size} stroke={2} aria-hidden />
      );
    }
    // A vertical splitter collapses the pane on its `sign` side: the left
    // rail (sign +1) folds leftwards, the right rail (sign -1) rightwards.
    const foldLeft = sign === 1;
    if (collapsed) {
      return foldLeft ? (
        <IconChevronRight size={size} stroke={2} aria-hidden />
      ) : (
        <IconChevronLeft size={size} stroke={2} aria-hidden />
      );
    }
    return foldLeft ? (
      <IconChevronLeft size={size} stroke={2} aria-hidden />
    ) : (
      <IconChevronRight size={size} stroke={2} aria-hidden />
    );
  })();

  return (
    <div
      className={className ? `splitter ${className}` : "splitter"}
      data-orientation={orientation}
      data-collapsed={collapsed || undefined}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={collapsed ? 0 : Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const keys =
          orientation === "vertical"
            ? { grow: "ArrowRight", shrink: "ArrowLeft" }
            : { grow: "ArrowDown", shrink: "ArrowUp" };
        if (event.key === keys.grow || event.key === keys.shrink) {
          event.preventDefault();
          if (!collapsed) {
            const delta = event.key === keys.grow ? KEY_STEP : -KEY_STEP;
            onResize(clamp(value + sign * delta));
          }
          return;
        }
        if (event.key === "Enter" && onToggleCollapse) {
          event.preventDefault();
          onToggleCollapse();
        }
      }}
    >
      {onToggleCollapse ? (
        <button
          type="button"
          className="splitter__chevron"
          aria-label={collapsed ? `展开${label}` : `折叠${label}`}
          title={collapsed ? `展开${label}` : `折叠${label}`}
          tabIndex={-1}
          onClick={onToggleCollapse}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {chevron}
        </button>
      ) : null}
    </div>
  );
}
