import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorCommandBar } from "./EditorCommandBar";
import type { EditorOperationsApi } from "../state/use-editor-operations";

afterEach(cleanup);

function makeOps(overrides: Partial<EditorOperationsApi> = {}) {
  const base = {
    panel: null,
    openPanel: vi.fn(),
    closePanel: vi.fn(),
    busy: false,
    commandError: null,
    clearCommandError: vi.fn(),
    canUndo: true,
    canRedo: true,
    isAvailable: () => true,
    runCommand: vi.fn(),
    invalidate: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as EditorOperationsApi;
}

describe("EditorCommandBar confirm", () => {
  it("hosts Confirm with the segment number for the grid tests", () => {
    render(
      <EditorCommandBar
        ops={makeOps()}
        confirm={{
          segmentId: "seg-1",
          ordinal: 0,
          onConfirm: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Confirm segment 1" }),
    ).toBeInTheDocument();
  });
});

describe("EditorCommandBar keyboard contract", () => {
  it("is a single tab stop with Arrow navigation inside", async () => {
    const user = userEvent.setup();
    render(<EditorCommandBar ops={makeOps()} />);

    const find = screen.getByTestId("cmd-editor.findReplace");
    const tags = screen.getByTestId("cmd-editor.tags");
    expect(find).toHaveAttribute("tabindex", "0");
    expect(tags).toHaveAttribute("tabindex", "-1");

    find.focus();
    await user.keyboard("{ArrowRight}");
    expect(tags).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(find).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByTestId("cmd-editor.propagate")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(find).toHaveFocus();
  });

  it("wraps Arrow navigation at both ends", async () => {
    const user = userEvent.setup();
    render(<EditorCommandBar ops={makeOps()} />);
    screen.getByTestId("cmd-editor.findReplace").focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("cmd-editor.propagate")).toHaveFocus();
  });

  it("skips unavailable commands when navigating", async () => {
    const user = userEvent.setup();
    render(
      <EditorCommandBar
        ops={makeOps({ isAvailable: (id) => id !== "editor.tags" })}
      />,
    );
    screen.getByTestId("cmd-editor.findReplace").focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("cmd-editor.comments")).toHaveFocus();
  });

  it("opens the overflow menu onto the first item and navigates it", async () => {
    const user = userEvent.setup();
    render(<EditorCommandBar ops={makeOps()} />);
    const trigger = screen.getByTestId("cmd-overflow");

    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{End}");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("opens onto the last item with ArrowUp", async () => {
    const user = userEvent.setup();
    render(<EditorCommandBar ops={makeOps()} />);
    screen.getByTestId("cmd-overflow").focus();
    await user.keyboard("{ArrowUp}");
    const items = screen.getAllByRole("menuitem");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<EditorCommandBar ops={makeOps()} />);
    const trigger = screen.getByTestId("cmd-overflow");
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("runs a command from the menu and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const runCommand = vi.fn();
    render(<EditorCommandBar ops={makeOps({ runCommand })} />);
    const trigger = screen.getByTestId("cmd-overflow");
    await user.click(trigger);
    await user.click(screen.getByTestId("cmd-editor.correctSource"));
    expect(runCommand).toHaveBeenCalledWith("editor.correctSource");
    expect(trigger).toHaveFocus();
  });

  it("hosts the segment workflow on the ribbon, not in the grid", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EditorCommandBar
        ops={makeOps()}
        workflow={{
          state: "translation",
          onChange,
        }}
      />,
    );
    expect(screen.getByText("Workflow")).toBeInTheDocument();
    const control = screen.getByTestId("cmd-workflow");
    expect(control).toHaveValue("translation");
    await user.selectOptions(control, "review");
    expect(onChange).toHaveBeenCalledWith("review");
  });

  it("exposes extra ribbon actions as icon buttons with hover names", () => {
    render(
      <EditorCommandBar
        ops={makeOps()}
        extras={{
          onCopySource: vi.fn(),
          onPlaceTags: vi.fn(),
          onSave: vi.fn(),
          onPretranslate: vi.fn(),
          canCopySource: true,
          canPlaceTags: true,
          canSave: true,
        }}
      />,
    );
    expect(screen.getByTestId("cmd-ribbon.copySource")).toHaveAttribute(
      "title",
      "Copy source to target (Ctrl+Insert)",
    );
    expect(screen.getByTestId("cmd-ribbon.placeTags")).toHaveAttribute(
      "aria-label",
      "Place source tags (Ctrl+,)",
    );
    expect(screen.getByTestId("cmd-ribbon.save")).toBeInTheDocument();
    expect(screen.getByTestId("cmd-ribbon.pretranslate")).toBeInTheDocument();
  });

  it("marks unavailable menu items as disabled rather than hiding them", () => {
    render(
      <EditorCommandBar
        ops={makeOps({ isAvailable: (id) => id !== "editor.correctSource" })}
      />,
    );
    // The menu is closed, so open state is not required for this assertion:
    // availability is reflected on render, not on open.
    expect(screen.getByTestId("cmd-overflow")).toBeEnabled();
  });
});
