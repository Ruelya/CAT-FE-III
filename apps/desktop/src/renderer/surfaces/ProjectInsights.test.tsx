import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { ProjectInsights } from "./ProjectInsights";

afterEach(cleanup);

describe("ProjectInsights analysis", () => {
  let engine: FakeEngineState;

  beforeEach(() => {
    engine = createFakeEngineState();
    window.translunar = createFakeDesktopApi(engine);
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete window.translunar;
  });

  it("does not run analysis until Analyze files is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ProjectInsights
        projectId="proj-1"
        projectName="Insights"
        analytics={null}
        documents={[]}
        loading={false}
        error={null}
        onBack={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByTestId("insights-analyze")).toBeInTheDocument();
    expect(engine.calls.some((c) => String(c.method).startsWith("analysis."))).toBe(
      false,
    );

    await user.click(screen.getByTestId("insights-analyze"));
    await waitFor(() => {
      expect(screen.getByTestId("insights-analysis")).toBeInTheDocument();
    });
    expect(engine.calls.some((c) => c.method === "analysis.run")).toBe(true);
    expect(screen.getByTestId("insights-analysis")).toHaveTextContent(
      "Source words",
    );
    expect(screen.getByTestId("insights-analysis")).toHaveTextContent("100");
  });
});
