import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPanelBridge,
  hostParamsForBridgeMethod,
  parsePanelMessage,
  type PanelBridgePort,
} from "./PluginPanelHost";

afterEach(() => {
  vi.useRealTimers();
});

describe("plugin panel bridge host params", () => {
  it("never forwards workbench identifiers on panel.context", () => {
    expect(
      hostParamsForBridgeMethod("panel.context", {}, "project-1", "segment-1"),
    ).toEqual({});
  });

  it("forwards only contract-allowed identifiers per method", () => {
    expect(
      hostParamsForBridgeMethod(
        "panel.projectContext",
        {},
        "project-1",
        "segment-1",
      ),
    ).toEqual({ projectId: "project-1" });
    expect(
      hostParamsForBridgeMethod(
        "panel.activeSelection",
        {},
        "project-1",
        "segment-1",
      ),
    ).toEqual({ projectId: "project-1", segmentId: "segment-1" });
    expect(
      hostParamsForBridgeMethod(
        "panel.proposeReplacement",
        { text: "replacement" },
        "project-1",
        "segment-1",
      ),
    ).toEqual({
      projectId: "project-1",
      segmentId: "segment-1",
      text: "replacement",
    });
  });
});

describe("plugin panel bridge codec", () => {
  it("accepts only closed versioned message envelopes", () => {
    expect(
      parsePanelMessage({ version: 1, type: "ready", nonce: "n" }),
    ).toEqual({ version: 1, type: "ready", nonce: "n" });
    expect(
      parsePanelMessage({
        version: 1,
        type: "request",
        id: "request-1",
        method: "panel.context",
        params: {},
      }),
    ).not.toBeNull();
    expect(
      parsePanelMessage({ version: 2, type: "ready", nonce: "n" }),
    ).toBeNull();
    expect(
      parsePanelMessage({ version: 1, type: "ready", nonce: "n", extra: 1 }),
    ).toBeNull();
    expect(
      parsePanelMessage({ version: 1, type: "unknown", id: "x" }),
    ).toBeNull();
  });

  it("requires the exact panel.context method and empty params object", () => {
    const request = {
      version: 1,
      type: "request",
      id: "request-1",
      method: "panel.context",
    };
    expect(parsePanelMessage({ ...request, params: {} })).not.toBeNull();
    expect(
      parsePanelMessage({ ...request, params: { extra: true } }),
    ).toBeNull();
    expect(parsePanelMessage({ ...request, params: null })).toBeNull();
    expect(parsePanelMessage({ ...request, params: [] })).toBeNull();
    expect(
      parsePanelMessage({ ...request, method: "engine.invoke", params: {} }),
    ).toBeNull();
  });

  it("rejects cycles, custom prototypes, deep and oversized payloads", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(panelRequest("cycle", cyclic)).toBeNull();
    expect(panelRequest("prototype", new Date())).toBeNull();

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 18; index += 1) {
      deep.next = {};
      deep = deep.next as Record<string, unknown>;
    }
    expect(panelRequest("deep", root)).toBeNull();
    expect(panelRequest("large", "x".repeat(256 * 1024))).toBeNull();
  });

  it("rejects excessive nodes, array items, and object entries incrementally", () => {
    expect(
      panelRequest(
        "nodes",
        Array.from({ length: 4_097 }, () => null),
      ),
    ).toBeNull();
    expect(
      panelRequest(
        "entries",
        Object.fromEntries(
          Array.from({ length: 1_025 }, (_, index) => [`key-${index}`, null]),
        ),
      ),
    ).toBeNull();
  });
});

