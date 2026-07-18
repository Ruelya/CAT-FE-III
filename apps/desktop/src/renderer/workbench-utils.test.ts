import { describe, expect, it } from "vitest";

import {
  fileName,
  isConfirmShortcut,
  nextVisibleSegmentId,
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
});
