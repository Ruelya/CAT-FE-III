import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  surfaceLabel,
  useSurfaceAnnouncement,
} from "./use-surface-announcement";
import type { AppState } from "../state/app-state";

afterEach(cleanup);

function stateFor(kind: string): AppState {
  return { surface: { kind } } as unknown as AppState;
}

function Harness({ kind }: { kind: string }) {
  const { message } = useSurfaceAnnouncement(stateFor(kind));
  return (
    <div>
      <p data-testid="live">{message}</p>
      <main className="app-stage">
        <div data-surface-container data-testid="container">
          <h1>{kind}</h1>
          <input data-testid="field" />
        </div>
      </main>
    </div>
  );
}

/** Run the queued animation frame the hook uses to wait for the new heading. */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe("useSurfaceAnnouncement", () => {
  it("labels every known surface and passes an unknown kind through", () => {
    expect(surfaceLabel("workbench")).toBe("Workbench");
    expect(surfaceLabel("ai-control")).toBe("AI Control");
    expect(surfaceLabel("something-new")).toBe("something-new");
  });

  it("announces the surface it moved to", async () => {
    const { getByTestId, rerender } = render(<Harness kind="projects" />);
    await flushFrame();
    expect(getByTestId("live")).toHaveTextContent("Projects");

    rerender(<Harness kind="workbench" />);
    await flushFrame();
    expect(getByTestId("live")).toHaveTextContent("Workbench");
  });

  it("rescues focus that the transition stranded on the body", async () => {
    const { getByTestId, rerender } = render(<Harness kind="projects" />);
    await flushFrame();

    document.body.focus();
    rerender(<Harness kind="workbench" />);
    await flushFrame();

    // The container is the focus target, not the heading: a heading would
    // paint a focus ring the user never asked for.
    const container = getByTestId("container");
    expect(document.activeElement).toBe(container);
    expect(container).toHaveAttribute("tabindex", "-1");
  });

  it("leaves focus alone when the user already reached a control", async () => {
    // Regression: focusing the heading unconditionally stole focus from a
    // field the user was typing into immediately after a route change.
    const { getByTestId, rerender } = render(<Harness kind="projects" />);
    await flushFrame();

    rerender(<Harness kind="create-project" />);
    const field = getByTestId("field");
    field.focus();
    await flushFrame();

    expect(document.activeElement).toBe(field);
  });

  it("does not move focus on the first render", async () => {
    const previous = document.createElement("button");
    document.body.appendChild(previous);
    previous.focus();

    render(<Harness kind="projects" />);
    await flushFrame();

    expect(document.activeElement).toBe(previous);
    previous.remove();
  });
});
