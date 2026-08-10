import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

function Host({ onCancelSpy }: { onCancelSpy: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? (
        <ConfirmDialog
          title="Confirm"
          body="Body"
          confirmLabel="Confirm"
          onConfirm={() => setOpen(false)}
          onCancel={() => {
            onCancelSpy();
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

describe("ConfirmDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("focuses Cancel on open and restores the trigger on close", async () => {
    const user = userEvent.setup();
    const onCancelSpy = vi.fn();
    render(<Host onCancelSpy={onCancelSpy} />);
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onCancelSpy).toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("ignores Escape while pending", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Confirm"
        body="Body"
        confirmLabel="Confirm"
        pending
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );
    // Disabled Cancel cannot retain focus; Escape still must not cancel.
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Working" })).toBeDisabled();
  });
});
