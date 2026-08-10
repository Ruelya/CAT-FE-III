/**
 * Pure platform mapping for desktop window chrome.
 *
 * - macOS: hidden-inset title bar + native traffic lights (renderer omits custom controls).
 * - Windows / Linux / other: hidden title bar + custom renderer controls (documented fallback).
 *
 * Intentionally free of Electron bootstrap side effects so Vitest can import it.
 */

export type WindowChromePlatform = "macos" | "custom";

export interface WindowChromeTitleBarOptions {
  /** Electron BrowserWindow titleBarStyle for the host platform. */
  titleBarStyle: "hidden" | "hiddenInset";
  /** When true, the renderer draws Minimize / Maximize-Restore / Close. */
  usesCustomWindowControls: boolean;
}

/**
 * Map a Node/Electron `process.platform` value to the renderer branch vocabulary.
 * Only the explicit macOS value selects native traffic lights; everything else
 * is the custom-control fallback (Windows and Linux included).
 */
export function resolveWindowChromePlatform(
  platform: string,
): WindowChromePlatform {
  return platform === "darwin" ? "macos" : "custom";
}

/** BrowserWindow title-bar options for the given host platform. */
export function windowChromeTitleBarOptions(
  platform: string,
): WindowChromeTitleBarOptions {
  if (resolveWindowChromePlatform(platform) === "macos") {
    return {
      titleBarStyle: "hiddenInset",
      usesCustomWindowControls: false,
    };
  }
  return {
    titleBarStyle: "hidden",
    usesCustomWindowControls: true,
  };
}
