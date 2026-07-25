import { createRef } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFocusTrap } from "./useFocusTrap";

afterEach(() => {
  cleanup();
});

function TrapHost({
  active = true,
  onEscape,
}: {
  active?: boolean;
  onEscape?: () => void;
}) {
  const ref = createRef<HTMLDivElement>();
  useFocusTrap(ref, { active, ...(onEscape ? { onEscape } : {}) });
  return (
    <div ref={ref} role="dialog">
      <button type="button">First</button>
      <button type="button">Second</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("moves initial focus into the trap and restores on unmount", () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const view = render(<TrapHost />);
    expect(document.activeElement?.textContent).toBe("First");

    view.unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("invokes onEscape when Escape is pressed", () => {
    const onEscape = vi.fn();
    render(<TrapHost onEscape={onEscape} />);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("cycles Tab within the trap", () => {
    render(<TrapHost />);
    const first = document.activeElement as HTMLElement;
    expect(first.textContent).toBe("First");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement?.textContent).toBe("Second");
  });
});
