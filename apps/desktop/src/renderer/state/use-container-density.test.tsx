import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPACT_THRESHOLD_PX,
  resolveDensity,
  useContainerDensity,
} from "./use-container-density";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("resolveDensity", () => {
  it("switches at the documented threshold", () => {
    expect(resolveDensity(COMPACT_THRESHOLD_PX - 1)).toBe("compact");
    expect(resolveDensity(COMPACT_THRESHOLD_PX)).toBe("comfortable");
    expect(resolveDensity(0)).toBe("compact");
    expect(resolveDensity(4000)).toBe("comfortable");
  });

  it("accepts a caller threshold", () => {
    expect(resolveDensity(500, 400)).toBe("comfortable");
    expect(resolveDensity(300, 400)).toBe("compact");
  });
});

/** Minimal ResizeObserver that lets a test drive one width change. */
function stubResizeObserver(): { emit: (width: number) => void } {
  let callback: ResizeObserverCallback | null = null;
  let observed: Element | null = null;
  class Stub implements ResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      callback = cb;
    }
    observe(target: Element) {
      observed = target;
    }
    unobserve() {}
    disconnect() {
      callback = null;
    }
  }
  vi.stubGlobal("ResizeObserver", Stub);
  return {
    emit(width: number) {
      if (!callback || !observed) return;
      callback(
        [
          {
            target: observed,
            contentRect: { width } as DOMRectReadOnly,
            contentBoxSize: [{ inlineSize: width, blockSize: 0 }],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    },
  };
}

function Harness() {
  const ref = useContainerDensity<HTMLDivElement>();
  return <div ref={ref} data-testid="region" />;
}

describe("useContainerDensity", () => {
  it("publishes the band on the observed element", () => {
    const observer = stubResizeObserver();
    const { getByTestId } = render(<Harness />);
    const region = getByTestId("region");

    act(() => observer.emit(400));
    expect(region.dataset.density).toBe("compact");

    act(() => observer.emit(1200));
    expect(region.dataset.density).toBe("comfortable");
  });

  it("falls back to comfortable when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { getByTestId } = render(<Harness />);
    // Hiding capability is the worse failure, so the fallback keeps every
    // command label visible rather than guessing compact.
    expect(getByTestId("region").dataset.density).toBe("comfortable");
  });
});
