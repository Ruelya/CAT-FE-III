// @vitest-environment node
// Down/retry lifecycle tests against a real child process: the fake engine
// harness speaks the JSONL protocol, so spawn, crash, restart backoff,
// budget exhaustion, and manual relaunch all run the production code path.
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  EngineNotificationPayload,
  EngineStatusPayload,
} from "../shared/desktop-api.js";
import { EngineRpcError, EngineSupervisor } from "./engine-supervisor.js";

const FAKE_ENGINE = fileURLToPath(
  new URL("../../tests/harness/fake-engine.mjs", import.meta.url),
);

interface Harness {
  supervisor: EngineSupervisor;
  statuses: EngineStatusPayload[];
  notifications: EngineNotificationPayload[];
}

const cleanups: Array<() => void> = [];

function createHarness(
  dataDir: string,
  overrides: { binaryPath?: string } = {},
): Harness {
  const statuses: EngineStatusPayload[] = [];
  const notifications: EngineNotificationPayload[] = [];
  const supervisor = new EngineSupervisor({
    binaryPath: overrides.binaryPath ?? FAKE_ENGINE,
    dataDir,
    clientVersion: "0.0.0-test",
    onNotification: (notification) => notifications.push(notification),
    onStatus: (status) => statuses.push(status),
    maxRestarts: 2,
    restartBaseDelayMs: 10,
    requestTimeoutMs: 3_000,
  });
  cleanups.push(() => supervisor.stop());
  return { supervisor, statuses, notifications };
}

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tl-supervisor-test-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("EngineSupervisor down/retry lifecycle", () => {
  it("reaches ready through the real handshake and serves requests", async () => {
    const { supervisor, notifications } = createHarness(makeDataDir());
    supervisor.start();
    await waitFor(() => supervisor.status().state === "ready", "ready");
    const status = supervisor.status();
    expect(status.pid).toBeGreaterThan(0);
    expect(status.engineVersion).toBe("0.0.0-fake");
    expect(status.restarts).toBe(0);
    expect(notifications.some((n) => n.method === "notify.engine.ready")).toBe(
      true,
    );
    await expect(supervisor.request("echo", { value: 42 })).resolves.toEqual({
      value: 42,
    });
  });

  it("parks in down with the spawn error and rejects requests instead of faking success", async () => {
    const dataDir = makeDataDir();
    const { supervisor, statuses } = createHarness(dataDir, {
      binaryPath: join(dataDir, "missing-binary"),
    });
    supervisor.start();
    await waitFor(() => supervisor.status().state === "down", "down");
    const status = supervisor.status();
    expect(status.lastError).toBeTruthy();
    expect(status.restarts).toBe(2);
    expect(statuses.some((s) => s.state === "restarting")).toBe(true);
    const failure = await supervisor
      .request("segment.update", {})
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EngineRpcError);
    expect((failure as EngineRpcError).code).toBe("engineDown");
  });

  it("rejects the pending write on a mid-request crash and auto-restarts", async () => {
    const { supervisor, statuses } = createHarness(makeDataDir());
    supervisor.start();
    await waitFor(() => supervisor.status().state === "ready", "first ready");
    const firstPid = supervisor.status().pid;

    // The fake engine dies without answering: the caller must get a
    // rejection, never a hang or a fake ack.
    const pending = supervisor.request("exit.now", {});
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EngineRpcError);
    expect((failure as EngineRpcError).code).toBe("engineDown");

    await waitFor(
      () =>
        supervisor.status().state === "ready" &&
        supervisor.status().pid !== firstPid,
      "restarted ready",
    );
    expect(supervisor.status().restarts).toBe(1);
    expect(statuses.some((s) => s.state === "restarting")).toBe(true);
  });

  it("exhausts the restart budget, then a manual relaunch resets it and recovers", async () => {
    const dataDir = makeDataDir();
    writeFileSync(join(dataDir, "crash-on-start"), "");
    const { supervisor } = createHarness(dataDir);
    supervisor.start();
    await waitFor(() => supervisor.status().state === "down", "down");
    expect(supervisor.status().restarts).toBe(2);
    expect(supervisor.status().lastError).toContain("exited");

    unlinkSync(join(dataDir, "crash-on-start"));
    const afterRelaunch = supervisor.relaunch();
    expect(afterRelaunch.state).toBe("starting");
    expect(afterRelaunch.restarts).toBe(0);
    await waitFor(
      () => supervisor.status().state === "ready",
      "ready after relaunch",
    );
    await expect(supervisor.request("echo", { ok: true })).resolves.toEqual({
      ok: true,
    });
  });

  it("relaunch kills a stale child that failed the handshake but never exited", async () => {
    const dataDir = makeDataDir();
    writeFileSync(join(dataDir, "reject-init"), "");
    const { supervisor } = createHarness(dataDir);
    supervisor.start();
    await waitFor(
      () => supervisor.status().state === "down",
      "down after rejected handshake",
    );
    const stalePid = supervisor.status().pid;
    expect(stalePid).toBeGreaterThan(0);
    expect(isProcessAlive(stalePid as number)).toBe(true);

    unlinkSync(join(dataDir, "reject-init"));
    supervisor.relaunch();
    await waitFor(
      () => supervisor.status().state === "ready",
      "ready after relaunch",
    );
    expect(supervisor.status().pid).not.toBe(stalePid);
    await waitFor(
      () => !isProcessAlive(stalePid as number),
      "stale child to die",
    );
  });
});
