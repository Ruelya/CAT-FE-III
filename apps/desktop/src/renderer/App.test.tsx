import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopApi,
  EngineStatusPayload,
  MenuCommand,
} from "../shared/desktop-api.js";

import packageJson from "../../package.json";

import { App } from "./App.js";

interface Bridge {
  relaunchEngine: ReturnType<typeof vi.fn>;
  setMenuContext: ReturnType<typeof vi.fn>;
  emitStatus: (status: EngineStatusPayload) => void;
  emitMenuCommand: (command: MenuCommand) => void;
}

function installBridge(initial: EngineStatusPayload): Bridge {
  let listener: ((status: EngineStatusPayload) => void) | null = null;
  let menuListener: ((command: MenuCommand) => void) | null = null;
  const relaunchEngine = vi.fn().mockResolvedValue({
    state: "starting",
    restarts: 0,
  } satisfies EngineStatusPayload);
  const setMenuContext = vi.fn();
  const api: Partial<DesktopApi> = {
    engineStatus: vi.fn().mockResolvedValue(initial),
    onEngineStatus: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    relaunchEngine,
    // ProjectsView mounts underneath the gate and lists projects.
    invoke: vi.fn().mockResolvedValue({ ok: true, result: { projects: [] } }),
    // App is the single writer of the menu context and subscribes to menu
    // commands.
    setMenuContext,
    onMenuCommand: (next) => {
      menuListener = next;
      return () => {
        menuListener = null;
      };
    },
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return {
    relaunchEngine,
    setMenuContext,
    emitStatus: (status) => {
      act(() => listener?.(status));
    },
    emitMenuCommand: (command) => {
      act(() => menuListener?.(command));
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "tl");
});

function mainSurface(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".app-main");
  if (!element) {
    throw new Error(".app-main not rendered");
  }
  return element;
}

describe("App engine gate", () => {
  it("blocks the surface honestly while the engine is starting, then unlocks on ready", async () => {
    const bridge = installBridge({ state: "starting", restarts: 0 });
    render(<App />);

    const gate = await screen.findByRole("alertdialog");
    expect(gate).toHaveTextContent("正在启动翻译引擎");
    expect(mainSurface()).toHaveAttribute("inert");
    // Starting is not a failure: no relaunch offer yet.
    expect(
      screen.queryByRole("button", { name: "重新启动引擎" }),
    ).not.toBeInTheDocument();

    bridge.emitStatus({
      state: "ready",
      restarts: 0,
      pid: 41,
      engineVersion: "0.1.0",
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(mainSurface()).not.toHaveAttribute("inert");
  });

  it("surfaces a mid-session crash as a blocking restart state, not a silent toast", async () => {
    const bridge = installBridge({
      state: "ready",
      restarts: 0,
      pid: 41,
      engineVersion: "0.1.0",
    });
    render(<App />);
    await waitFor(() => {
      expect(mainSurface()).not.toHaveAttribute("inert");
    });

    bridge.emitStatus({
      state: "restarting",
      restarts: 1,
      lastError: "engine exited (code 101, signal none)",
    });
    const gate = await screen.findByRole("alertdialog");
    expect(gate).toHaveTextContent("翻译引擎正在自动重启");
    expect(gate).toHaveTextContent("第 1 次重试");
    expect(gate).toHaveTextContent("engine exited (code 101, signal none)");
    expect(mainSurface()).toHaveAttribute("inert");
  });

  it("offers relaunch when the engine is down and unlocks once it recovers", async () => {
    const bridge = installBridge({
      state: "down",
      restarts: 5,
      lastError: "engine exited (code 1, signal none)",
    });
    render(<App />);

    const gate = await screen.findByRole("alertdialog");
    expect(gate).toHaveTextContent("翻译引擎已停止");
    expect(gate).toHaveTextContent("engine exited (code 1, signal none)");
    expect(mainSurface()).toHaveAttribute("inert");

    await userEvent.click(screen.getByRole("button", { name: "重新启动引擎" }));
    expect(bridge.relaunchEngine).toHaveBeenCalledTimes(1);
    // The relaunch resolves with "starting": still blocked, still honest.
    const startingGate = await screen.findByRole("alertdialog");
    expect(startingGate).toHaveTextContent("正在启动翻译引擎");

    bridge.emitStatus({
      state: "ready",
      restarts: 0,
      pid: 42,
      engineVersion: "0.1.0",
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(mainSurface()).not.toHaveAttribute("inert");
  });
});

describe("App shell menu commands", () => {
  const READY: EngineStatusPayload = {
    state: "ready",
    restarts: 0,
    pid: 41,
    engineVersion: "0.1.0",
  };

  it("opens the 键盘快捷键 dialog with real chords, and 关于 with the package version", async () => {
    const bridge = installBridge(READY);
    render(<App />);
    await waitFor(() => {
      expect(mainSurface()).not.toHaveAttribute("inert");
    });

    bridge.emitMenuCommand("help-keys");
    const keys = screen.getByRole("dialog", { name: "键盘快捷键" });
    // Rows are real product chords, straight from the inventory.
    expect(keys).toHaveTextContent("确认当前句段");
    expect(keys).toHaveTextContent("Ctrl+Enter");
    expect(keys).toHaveTextContent("命令面板");
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(
      screen.queryByRole("dialog", { name: "键盘快捷键" }),
    ).not.toBeInTheDocument();

    bridge.emitMenuCommand("about");
    const about = screen.getByRole("dialog", { name: "关于" });
    // The version is the packaged one — never a hardcoded string.
    expect(about).toHaveTextContent(`Translunar CAT ${packageJson.version}`);
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(
      screen.queryByRole("dialog", { name: "关于" }),
    ).not.toBeInTheDocument();
  });

  it("new-project lands the keyboard in the list's create form", async () => {
    const bridge = installBridge(READY);
    render(<App />);
    await waitFor(() => {
      expect(mainSurface()).not.toHaveAttribute("inert");
    });
    const name = screen.getByLabelText("项目名称");
    expect(document.activeElement).not.toBe(name);
    bridge.emitMenuCommand("new-project");
    expect(document.activeElement).toBe(name);
  });

  it("reports exportGate in the menu context alongside the open states", async () => {
    const bridge = installBridge(READY);
    render(<App />);
    await waitFor(() => {
      expect(bridge.setMenuContext).toHaveBeenCalledWith({
        projectOpen: false,
        documentOpen: false,
        exportGate: false,
      });
    });
  });
});
