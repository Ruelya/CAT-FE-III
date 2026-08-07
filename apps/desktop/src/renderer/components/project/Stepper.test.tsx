import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Stepper } from "./Stepper";

afterEach(() => {
  cleanup();
});

describe("Stepper", () => {
  const steps = [
    { id: "project", label: "Project" },
    { id: "configuration", label: "Configuration" },
    { id: "files", label: "Files" },
  ];

  it("renders mono two-digit indices and labels", () => {
    const { container } = render(
      <Stepper steps={steps} current={0} ariaLabel="Setup steps" />,
    );
    const root = within(container);
    expect(root.getByText("01")).toBeTruthy();
    expect(root.getByText("02")).toBeTruthy();
    expect(root.getByText("03")).toBeTruthy();
    expect(root.getByText("Configuration")).toBeTruthy();
    expect(root.getByRole("list", { name: "Setup steps" })).toBeTruthy();
  });

  it("marks current step and allows select on completed", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(
      <Stepper
        steps={steps}
        current={1}
        onSelect={onSelect}
        ariaLabel="Setup steps"
      />,
    );
    const root = within(container);
    const current = root.getByRole("button", { name: /Configuration/i });
    expect(current.closest("li")?.getAttribute("data-status")).toBe("current");
    await user.click(root.getByRole("button", { name: /Project/i }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});
