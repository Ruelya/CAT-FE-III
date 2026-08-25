import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { PROTOCOL_VERSION } from "@translunar/contracts";

import { createJsonlDecoder, encodeJsonlFrame } from "../shared/jsonl.js";
import type {
  EngineNotificationPayload,
  EngineStatusPayload,
} from "../shared/desktop-api.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_RESTART_BASE_DELAY_MS = 500;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface SupervisorOptions {
  binaryPath: string;
  dataDir: string;
  clientVersion: string;
  onNotification: (notification: EngineNotificationPayload) => void;
  onStatus: (status: EngineStatusPayload) => void;
  /** Test seams; production uses the defaults. */
  maxRestarts?: number;
  restartBaseDelayMs?: number;
  requestTimeoutMs?: number;
}

export class EngineRpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineRpcError";
  }
}

/**
 * Spawns and supervises the tl-engine child process: JSONL framing, request
 * correlation, notification fan-out, and bounded crash-restart with backoff.
 */
export class EngineSupervisor {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private restarts = 0;
  private stopped = false;
  private engineVersion: string | undefined;
  private state: EngineStatusPayload["state"] = "starting";
  private lastError: string | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private readonly maxRestarts: number;
  private readonly restartBaseDelayMs: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: SupervisorOptions) {
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.restartBaseDelayMs =
      options.restartBaseDelayMs ?? DEFAULT_RESTART_BASE_DELAY_MS;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  status(): EngineStatusPayload {
    const payload: EngineStatusPayload = {
      state: this.state,
      restarts: this.restarts,
    };
    if (this.child?.pid !== undefined) {
      payload.pid = this.child.pid;
    }
    if (this.engineVersion !== undefined) {
      payload.engineVersion = this.engineVersion;
    }
    if (this.lastError !== undefined) {
      payload.lastError = this.lastError;
    }
    return payload;
  }

  start(): void {
    if (this.stopped) {
      return;
    }
    this.setState("starting");
    const child = spawn(
      this.options.binaryPath,
      ["--data-dir", this.options.dataDir],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;

    const decoder = createJsonlDecoder(
      (frame) => this.onFrame(frame),
      (line) => {
        console.warn("engine emitted an undecodable frame", line);
      },
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => decoder.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      console.warn(`[tl-engine] ${chunk.trimEnd()}`);
    });
    child.on("error", (error) => {
      this.lastError = error.message;
      this.handleExit(child);
    });
    child.on("exit", (code, signal) => {
      if (!this.stopped) {
        this.lastError = `engine exited (code ${code ?? "none"}, signal ${signal ?? "none"})`;
      }
      this.handleExit(child);
    });

    void this.handshake(child);
  }

  private async handshake(
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    try {
      await this.request("engine.initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientName: "translunar-desktop",
        clientVersion: this.options.clientVersion,
      });
      if (this.child === child) {
        this.setState("ready");
      }
    } catch (error) {
      // A relaunch may have replaced this child while its handshake was in
      // flight; only the current child's outcome may drive the state.
      if (this.child !== child) {
        return;
      }
      this.lastError =
        error instanceof Error ? error.message : "handshake failed";
      this.setState("down");
    }
  }

  /**
   * Manual relaunch requested by the user from the engine-down surface.
   * Discards the exhausted auto-restart budget, detaches and kills any
   * stale child (e.g. one that failed the handshake but never exited),
   * and spawns a fresh engine. No-op after stop().
   */
  relaunch(): EngineStatusPayload {
    if (this.stopped) {
      return this.status();
    }
    const child = this.child;
    if (child) {
      // The old child's exit must not race the manual relaunch through
      // the auto-restart path; detach every listener before killing it.
      this.child = undefined;
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      child.on("error", () => {
        // Kill/stdin errors on the discarded child are irrelevant.
      });
      if (child.exitCode === null) {
        child.kill();
      }
    }
    // A pending auto-restart from the backoff window would double-spawn on
    // top of the manual relaunch.
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    this.rejectPending("engine is relaunching");
    this.restarts = 0;
    this.lastError = undefined;
    this.start();
    return this.status();
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      throw new EngineRpcError("engineDown", "engine process is not running");
    }
    const id = this.nextId;
    this.nextId += 1;
    const frame = encodeJsonlFrame({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EngineRpcError("timeout", `${method} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(frame, (error) => {
        if (error) {
          const entry = this.pending.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            reject(
              new EngineRpcError(
                "engineDown",
                `failed to write request: ${error.message}`,
              ),
            );
          }
        }
      });
    });
  }

  stop(): void {
    this.stopped = true;
    const child = this.child;
    if (!child) {
      return;
    }
    // Ask politely first; the engine exits after answering engine.shutdown.
    try {
      child.stdin.write(
        encodeJsonlFrame({
          id: this.nextId++,
          method: "engine.shutdown",
          params: {},
        }),
      );
    } catch {
      // stdin already closed; fall through to kill.
    }
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill();
      }
    }, 1_000).unref();
  }

  private onFrame(frame: unknown): void {
    if (typeof frame !== "object" || frame === null) {
      return;
    }
    const value = frame as Record<string, unknown>;
    if (value.kind === "notification" && typeof value.method === "string") {
      if (
        value.method === "notify.engine.ready" &&
        typeof value.params === "object" &&
        value.params !== null
      ) {
        const params = value.params as Record<string, unknown>;
        if (typeof params.engineVersion === "string") {
          this.engineVersion = params.engineVersion;
        }
      }
      this.options.onNotification({
        method: value.method,
        params: value.params ?? null,
      });
      return;
    }
    if (value.kind === "response") {
      const id = typeof value.id === "number" ? value.id : undefined;
      if (id === undefined) {
        return;
      }
      const entry = this.pending.get(id);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timer);
      this.pending.delete(id);
      const error = value.error as
        { code?: string; message?: string } | null | undefined;
      if (error) {
        entry.reject(
          new EngineRpcError(
            error.code ?? "internal",
            error.message ?? "engine returned an error",
          ),
        );
      } else {
        entry.resolve(value.result ?? null);
      }
    }
  }

  private handleExit(child: ChildProcessWithoutNullStreams): void {
    // 'error' and 'exit' can both fire for the same child; only the first
    // one may schedule a restart, and a child discarded by relaunch() must
    // never restart on top of its replacement.
    if (this.child !== child) {
      return;
    }
    this.child = undefined;
    this.rejectPending("engine process exited");
    if (this.stopped) {
      return;
    }
    if (this.restarts >= this.maxRestarts) {
      this.setState("down");
      return;
    }
    this.restarts += 1;
    this.setState("restarting");
    const delay = this.restartBaseDelayMs * 2 ** (this.restarts - 1);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start();
    }, delay);
    this.restartTimer.unref();
  }

  private rejectPending(message: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new EngineRpcError("engineDown", message));
    }
    this.pending.clear();
  }

  private setState(state: EngineStatusPayload["state"]): void {
    this.state = state;
    this.options.onStatus(this.status());
  }
}
