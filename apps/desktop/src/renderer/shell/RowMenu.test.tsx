import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowMenu } from "./RowMenu";

afterEach(cleanup);

function setup(overrides?: { onEdit?: () => void; disabledArchive?: boolean }) {
  return render(
    <RowMenu
      label="More actions for Aurora"
      testId="row-menu"
      items={[
        {
          id: "edit",
          label: "Edit",
          onSelect: overrides?.onEdit ?? (() => undefined),
        },
        {
          id: "archive",
          label: "Archive",
          disabled: overrides?.disabledArchive ?? false,
          onSelect: () => undefined,
        },
        {
          id: "recycle",
          label: "Recycle",
          danger: true,
          onSelect: () => undefined,
        },
      ]}
    />,
  );
}

describe("RowMenu keyboard contract", () => {
  it("names the trigger with the row identity and reports collapsed state", () => {
    setup();
    const trigger = screen.getByTestId("row-menu");
    expect(trigger).toHaveAccessibleName("More actions for Aurora");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("title", "More actions for Aurora");
  });

  it("opens on ArrowDown and focuses the first item", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByTestId("row-menu").focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    expect(screen.getByTestId("row-menu")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("opens on ArrowUp and focuses the last item", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByTestId("row-menu").focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Recycle" })).toHaveFocus();
  });

  it("wraps with Arrow keys and jumps with Home and End", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("row-menu"));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Recycle" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Recycle" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  it("jumps to the next item matching a typed initial", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("row-menu"));
    await user.keyboard("r");
    expect(screen.getByRole("menuitem", { name: "Recycle" })).toHaveFocus();
  });

  it("skips a disabled item when navigating", async () => {
    const user = userEvent.setup();
    setup({ disabledArchive: true });
    await user.click(screen.getByTestId("row-menu"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Recycle" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByTestId("row-menu");
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("runs the item, closes, and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    setup({ onEdit });
    const trigger = screen.getByTestId("row-menu");
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when the pointer goes outside", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("row-menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("disables the trigger when no item is enabled", () => {
    render(
      <RowMenu
        label="More actions for Empty"
        testId="empty-menu"
        items={[
          {
            id: "only",
            label: "Only",
            disabled: true,
            onSelect: () => undefined,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("empty-menu")).toBeDisabled();
  });
});
