import type { Segment } from "@translunar/contracts";

export type PanelMode = "docked" | "collapsed" | "maximized";

export const PREVIEW_MIN_HEIGHT = 120;
export const PREVIEW_MAX_HEIGHT = 320;
export const PREVIEW_DEFAULT_HEIGHT = 200;

export interface ConfirmKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}

export function isConfirmShortcut(
  input: ConfirmKeyInput,
  compositionActive: boolean,
): boolean {
  return (
    input.key === "Enter" &&
    (input.ctrlKey || input.metaKey) &&
    !compositionActive &&
    !input.isComposing &&
    input.keyCode !== 229
  );
}

export function replaceSegment(
  segments: readonly Segment[],
  replacement: Segment,
): Segment[] {
  return segments.map((segment) =>
    segment.id === replacement.id ? replacement : segment,
  );
}

export function nextVisibleSegmentId(
  visibleIds: readonly string[],
  activeId: string,
): string | null {
  const index = visibleIds.indexOf(activeId);
  return index >= 0 ? (visibleIds[index + 1] ?? null) : null;
}

export function togglePanelCollapsed(mode: PanelMode): PanelMode {
  return mode === "collapsed" ? "docked" : "collapsed";
}

export function togglePanelMaximized(mode: PanelMode): PanelMode {
  return mode === "maximized" ? "docked" : "maximized";
}

export function clampPreviewHeight(value: number): number {
  if (!Number.isFinite(value)) return PREVIEW_DEFAULT_HEIGHT;
  return Math.min(
    PREVIEW_MAX_HEIGHT,
    Math.max(PREVIEW_MIN_HEIGHT, Math.round(value)),
  );
}

export function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
