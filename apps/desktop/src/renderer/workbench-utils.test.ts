import { describe, expect, it } from "vitest";

import {
  clampPreviewHeight,
  fileName,
  formatError,
  isConfirmShortcut,
  nextVisibleSegmentId,
  togglePanelCollapsed,
  togglePanelMaximized,
} from "./workbench-utils";

describe("workbench interaction guards", () => {
  it("confirms only outside IME composition", () => {
    const shortcut = {
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      isComposing: false,
    };
    expect(isConfirmShortcut(shortcut, false)).toBe(true);
    expect(isConfirmShortcut({ ...shortcut, isComposing: true }, false)).toBe(
      false,
    );
    expect(isConfirmShortcut({ ...shortcut, keyCode: 229 }, false)).toBe(false);
    expect(isConfirmShortcut(shortcut, true)).toBe(false);
  });

  it("advances within the visible ordering", () => {
    expect(nextVisibleSegmentId(["a", "b", "c"], "b")).toBe("c");
    expect(nextVisibleSegmentId(["a", "b"], "b")).toBeNull();
  });

  it("extracts Windows and POSIX file names", () => {
    expect(fileName("C:\\docs\\source.docx")).toBe("source.docx");
    expect(fileName("/tmp/source.docx")).toBe("source.docx");
  });

  it("keeps panel transitions within the three accepted modes", () => {
    expect(togglePanelCollapsed("docked")).toBe("collapsed");
    expect(togglePanelCollapsed("maximized")).toBe("collapsed");
    expect(togglePanelCollapsed("collapsed")).toBe("docked");
    expect(togglePanelMaximized("docked")).toBe("maximized");
    expect(togglePanelMaximized("collapsed")).toBe("maximized");
    expect(togglePanelMaximized("maximized")).toBe("docked");
  });

  it("clamps preview resizing to the supported height", () => {
    expect(clampPreviewHeight(80)).toBe(120);
    expect(clampPreviewHeight(237.6)).toBe(238);
    expect(clampPreviewHeight(480)).toBe(320);
    expect(clampPreviewHeight(Number.NaN)).toBe(200);
  });

  it("formats structured Engine errors crossing the desktop boundary", () => {
    expect(formatError({ code: "conflict", message: "revision changed" })).toBe(
      "revision changed",
    );
  });
});
