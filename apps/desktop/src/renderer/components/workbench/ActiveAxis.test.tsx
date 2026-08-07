import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActiveAxis } from "./ActiveAxis";

describe("ActiveAxis", () => {
  it("renders a single data-axis=active marker for row residence", () => {
    const { container } = render(<ActiveAxis variant="row" />);
    const axes = container.querySelectorAll('[data-axis="active"]');
    expect(axes).toHaveLength(1);
    expect(axes[0]?.getAttribute("data-axis-variant")).toBe("row");
    expect(axes[0]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders chip under-edge variant", () => {
    const { container } = render(<ActiveAxis variant="chip" />);
    const axis = container.querySelector('[data-axis="active"]');
    expect(axis?.classList.contains("active-axis--chip")).toBe(true);
    expect(axis?.getAttribute("data-axis-variant")).toBe("chip");
  });
});
