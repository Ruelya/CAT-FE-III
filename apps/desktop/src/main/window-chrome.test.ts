import { describe, expect, it } from "vitest";

import {
  TITLEBAR_HEIGHT,
  TITLEBAR_OVERLAY_DEFAULTS,
  normalizeOverlayColors,
  windowChromeMode,
  windowChromeOptions,
} from "./window-chrome.js";

describe("windowChromeMode", () => {
  it("integrates the titlebar on Windows and Linux, keeps the system frame on macOS", () => {
    expect(windowChromeMode("win32")).toBe("integrated");
    expect(windowChromeMode("linux")).toBe("integrated");
    expect(windowChromeMode("darwin")).toBe("system");
  });
});

describe("windowChromeOptions", () => {
  it("Windows: hides the DWM caption and keeps the native buttons as an overlay", () => {
    const options = windowChromeOptions("win32");
    expect(options.titleBarStyle).toBe("hidden");
    expect(options.titleBarOverlay).toEqual({
      height: TITLEBAR_HEIGHT,
      color: TITLEBAR_OVERLAY_DEFAULTS.color,
      symbolColor: TITLEBAR_OVERLAY_DEFAULTS.symbolColor,
    });
  });

  it("Windows: the application menu never takes a second row of chrome", () => {
    // The menu stays installed (accelerators), but the classic bar is
    // auto-hidden so 文件…帮助 render only inside the titlebar strip.
    expect(windowChromeOptions("win32").autoHideMenuBar).toBe(true);
    expect(windowChromeOptions("linux").autoHideMenuBar).toBe(true);
  });

  it("never fakes window buttons: no frame:false anywhere", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      expect(windowChromeOptions(platform).frame).toBeUndefined();
    }
  });

  it("Linux mirrors the Windows chrome; macOS keeps its native frame untouched", () => {
    expect(windowChromeOptions("linux")).toEqual(windowChromeOptions("win32"));
    expect(windowChromeOptions("darwin")).toEqual({});
  });

  it("overlay defaults are the default theme's chrome, as plain hex", () => {
    expect(TITLEBAR_OVERLAY_DEFAULTS.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(TITLEBAR_OVERLAY_DEFAULTS.symbolColor).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("normalizeOverlayColors", () => {
  it("accepts a plain hex pair", () => {
    expect(
      normalizeOverlayColors({ color: "#ecebe3", symbolColor: "#2E2A23" }),
    ).toEqual({ color: "#ecebe3", symbolColor: "#2E2A23" });
  });

  it("rejects anything that could smuggle a non-color into the overlay", () => {
    expect(normalizeOverlayColors(null)).toBeNull();
    expect(normalizeOverlayColors("terra")).toBeNull();
    expect(normalizeOverlayColors({ color: "#ecebe3" })).toBeNull();
    expect(
      normalizeOverlayColors({ color: "red", symbolColor: "#2e2a23" }),
    ).toBeNull();
    expect(
      normalizeOverlayColors({
        color: "rgb(1, 2, 3)",
        symbolColor: "#2e2a23",
      }),
    ).toBeNull();
    expect(
      normalizeOverlayColors({ color: "#ecebe3", symbolColor: "#fff" }),
    ).toBeNull();
  });
});
