import { describe, expect, it } from "vitest";

import { exchangeFormatFromPath } from "./exchange-format";

describe("exchangeFormatFromPath", () => {
  it("reads the suffix the picker already constrained", () => {
    expect(exchangeFormatFromPath("/tmp/mem.tmx", "tm")).toBe("tmx");
    expect(exchangeFormatFromPath("/tmp/terms.TBX", "termbase")).toBe("tbx");
    expect(exchangeFormatFromPath("C:\\data\\units.CSV", "tm")).toBe("csv");
    expect(exchangeFormatFromPath("/tmp/units.tsv", "termbase")).toBe("tsv");
  });

  it("falls back to the format that kind accepts", () => {
    expect(exchangeFormatFromPath("/tmp/memory", "tm")).toBe("tmx");
    expect(exchangeFormatFromPath("/tmp/terms", "termbase")).toBe("tbx");
  });
});
