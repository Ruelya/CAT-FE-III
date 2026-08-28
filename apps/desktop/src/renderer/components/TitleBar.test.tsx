import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "../../shared/desktop-api.js";

import { TitleBar, cssColorToHex } from "./TitleBar.js";

interface Bridge {
  popupAppMenu: ReturnType<typeof vi.fn>;
  setTitlebarOverlay: ReturnType<typeof vi.fn>;
  resolvePopup: () => void;
}

function installBridge(): Bridge {
  let release: (() => void) | null = null;
  const popupAppMenu = vi.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const setTitlebarOverlay = vi.fn();
  const api: Partial<DesktopApi> = {
    windowChrome: "integrated",
    popupAppMenu,
    setTitlebarOverlay,
    setNativeScheme: vi.fn(),
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return {
    popupAppMenu,
    setTitlebarOverlay,
    resolvePopup: () => release?.(),
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "tl");
});

const MENU_LABELS = ["文件", "编辑", "视图", "项目", "翻译", "QA", "帮助"];

describe("TitleBar", () => {
  it("draws brand, the seven application menus, and the title on one strip", () => {
    installBridge();
    render(<TitleBar title="asd — LICENSE.txt (en-US → zh-CN)" />);

    const menubar = screen.getByRole("menubar", { name: "应用菜单" });
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(MENU_LABELS);
    expect(menubar).toContainElement(items[0]!);
    expect(
      screen.getByText("asd — LICENSE.txt (en-US → zh-CN)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Translunar")).toBeInTheDocument();
  });

  it("clicking a menu pops that menu-template submenu and holds the open state until it closes", async () => {
    const bridge = installBridge();
    render(<TitleBar title="Translunar" />);

    const file = screen.getByRole("menuitem", { name: "文件" });
    await userEvent.click(file);

    expect(bridge.popupAppMenu).toHaveBeenCalledTimes(1);
    const call = bridge.popupAppMenu.mock.calls[0] as unknown[];
    expect(call[0]).toBe("file");
    expect(typeof call[1]).toBe("number");
    expect(typeof call[2]).toBe("number");
    expect(file).toHaveAttribute("data-open");
    expect(file).toHaveAttribute("aria-expanded", "true");

    bridge.resolvePopup();
    await waitFor(() => {
      expect(file).not.toHaveAttribute("data-open");
    });
    expect(file).toHaveAttribute("aria-expanded", "false");
  });

  it("reports the strip's themed colors so the native overlay repaints with it", async () => {
    const bridge = installBridge();
    // jsdom computes no cascade; hand the effect the terra chrome values.
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundColor: "rgb(236, 235, 227)",
      color: "rgb(46, 42, 35)",
    } as CSSStyleDeclaration);
    render(<TitleBar title="Translunar" />);

    await waitFor(() => {
      expect(bridge.setTitlebarOverlay).toHaveBeenCalledWith({
        color: "#ecebe3",
        symbolColor: "#2e2a23",
      });
    });
  });

  it("arrow keys walk the seven menus in menubar fashion", async () => {
    installBridge();
    render(<TitleBar title="Translunar" />);

    const file = screen.getByRole("menuitem", { name: "文件" });
    file.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("menuitem", { name: "编辑" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("menuitem", { name: "帮助" })).toHaveFocus();
  });
});

describe("cssColorToHex", () => {
  it("converts computed rgb()/rgba() and passes hex through", () => {
    expect(cssColorToHex("rgb(236, 235, 227)")).toBe("#ecebe3");
    expect(cssColorToHex("rgba(23, 25, 30, 0.5)")).toBe("#17191e");
    expect(cssColorToHex("#2E2A23")).toBe("#2e2a23");
  });

  it("refuses anything it cannot resolve to a solid color", () => {
    expect(cssColorToHex("")).toBeNull();
    expect(cssColorToHex("transparent")).toBeNull();
    expect(cssColorToHex("color-mix(in srgb, red, blue)")).toBeNull();
  });
});
