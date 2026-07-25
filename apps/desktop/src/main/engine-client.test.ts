import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EngineClient,
  EngineProcessError,
  restartDelayMs,
} from "./engine-client.js";

const clients: EngineClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.stop().catch(() => undefined);
  }
  delete process.env.FAKE_ENGINE_EXIT_AFTER_INIT;
  vi.useRealTimers();
});

describe("engine process error", () => {
  it("preserves typed code and optional data for IPC envelopes", () => {
    const error = new EngineProcessError("engine_exited", "boom", {
      stderrTail: "panic",
      intentional: false,
    });
    expect(error.code).toBe("engine_exited");
    expect(error.data).toEqual({
      stderrTail: "panic",
      intentional: false,
    });
  });

  it("supports vi fake timers for backoff budgeting", () => {
    vi.useFakeTimers();
    const delays = [1, 2, 3].map(restartDelayMs);
    expect(delays.reduce((sum, item) => sum + item, 0)).toBe(1750);
    expect(restartDelayMs(10)).toBe(4000);
    vi.useRealTimers();
  });
});

describe("engine client unexpected exit restart", () => {
  it("restarts a real child process after unexpected exit and fires onReconnected", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-engine-client-"));
    const script = join(root, "fake-engine.mjs");
    // Fake engine: answers engine.initialize, then exits once per process when
    // FAKE_ENGINE_EXIT_AFTER_INIT=1. A restarted process stays up.
    await writeFile(
      script,
      `
import readline from "node:readline";
let initCount = 0;
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.method === "engine.initialize") {
    initCount += 1;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: 1,
        engineVersion: "test",
        capabilities: [],
      },
    }) + "\\n");
    if (process.env.FAKE_ENGINE_EXIT_AFTER_INIT === "1" && initCount === 1) {
      setTimeout(() => process.exit(1), 40);
    }
  } else if (req.method === "data.checkHealth") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: { healthy: true, schemaVersion: 1 },
    }) + "\\n");
  }
});
`,
      "utf8",
    );

    let reconnected: { attempt: number } | null = null;
    const unexpectedExits: number[] = [];
    process.env.FAKE_ENGINE_EXIT_AFTER_INIT = "1";

    const client = new EngineClient(script, root, {
      maxRestartAttempts: 3,
      onUnexpectedExit: ({ attempt }) => {
        unexpectedExits.push(attempt);
        // The first child is intentionally crashed; subsequent children must
        // remain alive so the test proves a successful real-process restart.
        delete process.env.FAKE_ENGINE_EXIT_AFTER_INIT;
      },
      onReconnected: (detail) => {
        reconnected = detail;
      },
    });
    clients.push(client);

    await client.start();
    const deadline = Date.now() + 15_000;
    while (!reconnected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(reconnected).not.toBeNull();
    expect(unexpectedExits.length).toBeGreaterThanOrEqual(1);

    const health = await client.call("data.checkHealth", {});
    expect(health).toMatchObject({ healthy: true });
    await client.stop();
  }, 20_000);

  it("forceKillChildForTest reaches unexpected-exit reconnect with a new PID", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-engine-force-kill-"));
    const script = join(root, "fake-engine.mjs");
    await writeFile(
      script,
      `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.method === "engine.initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: 1,
        engineVersion: "test",
        capabilities: [],
      },
    }) + "\\n");
  } else if (req.method === "data.checkHealth") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: { healthy: true, schemaVersion: 1 },
    }) + "\\n");
  }
});
`,
      "utf8",
    );

    let reconnected: { attempt: number } | null = null;
    const unexpectedExits: number[] = [];

    const client = new EngineClient(script, root, {
      maxRestartAttempts: 3,
      onUnexpectedExit: ({ attempt }) => {
        unexpectedExits.push(attempt);
      },
      onReconnected: (detail) => {
        reconnected = detail;
      },
    });
    clients.push(client);

    await client.start();
    const pidBefore = client.getLiveChildPidForTest();
    expect(pidBefore).not.toBeNull();

    const killed = client.forceKillChildForTest();
    expect(killed).toBe(true);

    const deadline = Date.now() + 15_000;
    while (!reconnected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(reconnected).not.toBeNull();
    expect(unexpectedExits.length).toBeGreaterThanOrEqual(1);

    const pidAfter = client.getLiveChildPidForTest();
    expect(pidAfter).not.toBeNull();
    expect(pidAfter).not.toBe(pidBefore);

    const health = await client.call("data.checkHealth", {});
    expect(health).toMatchObject({ healthy: true });
    await client.stop();
  }, 20_000);
});
