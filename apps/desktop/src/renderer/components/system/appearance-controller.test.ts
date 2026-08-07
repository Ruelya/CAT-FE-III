import { afterEach, describe, expect, it } from "vitest";

import {
  applyDensity,
  applyUiScale,
  bootstrapAppearance,
  clampUiScale,
  cycleDensity,
  DENSITY_STORAGE_KEY,
  isDensityPreference,
  percentToUiScale,
  readDensityPreference,
  readUiScale,
  setDensityPreference,
  setUiScale,
  UI_SCALE_STORAGE_KEY,
  uiScaleToPercent,
} from "./appearance-controller";

function mockStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

afterEach(() => {
  document.documentElement.removeAttribute("data-density");
  document.documentElement.style.removeProperty("--ui-scale");
});

describe("appearance-controller", () => {
  it("validates density enum", () => {
    expect(isDensityPreference("compact")).toBe(true);
    expect(isDensityPreference("standard")).toBe(true);
    expect(isDensityPreference("comfortable")).toBe(true);
    expect(isDensityPreference("dense")).toBe(false);
  });

  it("clamps ui scale to 0.8–1.6", () => {
    expect(clampUiScale(0.5)).toBe(0.8);
    expect(clampUiScale(2)).toBe(1.6);
    expect(clampUiScale(1.25)).toBe(1.25);
    expect(clampUiScale(Number.NaN)).toBe(1);
  });

  it("applies density dataset (omits standard)", () => {
    applyDensity("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
    applyDensity("standard");
    expect(document.documentElement.dataset.density).toBeUndefined();
    applyDensity("comfortable");
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("applies --ui-scale on root", () => {
    applyUiScale(1.25);
    expect(
      document.documentElement.style.getPropertyValue("--ui-scale"),
    ).toBe("1.25");
  });

  it("persists density and scale", () => {
    const storage = mockStorage();
    setDensityPreference("compact", { storage });
    expect(storage.getItem(DENSITY_STORAGE_KEY)).toBe("compact");
    const scale = setUiScale(1.6, { storage });
    expect(scale).toBe(1.6);
    expect(storage.getItem(UI_SCALE_STORAGE_KEY)).toBe("1.6");
  });

  it("reads defaults", () => {
    const storage = mockStorage();
    expect(readDensityPreference(storage)).toBe("standard");
    expect(readUiScale(storage)).toBe(1);
  });

  it("bootstrap applies both", () => {
    const storage = mockStorage({
      [DENSITY_STORAGE_KEY]: "comfortable",
      [UI_SCALE_STORAGE_KEY]: "1.25",
    });
    const result = bootstrapAppearance({ storage });
    expect(result.density).toBe("comfortable");
    expect(result.uiScale).toBe(1.25);
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("cycles density both directions", () => {
    expect(cycleDensity("compact")).toBe("standard");
    expect(cycleDensity("standard")).toBe("comfortable");
    expect(cycleDensity("comfortable")).toBe("compact");
    expect(cycleDensity("standard", -1)).toBe("compact");
    expect(cycleDensity("compact", -1)).toBe("comfortable");
  });

  it("percent helpers", () => {
    expect(uiScaleToPercent(1.25)).toBe(125);
    expect(percentToUiScale(160)).toBe(1.6);
    expect(percentToUiScale(50)).toBe(0.8);
  });
});
