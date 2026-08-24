import { afterEach, describe, expect, it, vi } from "vitest";

import { toggleDockFocus } from "./dock-focus";

function mountWorkbenchDom(options?: { withTermList?: boolean }) {
  document.body.innerHTML = `
    <div>
      <div
        data-testid="target-surface-seg-1"
        tabindex="0"
        role="textbox"
      ></div>
      <section data-testid="intel-dock">
        <button type="button" id="dock-chip">Matches</button>
        ${
          options?.withTermList === false
            ? ""
            : '<ul data-testid="term-list" tabindex="0"></ul>'
        }
      </section>
    </div>
  `;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("toggleDockFocus", () => {
  it("moves focus from the editor into the term list", () => {
    mountWorkbenchDom();
    const surface = document.querySelector<HTMLElement>(
      '[data-testid="target-surface-seg-1"]',
    );
    surface?.focus();

    const move = toggleDockFocus({
      activeSegmentId: "seg-1",
      collapsed: false,
      expand: () => undefined,
    });

    expect(move).toBe("dock");
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="term-list"]'),
    );
  });

  it("falls back to the first enabled dock control without a term list", () => {
    mountWorkbenchDom({ withTermList: false });

    const move = toggleDockFocus({
      activeSegmentId: "seg-1",
      collapsed: false,
      expand: () => undefined,
    });

    expect(move).toBe("dock");
    expect(document.activeElement).toBe(document.getElementById("dock-chip"));
  });

  it("returns focus to the active target editor from inside the dock", () => {
    mountWorkbenchDom();
    document.getElementById("dock-chip")?.focus();

    const move = toggleDockFocus({
      activeSegmentId: "seg-1",
      collapsed: false,
      expand: () => undefined,
    });

    expect(move).toBe("editor");
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="target-surface-seg-1"]'),
    );
  });

  it("expands a collapsed dock instead of focusing into inert content", () => {
    mountWorkbenchDom();
    const expand = vi.fn();

    const move = toggleDockFocus({
      activeSegmentId: "seg-1",
      collapsed: true,
      expand,
    });

    expect(move).toBe("expanded");
    expect(expand).toHaveBeenCalledTimes(1);
  });
});
