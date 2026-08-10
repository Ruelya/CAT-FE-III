import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WindowControls } from "./WindowControls";

afterEach(() => {
  cleanup();
});

describe("WindowControls", () => {
  it("renders named custom controls on the custom-control platform branch", () => {
    render(
      <WindowControls
        platform="custom"
        maximized={false}
        onMinimize={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Minimize" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Maximize" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("omits custom controls on macOS native-traffic-light branch", () => {
    const { container } = render(
      <WindowControls
        platform="macos"
        maximized={false}
        onMinimize={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("window-controls")).toBeNull();
  });

  it("exposes Restore label and state when maximized", () => {
    render(
      <WindowControls
        platform="custom"
        maximized
        onMinimize={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maximize" })).toBeNull();
    expect(screen.getByTestId("window-controls")).toHaveAttribute(
      "data-maximized",
      "true",
    );
  });

  it("fires callbacks from pointer activation", async () => {
    const user = userEvent.setup();
    const onMinimize = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();
    render(
      <WindowControls
        platform="custom"
        maximized={false}
        onMinimize={onMinimize}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires callbacks from keyboard activation", async () => {
    const user = userEvent.setup();
    const onMinimize = vi.fn();
    render(
      <WindowControls
        platform="custom"
        maximized={false}
        onMinimize={onMinimize}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const minimize = screen.getByRole("button", { name: "Minimize" });
    minimize.focus();
    await user.keyboard("{Enter}");
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it("keeps controls enabled (no disabled attr) for OS chrome availability", () => {
    render(
      <WindowControls
        platform="custom"
        maximized={false}
        onMinimize={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    for (const name of ["Minimize", "Maximize", "Close"]) {
      expect(screen.getByRole("button", { name })).not.toBeDisabled();
    }
  });
});
