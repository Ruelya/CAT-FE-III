import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { JobWizardSteps } from "./JobWizardSteps";

afterEach(cleanup);

describe("JobWizardSteps", () => {
  it("marks the current step and leaves later steps upcoming", () => {
    render(<JobWizardSteps current="files" />);
    expect(screen.getByTestId("job-wizard-step-files")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByTestId("job-wizard-step-general")).toHaveAttribute(
      "data-state",
      "done",
    );
    expect(screen.getByTestId("job-wizard-step-memory")).toHaveAttribute(
      "data-state",
      "upcoming",
    );
    expect(screen.getByTestId("job-wizard-step-prepare")).toHaveAttribute(
      "data-state",
      "upcoming",
    );
  });
});
