import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette.js";
import type { PaletteEntry } from "./CommandPalette.js";

function entry(
  overrides: Partial<PaletteEntry> & { id: string },
): PaletteEntry {
  return {
    label: overrides.id,
    enabled: true,
    run: vi.fn(),
    ...overrides,
  };
}

/** Fresh entries per test so run() call counts never leak across tests. */
function catalog(): PaletteEntry[] {
  return [
    entry({ id: "import", label: "导入文档…", shortcut: "Ctrl+O" }),
    entry({ id: "export", label: "导出译文…", shortcut: "Ctrl+E" }),
    entry({ id: "qa", label: "QA 面板", shortcut: "Ctrl+4" }),
  ];
}

describe("CommandPalette", () => {
  it("renders nothing while closed", () => {
    render(
      <CommandPalette open={false} entries={catalog()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every entry with its shortcut", () => {
    render(<CommandPalette open entries={catalog()} onClose={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: "命令面板" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("导入文档…")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+4")).toBeInTheDocument();
  });

  it("filters by substring and reports an honest empty result", async () => {
    render(<CommandPalette open entries={catalog()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("搜索命令"), "导出");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("导出译文…");

    await userEvent.clear(screen.getByLabelText("搜索命令"));
    await userEvent.type(screen.getByLabelText("搜索命令"), "不存在的命令");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("没有匹配的命令")).toBeInTheDocument();
  });

  it("executes the armed entry on Enter and closes", async () => {
    const onClose = vi.fn();
    const entries = catalog();
    render(<CommandPalette open entries={entries} onClose={onClose} />);
    await userEvent.type(
      screen.getByLabelText("搜索命令"),
      "{ArrowDown}{Enter}",
    );
    expect(entries[1]!.run).toHaveBeenCalledTimes(1);
    expect(entries[0]!.run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("executes an entry on click", async () => {
    const onClose = vi.fn();
    const entries = catalog();
    render(<CommandPalette open entries={entries} onClose={onClose} />);
    await userEvent.click(screen.getByText("QA 面板"));
    expect(entries[2]!.run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never executes a disabled entry", async () => {
    const onClose = vi.fn();
    const run = vi.fn();
    const entries = [
      entry({ id: "off", label: "禁用命令", enabled: false, run }),
    ];
    render(<CommandPalette open entries={entries} onClose={onClose} />);
    await userEvent.click(screen.getByText("禁用命令"));
    expect(run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("搜索命令"), "{Enter}");
    expect(run).not.toHaveBeenCalled();
  });

  it("closes on Escape without executing anything", async () => {
    const onClose = vi.fn();
    const entries = catalog();
    render(<CommandPalette open entries={entries} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("搜索命令"), "{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    for (const item of entries) {
      expect(item.run).not.toHaveBeenCalled();
    }
  });
});
