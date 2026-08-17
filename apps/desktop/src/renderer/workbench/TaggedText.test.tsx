import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaggedText } from "./TaggedText";

afterEach(cleanup);

describe("TaggedText term marks", () => {
  it("underlines a recognised term without hiding a QuickPlace mark on the same run", () => {
    render(
      <TaggedText
        text="The power station is offline."
        tags={[]}
        highlight={{ start: 4, end: 9 }}
        highlights={[
          {
            start: 4,
            end: 17,
            className: "term-source-hit",
            testId: "term-source-hit",
            title: "power station → 电源站",
          },
        ]}
      />,
    );
    expect(
      screen.getAllByTestId("term-source-hit").map((node) => node.textContent).join(""),
    ).toBe("power station");
    expect(screen.getByTestId("qp-source-hit")).toHaveTextContent("power");
  });

  it("inserts the preferred translation when the underline is clicked", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(
      <TaggedText
        text="The power station is offline."
        tags={[]}
        highlights={[
          {
            start: 4,
            end: 17,
            className: "term-source-hit",
            testId: "term-source-hit",
            onClick: onInsert,
          },
        ]}
      />,
    );
    await user.click(screen.getAllByTestId("term-source-hit")[0]!);
    expect(onInsert).toHaveBeenCalledTimes(1);
  });
});
