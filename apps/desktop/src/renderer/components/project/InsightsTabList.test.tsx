import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InsightsTabList } from "./InsightsTabList";

afterEach(() => {
  cleanup();
});

describe("InsightsTabList", () => {
  const groups = [
    {
      items: [
        { id: "overview" as const, label: "Overview" },
        { id: "files" as const, label: "Files" },
      ],
    },
    {
      label: "Assets",
      items: [{ id: "assets" as const, label: "Curation" }],
    },
  ];

  it("renders group labels and vertical tablist", () => {
    const { container } = render(
      <InsightsTabList
        groups={groups}
        active="overview"
        onChange={() => {}}
        ariaLabel="Insights"
      />,
    );
    const root = within(container);
    expect(root.getByText("Assets")).toBeTruthy();
    expect(root.getByRole("tablist", { name: "Insights" })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    expect(root.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves selection with ArrowDown", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <InsightsTabList
        groups={groups}
        active="overview"
        onChange={onChange}
        ariaLabel="Insights"
      />,
    );
    const list = within(container).getByRole("tablist");
    const selected = within(container).getByRole("tab", { name: "Overview" });
    selected.focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledWith("files");
    expect(list).toBeTruthy();
  });
});
