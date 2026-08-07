import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SegmentStatusLamp } from "./SegmentStatusLamp";
import type { SegmentLampState } from "./segmentTypes";

const STATES: SegmentLampState[] = [
  "untranslated",
  "draft",
  "confirmed",
  "reviewed",
  "signed",
  "error",
  "warning",
  "locked",
];

describe("SegmentStatusLamp", () => {
  it("renders eight distinct shape hooks with localized names", () => {
    const { container } = render(
      <>
        {STATES.map((state) => (
          <SegmentStatusLamp
            key={state}
            state={state}
            label={`label-${state}`}
          />
        ))}
      </>,
    );
    const lamps = container.querySelectorAll("[data-lamp]");
    expect(lamps).toHaveLength(8);
    const shapes = new Set(
      [...lamps].map((node) => node.getAttribute("data-state")),
    );
    expect(shapes.size).toBe(8);
    for (const state of STATES) {
      const lamp = container.querySelector(`[data-state="${state}"]`);
      expect(lamp?.getAttribute("aria-label")).toBe(`label-${state}`);
      expect(lamp?.querySelector(".status-lamp__shape")).toBeTruthy();
    }
  });
});
