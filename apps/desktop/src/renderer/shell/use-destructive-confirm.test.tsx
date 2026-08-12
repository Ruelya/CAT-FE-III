import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDestructiveConfirm } from "./use-destructive-confirm";

afterEach(cleanup);

function Harness({ run }: { run: () => Promise<boolean> | boolean }) {
  const destructive = useDestructiveConfirm();
  return (
    <div>
      <button
        type="button"
        data-testid="trigger"
        onClick={() =>
          destructive.request({
            title: "Delete profile",
            body: "Aurora will be deleted.",
            confirmLabel: "Delete",
            testId: "delete-confirm",
            run,
          })
        }
      >
        Open
      </button>
      {destructive.dialog}
    </div>
  );
}

describe("useDestructiveConfirm", () => {
  it("does not run the action until it is confirmed", async () => {
    const user = userEvent.setup();
    const run = vi.fn(() => true);
    render(<Harness run={run} />);

    await user.click(screen.getByTestId("trigger"));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId("delete-confirm")).toBeInTheDocument();
  });

  it("focuses Cancel first, because it is the safe action", async () => {
    const user = userEvent.setup();
    render(<Harness run={() => true} />);
    await user.click(screen.getByTestId("trigger"));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("cancels without running and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const run = vi.fn(() => true);
    render(<Harness run={run} />);
    const trigger = screen.getByTestId("trigger");

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByTestId("delete-confirm")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("treats Escape as non-destructive", async () => {
    const user = userEvent.setup();
    const run = vi.fn(() => true);
    render(<Harness run={run} />);
    await user.click(screen.getByTestId("trigger"));
    await user.keyboard("{Escape}");
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByTestId("delete-confirm")).not.toBeInTheDocument();
  });

  it("runs and closes on confirm", async () => {
    const user = userEvent.setup();
    const run = vi.fn(() => Promise.resolve(true));
    render(<Harness run={run} />);
    await user.click(screen.getByTestId("trigger"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByTestId("delete-confirm")).not.toBeInTheDocument(),
    );
  });

  it("stays open and reports the failure when the action returns false", async () => {
    const user = userEvent.setup();
    render(<Harness run={() => Promise.resolve(false)} />);
    await user.click(screen.getByTestId("trigger"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.getByTestId("delete-confirm")).toHaveTextContent(
        "Action failed.",
      ),
    );
  });

  it("stays open when the action rejects", async () => {
    const user = userEvent.setup();
    render(<Harness run={() => Promise.reject(new Error("boom"))} />);
    await user.click(screen.getByTestId("trigger"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.getByTestId("delete-confirm")).toHaveTextContent(
        "Action failed.",
      ),
    );
  });
});
