import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastStack } from "./ToastStack";

afterEach(cleanup);

describe("ToastStack", () => {
  it("anchors messages as overlays instead of a document-flow banner", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ToastStack
        toasts={[
          {
            id: "batch",
            tone: "success",
            children: "Import 1 succeeded, 0 failed",
          },
        ]}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId("toast-stack")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("batch");
  });
});
