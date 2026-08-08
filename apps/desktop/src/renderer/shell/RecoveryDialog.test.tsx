import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecoveryDialog } from "./RecoveryDialog";

describe("RecoveryDialog keyboard contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("focuses Recover first, traps Tab both ways, Escape is non-destructive", async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    const onDiscard = vi.fn();
    const prior = document.createElement("button");
    prior.textContent = "prior";
    document.body.appendChild(prior);
    prior.focus();
    expect(document.activeElement).toBe(prior);

    const { unmount } = render(
      <RecoveryDialog
        mode="recoverable"
        onRecover={onRecover}
        onDiscard={onDiscard}
      />,
    );

    const primary = screen.getByTestId("recovery-primary");
    expect(primary).toHaveFocus();
    expect(primary).toHaveTextContent("Recover");

    await user.tab();
    // Tab from primary wraps to first focusable (Discard) when at end.
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(discard).toHaveFocus();

    await user.tab({ shift: true });
    expect(primary).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onRecover).not.toHaveBeenCalled();
    expect(screen.getByTestId("recovery-dialog")).toBeInTheDocument();

    unmount();
    expect(document.activeElement).toBe(prior);
    prior.remove();
  });

  it("focuses Retry first in stale mode with retry, Escape does not discard", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const onRetry = vi.fn();
    render(
      <RecoveryDialog
        mode="stale"
        reason="stale journal"
        onDiscard={onDiscard}
        onRetry={onRetry}
      />,
    );
    const primary = screen.getByTestId("recovery-primary");
    expect(primary).toHaveFocus();
    expect(primary).toHaveTextContent("Retry");
    await user.keyboard("{Escape}");
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
