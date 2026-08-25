import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { PROTOCOL_VERSION } from "@translunar/contracts";

import { createJsonlDecoder, encodeJsonlFrame } from "../shared/jsonl.js";
import type {
  EngineNotificationPayload,
  EngineStatusPayload,
} from "../shared/desktop-api.js";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RESTARTS = 5;
const RESTART_BASE_DELAY_MS = 500;

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

  constructor(private readonly options: SupervisorOptions) {}

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
      this.handleExit();
    });
    child.on("exit", (code, signal) => {
      if (!this.stopped) {
        this.lastError = `engine exited (code ${code ?? "none"}, signal ${signal ?? "none"})`;
      }
      this.handleExit();
    });

    void this.handshake();
  }

  private async handshake(): Promise<void> {
    try {
      await this.request("engine.initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientName: "translunar-desktop",
        clientVersion: this.options.clientVersion,
      });
      this.setState("ready");
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "handshake failed";
      this.setState("down");
    }
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
      }, REQUEST_TIMEOUT_MS);
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

  private handleExit(): void {
    this.child = undefined;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new EngineRpcError("engineDown", "engine process exited"));
    }
    this.pending.clear();
    if (this.stopped) {
      return;
    }
    if (this.restarts >= MAX_RESTARTS) {
      this.setState("down");
      return;
    }
    this.restarts += 1;
    this.setState("restarting");
    const delay = RESTART_BASE_DELAY_MS * 2 ** (this.restarts - 1);
    setTimeout(() => this.start(), delay).unref();
  }

  private setState(state: EngineStatusPayload["state"]): void {
    this.state = state;
    this.options.onStatus(this.status());
  }
}
