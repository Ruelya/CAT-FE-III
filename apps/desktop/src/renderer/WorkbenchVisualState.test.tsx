import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  WorkbenchVisualState,
  type WorkbenchVisualStateKind,
  type WorkbenchVisualStateVariant,
} from "./WorkbenchVisualState";

afterEach(cleanup);

const NAMED_STATES: ReadonlyArray<{
  kind: WorkbenchVisualStateKind;
  variant: WorkbenchVisualStateVariant;
  label: string;
}> = [
  { kind: "loading", variant: "matches", label: "TM lookup loading" },
  {
    kind: "loading",
    variant: "assistant",
    label: "Assistant first token loading",
  },
  { kind: "loading", variant: "preview", label: "PDF page loading" },
  { kind: "empty", variant: "matches", label: "No TM match" },
  { kind: "empty", variant: "terms", label: "No term hit" },
  { kind: "empty", variant: "qa", label: "No open QA issue" },
  {
    kind: "empty",
    variant: "assistant",
    label: "No Assistant conversation",
  },
  { kind: "empty", variant: "grid", label: "No grid result" },
];

describe("WorkbenchVisualState", () => {
  it("renders exactly the three loading and five empty state contracts", () => {
    for (const state of NAMED_STATES) {
      const view = render(<WorkbenchVisualState {...state} />);
      const status = screen.getByRole("status", { name: state.label });
      expect(status).toHaveAttribute("data-state-kind", state.kind);
      expect(status).toHaveAttribute("data-state-variant", state.variant);
      if (state.kind === "loading") {
        expect(status).toHaveAttribute("aria-busy", "true");
        expect(
          status.querySelector(".workbench-state-skeleton"),
        ).not.toBeNull();
      } else {
        expect(status).not.toHaveAttribute("aria-busy");
        expect(status.querySelector(".workbench-state-skeleton")).toBeNull();
      }
      expect(status.querySelector(".spin")).toBeNull();
      view.unmount();
    }
  });

  it("renders only a real action supplied by the owning surface", () => {
    const view = render(
      <WorkbenchVisualState
        kind="empty"
        variant="matches"
        label="No TM match"
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();

    view.rerender(
      <WorkbenchVisualState
        kind="empty"
        variant="grid"
        label="No grid result"
        action={<button type="button">Clear filters</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeEnabled();
  });
});
