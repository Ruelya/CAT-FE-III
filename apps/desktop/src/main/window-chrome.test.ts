import { describe, expect, it } from "vitest";

import {
  resolveWindowChromePlatform,
  windowChromeTitleBarOptions,
} from "./window-chrome.js";

describe("window-chrome platform helper", () => {
  it("selects macOS hidden-inset / native traffic lights", () => {
    expect(resolveWindowChromePlatform("darwin")).toBe("macos");
    expect(windowChromeTitleBarOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      usesCustomWindowControls: false,
    });
  });

  it("selects Windows hidden title bar / custom controls", () => {
    expect(resolveWindowChromePlatform("win32")).toBe("custom");
    expect(windowChromeTitleBarOptions("win32")).toEqual({
      titleBarStyle: "hidden",
      usesCustomWindowControls: true,
    });
  });

  it("uses the documented non-macOS fallback for Linux and unknown hosts", () => {
    for (const platform of ["linux", "freebsd", "openbsd", "sunos", "aix"]) {
      expect(resolveWindowChromePlatform(platform)).toBe("custom");
      expect(windowChromeTitleBarOptions(platform)).toEqual({
        titleBarStyle: "hidden",
        usesCustomWindowControls: true,
      });
    }
  });

  it("does not encode mutable size or security options in the chrome helper", () => {
    const options = windowChromeTitleBarOptions("win32");
    expect(options).not.toHaveProperty("width");
    expect(options).not.toHaveProperty("minWidth");
    expect(options).not.toHaveProperty("webPreferences");
    expect(options).not.toHaveProperty("frame");
  });
});
