import type { Segment } from "@translunar/contracts";

import type { FormatVars, MessageKey } from "./i18n/messages";

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

export type TranslateFn = (key: MessageKey, vars?: FormatVars) => string;

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

/** Stable Engine/desktop error code when present on a structured rejection. */
export function engineErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = error.code;
  return typeof code === "string" ? code : null;
}

/** String field from structured Engine error `data` (camelCase protocol shape). */
export function engineErrorDataField(
  error: unknown,
  field: string,
): string | null {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return null;
  }
  const data = error.data;
  if (typeof data !== "object" || data === null || !(field in data)) {
    return null;
  }
  const value = (data as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/**
 * Format Engine/desktop boundary errors for product UI.
 * Maps known product-facing codes (`policy_denied`) through the catalog when
 * `t` is supplied; other protocol messages remain audited technical English.
 */
export function formatEngineError(error: unknown, t?: TranslateFn): string {
  if (t && engineErrorCode(error) === "policy_denied") {
    return t("error.allowlistDenied", {
      profileId: engineErrorDataField(error, "profileId") ?? "—",
    });
  }
  return formatError(error);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}