describe("plugin panel bridge state machine", () => {
  it.each([
    { version: 2, type: "ready", nonce: "nonce" },
    { version: 1, type: "unknown", id: "request-1" },
    {
      version: 1,
      type: "request",
      id: "deep",
      method: "panel.context",
      params: nestedValue(18),
    },
    {
      version: 1,
      type: "request",
      id: "large",
      method: "panel.context",
      params: "x".repeat(256 * 1024),
    },
  ])("closes on malformed or unsupported message %#", (message) => {
    const harness = createHarness();
    harness.port.dispatch(message);

    expect(harness.bridge.isClosed()).toBe(true);
    expect(harness.onClosed).toHaveBeenCalledOnce();
    expect(harness.onClosed).toHaveBeenCalledWith("protocol_error");
    expect(harness.port.closed).toBe(true);
  });

  it("fails closed when cancellation does not name a pending request", () => {
    const harness = createHarness();
    establishReady(harness.port);

    harness.port.dispatch({ version: 1, type: "cancel", id: "missing" });

    expect(harness.bridge.isClosed()).toBe(true);
    expect(harness.onClosed).toHaveBeenCalledWith("protocol_error");
  });

  it("revokes the bridge and clears work when a request times out", () => {
    vi.useFakeTimers();
    const queued: Array<() => void> = [];
    const harness = createHarness((callback) => queued.push(callback));
    establishReady(harness.port);
    harness.port.dispatch({
      version: 1,
      type: "request",
      id: "request-1",
      method: "panel.context",
      params: {},
    });

    vi.advanceTimersByTime(3_000);

    expect(harness.bridge.isClosed()).toBe(true);
    expect(harness.onClosed).toHaveBeenCalledWith("request_timeout");
    expect(harness.port.messages).toContainEqual(
      expect.objectContaining({ type: "error", id: "request-1" }),
    );
    expect(harness.port.messages).toContainEqual(
      expect.objectContaining({ type: "revoked", reason: "request_timeout" }),
    );
    expect(vi.getTimerCount()).toBe(0);

    queued[0]?.();
    expect(
      harness.port.messages.filter(
        (message) => isRecord(message) && message.type === "result",
      ),
    ).toHaveLength(0);
  });

  it("keeps the deadline active while the Engine resolver is pending", () => {
    vi.useFakeTimers();
    const queued: Array<() => void> = [];
    const harness = createHarness(
      (callback) => queued.push(callback),
      () => new Promise<Record<string, unknown>>(() => undefined),
    );
    establishReady(harness.port);
    harness.port.dispatch({
      version: 1,
      type: "request",
      id: "request-pending",
      method: "panel.context",
      params: {},
    });

    queued[0]?.();
    vi.advanceTimersByTime(3_000);

    expect(harness.bridge.isClosed()).toBe(true);
    expect(harness.onClosed).toHaveBeenCalledWith("request_timeout");
    expect(harness.port.messages).toContainEqual(
      expect.objectContaining({ type: "error", id: "request-pending" }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("external cleanup closes state and prevents late callbacks", () => {
    vi.useFakeTimers();
    const queued: Array<() => void> = [];
    const harness = createHarness((callback) => queued.push(callback));
    establishReady(harness.port);
    harness.port.dispatch({
      version: 1,
      type: "request",
      id: "request-1",
      method: "panel.context",
      params: {},
    });

    harness.bridge.close("session_revoked");
    vi.runAllTimers();
    queued[0]?.();
    harness.port.dispatch({ version: 1, type: "ready", nonce: "nonce" });

    expect(harness.bridge.isClosed()).toBe(true);
    expect(harness.onClosed).toHaveBeenCalledTimes(1);
    expect(harness.onClosed).toHaveBeenCalledWith("session_revoked");
    expect(harness.port.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      harness.port.messages.filter(
        (message) => isRecord(message) && message.type === "result",
      ),
    ).toHaveLength(0);
  });

  it("Engine panel.context RPC omits workbench identifiers even when present", async () => {
    const queued: Array<() => void> = [];
    const invoke = vi.fn().mockResolvedValue({
      result: {
        pluginId: "example.sandbox",
        contributionId: "example.sandbox.panel",
        revision: 1,
        displayName: "Sandbox Toolkit",
        label: "Toolkit Panel",
      },
    });
    const hostWindow = window as unknown as {
      translunar?: { invoke: typeof invoke };
    };
    const previousTranslunar = hostWindow.translunar;
    hostWindow.translunar = { invoke };
    try {
      const port = new FakePort();
      const onReady = vi.fn();
      const onClosed = vi.fn();
      createPanelBridge({
        port,
        nonce: "nonce",
        context: {
          pluginId: "example.sandbox",
          contributionId: "example.sandbox.panel",
          revision: 1,
        },
        result: {
          pluginName: "Sandbox Toolkit",
          contributionName: "Toolkit Panel",
          revision: 1,
        },
        owner: {
          pluginId: "example.sandbox",
          versionId: "version-1",
          activationRevision: 1,
          contributionId: "example.sandbox.panel",
        },
        projectId: "project-1",
        segmentId: "segment-1",
        onReady,
        onClosed,
        queueTask: (callback) => queued.push(callback),
      });
      establishReady(port);
      port.dispatch({
        version: 1,
        type: "request",
        id: "context-1",
        method: "panel.context",
        params: {},
      });
      queued[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(invoke).toHaveBeenCalledWith("plugin.uiPanel.bridge.call", {
        owner: {
          pluginId: "example.sandbox",
          versionId: "version-1",
          activationRevision: 1,
          contributionId: "example.sandbox.panel",
        },
        method: "panel.context",
        params: {},
      });
      const resultMessage = port.messages.find(
        (message) =>
          isRecord(message) &&
          message.type === "result" &&
          message.id === "context-1",
      );
      expect(isRecord(resultMessage)).toBe(true);
      expect(isRecord(resultMessage) && isRecord(resultMessage.result)).toBe(
        true,
      );
      if (isRecord(resultMessage) && isRecord(resultMessage.result)) {
        // Host labels must win when Engine aliases reuse contribution names.
        expect(resultMessage.result.pluginName).toBe("Sandbox Toolkit");
        expect(resultMessage.result.contributionName).toBe("Toolkit Panel");
        expect(resultMessage.result.pluginId).toBe("example.sandbox");
        expect(resultMessage.result.contributionId).toBe(
          "example.sandbox.panel",
        );
      }
      expect(onClosed).not.toHaveBeenCalled();
    } finally {
      if (previousTranslunar === undefined) {
        Reflect.deleteProperty(hostWindow, "translunar");
      } else {
        hostWindow.translunar = previousTranslunar;
      }
    }
  });
});

class FakePort implements PanelBridgePort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: unknown[] = [];
  closed = false;
  started = false;

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("port closed");
    this.messages.push(message);
  }

  start(): void {
    this.started = true;
  }

  close(): void {
    this.closed = true;
  }

  dispatch(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

function createHarness(
  queueTask?: (callback: () => void) => void,
  resolveForTest: (
    method:
      | "panel.context"
      | "panel.activeSelection"
      | "panel.projectContext"
      | "panel.proposeReplacement",
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>> = (method) => {
    if (method === "panel.context") {
      return Promise.resolve({
        pluginName: "Sandbox Toolkit",
        contributionName: "Toolkit Panel",
        revision: 1,
      });
    }
    return Promise.reject(new Error(`unexpected method ${method}`));
  },
) {
  const port = new FakePort();
  const onReady = vi.fn();
  const onClosed = vi.fn();
  const bridge = createPanelBridge({
    port,
    nonce: "nonce",
    context: {
      pluginId: "example.sandbox",
      contributionId: "example.sandbox.panel",
      revision: 1,
    },
    result: {
      pluginName: "Sandbox Toolkit",
      contributionName: "Toolkit Panel",
      revision: 1,
    },
    owner: {
      pluginId: "example.sandbox",
      versionId: "version-1",
      activationRevision: 1,
      contributionId: "example.sandbox.panel",
    },
    // Unit tests inject a resolver; production always uses Engine RPC.
    resolveForTest,
    onReady,
    onClosed,
    ...(queueTask ? { queueTask } : {}),
  });
  return { bridge, onClosed, onReady, port };
}

function establishReady(port: FakePort): void {
  port.dispatch({ version: 1, type: "ready", nonce: "nonce" });
}

function panelRequest(id: string, params: unknown) {
  return parsePanelMessage({
    version: 1,
    type: "request",
    id,
    method: "panel.context",
    params,
  });
}

function nestedValue(depth: number): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current = root;
  for (let index = 0; index < depth; index += 1) {
    const next: Record<string, unknown> = {};
    current.next = next;
    current = next;
  }
  return root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
