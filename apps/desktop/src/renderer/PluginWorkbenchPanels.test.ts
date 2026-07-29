import { describe, expect, it } from "vitest";

import { nextTabIndex } from "./PluginWorkbenchPanels";

describe("nextTabIndex", () => {
  it("keeps plugin panel tabs keyboard reachable in a stable loop", () => {
    expect(nextTabIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextTabIndex("Home", 1, 3)).toBe(0);
    expect(nextTabIndex("End", 1, 3)).toBe(2);
    expect(nextTabIndex("Enter", 1, 3)).toBeNull();
  });
});
