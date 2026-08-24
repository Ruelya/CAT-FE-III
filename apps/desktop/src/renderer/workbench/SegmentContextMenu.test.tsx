import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentContextMenu } from "./SegmentContextMenu";
import type { ContextMenuEntry } from "./segment-context-menu";

const ITEMS: ContextMenuEntry[] = [
  { id: "copy", label: "Copy", shortcut: "Ctrl+C" },
  { id: "sep", separator: true },
  { id: "confirm", label: "Confirm", shortcut: "Ctrl+Enter" },
];

function Host({ onSelectSpy }: { onSelectSpy?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        data-testid="editor-stand-in"
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        Editor
      </button>
      <input data-testid="elsewhere" />
      {open ? (
        <SegmentContextMenu
          x={20}
          y={20}
          items={ITEMS}
          onSelect={(id) => onSelectSpy?.(id)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

describe("SegmentContextMenu focus handoff", () => {
  afterEach(() => {
    cleanup();
  });

  it("returns focus to where the translator was standing on Escape", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const editor = screen.getByTestId("editor-stand-in");
    editor.focus();
    await user.pointer({ keys: "[MouseRight]", target: editor });
    expect(screen.getByTestId("segment-context-menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("segment-context-menu")).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it("returns focus after running an item", async () => {
    const user = userEvent.setup();
    const onSelectSpy = vi.fn();
    render(<Host onSelectSpy={onSelectSpy} />);
    const editor = screen.getByTestId("editor-stand-in");
    editor.focus();
    await user.pointer({ keys: "[MouseRight]", target: editor });
    await user.click(screen.getByTestId("segment-context-copy"));
    expect(onSelectSpy).toHaveBeenCalledWith("copy");
    expect(editor).toHaveFocus();
  });

  it("does not steal focus from an element the user clicked outside", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const editor = screen.getByTestId("editor-stand-in");
    editor.focus();
    await user.pointer({ keys: "[MouseRight]", target: editor });
    expect(screen.getByTestId("segment-context-menu")).toBeInTheDocument();
    const elsewhere = screen.getByTestId("elsewhere");
    await user.click(elsewhere);
    expect(screen.queryByTestId("segment-context-menu")).not.toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });
});
