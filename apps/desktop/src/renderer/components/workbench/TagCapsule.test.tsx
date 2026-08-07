import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TagCapsule } from "./TagCapsule";
import type { TagView } from "./segmentTypes";

afterEach(() => cleanup());

const tag: TagView = {
  id: "t1",
  displayText: "1",
  kind: "start",
  position: 3,
  pairKey: "pair-a",
  issue: "none",
};

describe("TagCapsule", () => {
  it("highlights pair on hover and reports selection", () => {
    const onHoverPair = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <TagCapsule
        tag={tag}
        side="target"
        label="Tag 1"
        onHoverPair={onHoverPair}
        onSelect={onSelect}
      />,
    );
    const button = container.querySelector("button")!;
    fireEvent.mouseEnter(button);
    expect(onHoverPair).toHaveBeenCalledWith("pair-a");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("moves with Alt+Arrow when selected target", () => {
    const onMove = vi.fn();
    const { container } = render(
      <TagCapsule
        tag={tag}
        side="target"
        selected
        label="Tag move"
        onMove={onMove}
      />,
    );
    const button = container.querySelector("button")!;
    fireEvent.keyDown(button, {
      key: "ArrowRight",
      altKey: true,
      isComposing: false,
      keyCode: 39,
    });
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it("suppresses move when disabled/signed", () => {
    const onMove = vi.fn();
    const { container } = render(
      <TagCapsule
        tag={tag}
        side="target"
        disabled
        label="Tag disabled"
        onMove={onMove}
      />,
    );
    fireEvent.keyDown(container.querySelector("button")!, {
      key: "ArrowLeft",
      altKey: true,
      isComposing: false,
      keyCode: 37,
    });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("marks missing and order issues", () => {
    const { container, rerender } = render(
      <TagCapsule
        tag={{ ...tag, issue: "missing" }}
        side="source"
        label="Tag missing"
        missingLabel="Missing"
      />,
    );
    expect(container.querySelector("button")?.getAttribute("data-issue")).toBe(
      "missing",
    );
    rerender(
      <TagCapsule
        tag={{ ...tag, issue: "order" }}
        side="target"
        label="Tag order"
        orderLabel="Order"
      />,
    );
    expect(container.querySelector("button")?.getAttribute("data-issue")).toBe(
      "order",
    );
    expect(screen.getByRole("button", { name: /Tag order/i })).toBeTruthy();
  });
});
