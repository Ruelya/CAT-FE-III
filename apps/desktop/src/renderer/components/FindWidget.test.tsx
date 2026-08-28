import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FindWidget } from "./FindWidget.js";
import type { FindWidgetProps } from "./FindWidget.js";

function renderWidget(overrides: Partial<FindWidgetProps> = {}) {
  const props: FindWidgetProps = {
    open: true,
    mode: "find",
    query: "",
    replaceWith: "",
    includeConfirmed: false,
    matchCount: 0,
    busy: false,
    onQueryChange: vi.fn(),
    onReplaceWithChange: vi.fn(),
    onIncludeConfirmedChange: vi.fn(),
    onModeChange: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrev: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const { rerender } = render(<FindWidget {...props} />);
  return { props, rerender };
}

describe("FindWidget", () => {
  it("renders nothing while closed", () => {
    renderWidget({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("focuses the find input on open and the replace input in replace mode", () => {
    const { props, rerender } = renderWidget();
    expect(document.activeElement).toBe(
      screen.getByLabelText("查找", { selector: "input" }),
    );
    rerender(<FindWidget {...props} mode="replace" />);
    expect(document.activeElement).toBe(screen.getByLabelText("替换为"));
  });

  it("Enter finds next, Shift+Enter finds previous", async () => {
    const { props } = renderWidget({ query: "day" });
    const input = screen.getByLabelText("查找", { selector: "input" });
    await userEvent.type(input, "{Enter}");
    expect(props.onFindNext).toHaveBeenCalledTimes(1);
    await userEvent.type(input, "{Shift>}{Enter}{/Shift}");
    expect(props.onFindPrev).toHaveBeenCalledTimes(1);
  });

  it("Enter in the replace box runs one replace", async () => {
    const { props } = renderWidget({ mode: "replace", query: "day" });
    await userEvent.type(screen.getByLabelText("替换为"), "{Enter}");
    expect(props.onReplace).toHaveBeenCalledTimes(1);
    expect(props.onFindNext).not.toHaveBeenCalled();
  });

  it("disables navigation and replace actions without a query", () => {
    renderWidget({ mode: "replace", query: "  " });
    expect(screen.getByRole("button", { name: "查找上一个" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查找下一个" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "替换" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "全部替换" })).toBeDisabled();
  });

  it("shows the matching-segment count only with a query", () => {
    const { props, rerender } = renderWidget({ query: "", matchCount: 0 });
    expect(screen.getByLabelText("匹配句段数")).toHaveTextContent("");
    rerender(<FindWidget {...props} query="day" matchCount={3} />);
    expect(screen.getByLabelText("匹配句段数")).toHaveTextContent("3 段");
  });

  it("the toggle chevron flips between find and replace modes", async () => {
    const { props, rerender } = renderWidget();
    await userEvent.click(screen.getByRole("button", { name: "展开替换" }));
    expect(props.onModeChange).toHaveBeenCalledWith("replace");
    rerender(<FindWidget {...props} mode="replace" />);
    await userEvent.click(screen.getByRole("button", { name: "收起替换" }));
    expect(props.onModeChange).toHaveBeenCalledWith("find");
  });

  it("Esc and the × button close the widget", async () => {
    const { props } = renderWidget({ query: "day" });
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "关闭查找" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
