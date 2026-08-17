import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TitleFileMenu, type TitleFileMenuItem } from "./TitleFileMenu";

afterEach(cleanup);

function items(
  overrides: Partial<TitleFileMenuItem>[] = [],
): TitleFileMenuItem[] {
  const base: TitleFileMenuItem[] = [
    {
      id: "add",
      label: "Add files",
      group: "job",
      onSelect: vi.fn(),
      testId: "title-file-add-files",
    },
    {
      id: "recycle",
      label: "Recycle document",
      group: "job",
      onSelect: vi.fn(),
      danger: true,
    },
    {
      id: "workflow-translation",
      label: "Translation (Ctrl+Alt+T)",
      group: "segment",
      onSelect: vi.fn(),
      testId: "title-file-workflow-translation",
    },
    {
      id: "assets",
      label: "Assets",
      group: "project",
      onSelect: vi.fn(),
    },
  ];
  return base.map((item, index) => ({ ...item, ...overrides[index] }));
}

describe("TitleFileMenu", () => {
  it("renders nothing when there are no actions", () => {
    const { container } = render(<TitleFileMenu items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens grouped sections and runs an item", async () => {
    const user = userEvent.setup();
    const add = vi.fn();
    render(<TitleFileMenu items={items([{ onSelect: add }])} />);

    await user.click(screen.getByTestId("title-file-menu"));
    const panel = screen.getByTestId("title-file-menu-panel");
    expect(panel).toHaveTextContent("This job");
    expect(panel).toHaveTextContent("Segment");
    expect(panel).toHaveTextContent("Project");
    expect(screen.getByRole("group", { name: "This job" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Segment" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Project" })).toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);

    await user.click(screen.getByTestId("title-file-add-files"));
    expect(add).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("title-file-menu-panel")).toBeNull();
  });

  it("closes on Escape and returns focus to File", async () => {
    const user = userEvent.setup();
    render(<TitleFileMenu items={items()} />);
    const trigger = screen.getByTestId("title-file-menu");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
