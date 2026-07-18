import type { Segment } from "@translunar/contracts";

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

export function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
