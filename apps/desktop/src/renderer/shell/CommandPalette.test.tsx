import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette";
import type { PaletteCommand } from "./command-palette-model";

afterEach(cleanup);

function build(
  overrides: Partial<Record<string, () => void>> = {},
): PaletteCommand[] {
  return [
    {
      id: "go.home",
      label: "Go to Projects",
      group: "Navigate",
      run: overrides["go.home"] ?? (() => undefined),
    },
    {
      id: "go.export",
      label: "Open Export",
      group: "Navigate",
      keywords: "docx",
      run: overrides["go.export"] ?? (() => undefined),
    },
    {
      id: "editor.find",
      label: "Find",
      group: "Editor",
      hint: "Ctrl+F",
      run: overrides["editor.find"] ?? (() => undefined),
    },
  ];
}

describe("CommandPalette", () => {
  it("focuses the input and selects the first option", () => {
    render(<CommandPalette commands={build()} onClose={() => undefined} />);
    const input = screen.getByTestId("command-palette-input");
    expect(input).toHaveFocus();
    expect(
      screen.getByRole("option", { name: /Go to Projects/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("moves the active option with Arrow, Home, and End without losing input focus", async () => {
    const user = userEvent.setup();
    render(<CommandPalette commands={build()} onClose={() => undefined} />);
    const input = screen.getByTestId("command-palette-input");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Open Export/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(input).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("option", { name: /Find/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{Home}");
    expect(
      screen.getByRole("option", { name: /Go to Projects/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("wraps the selection at both ends", async () => {
    const user = userEvent.setup();
    render(<CommandPalette commands={build()} onClose={() => undefined} />);
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: /Find/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("publishes the active option through aria-activedescendant", async () => {
    const user = userEvent.setup();
    render(<CommandPalette commands={build()} onClose={() => undefined} />);
    const input = screen.getByTestId("command-palette-input");
    const first = input.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).not.toBe(first);
  });

  it("filters on keywords and runs the match with Enter", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        commands={build({ "go.export": run })}
        onClose={onClose}
      />,
    );
    await user.type(screen.getByTestId("command-palette-input"), "docx");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports an empty result instead of rendering an empty list", async () => {
    const user = userEvent.setup();
    render(<CommandPalette commands={build()} onClose={() => undefined} />);
    await user.type(screen.getByTestId("command-palette-input"), "zzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("No command matches");
  });

  it("closes on Escape and restores the opener", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <CommandPalette commands={build()} onClose={onClose} />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps Tab inside the palette", async () => {
    const user = userEvent.setup();
    render(<CommandPalette commands={build()} onClose={() => undefined} />);
    const input = screen.getByTestId("command-palette-input");
    await user.tab();
    expect(input).toHaveFocus();
  });
});
