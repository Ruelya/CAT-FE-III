import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi, EngineStatusPayload } from "../shared/desktop-api.js";

import { App } from "./App.js";

interface Bridge {
  relaunchEngine: ReturnType<typeof vi.fn>;
  emitStatus: (status: EngineStatusPayload) => void;
}

function installBridge(initial: EngineStatusPayload): Bridge {
  let listener: ((status: EngineStatusPayload) => void) | null = null;
  const relaunchEngine = vi.fn().mockResolvedValue({
    state: "starting",
    restarts: 0,
  } satisfies EngineStatusPayload);
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
    // commands; the gate tests only need inert stubs for both.
    setMenuContext: vi.fn(),
    onMenuCommand: () => () => {},
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return {
    relaunchEngine,
    emitStatus: (status) => {
      act(() => listener?.(status));
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
