import { describe, expect, it } from "vitest";

import {
  normalizeWorkbenchLayout,
  readWorkbenchLayout,
  writeWorkbenchLayout,
} from "./workbench-layout";

describe("workbench layout", () => {
  it("clamps panel widths and keeps files open by default", () => {
    expect(
      normalizeWorkbenchLayout({
        fileNavW: 20,
        intelW: 900,
      }),
    ).toMatchObject({
      fileNavW: 140,
      intelW: 480,
      filesOpen: true,
      previewSide: true,
    });
  });

  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    writeWorkbenchLayout(
      {
        fileNavW: 180,
        intelW: 260,
        previewW: 240,
        filesOpen: false,
        previewSide: true,
        chatOpen: true,
      },
      storage,
    );
    expect(readWorkbenchLayout(storage).filesOpen).toBe(false);
    expect(readWorkbenchLayout(storage).chatOpen).toBe(true);
  });
});
