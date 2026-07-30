import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { EOL } from "node:os";
import { basename } from "node:path";

import {
  PROTOCOL_VERSION,
  type EngineMethod,
  type EngineParams,
  type EngineResult,
  type RpcResponse,
} from "@translunar/contracts";

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class EngineProcessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "EngineProcessError";
  }
}

export type EngineExitReason = "intentional" | "unexpected";

export interface EngineClientOptions {
  maxRestartAttempts?: number;
  onUnexpectedExit?: (detail: {
    code: number | null;
    signal: NodeJS.Signals | null;
    stderrTail: string;
    attempt: number;
  }) => void;
  onReconnected?: (detail: { attempt: number }) => void;
  onRestartFailed?: (detail: {
    attempts: number;
    stderrTail: string;
    error: Error;
  }) => void;
}

export class EngineClient {
  readonly #executable: string;
  #dataDirectory: string;
  #bundledPluginRoot: string | null;
  #child: ChildProcessWithoutNullStreams | null = null;
  #buffer = "";
  #nextId = 1;
  #pending = new Map<number, PendingCall>();
  #stderrTail: string[] = [];
  #intentionalStop = false;
  #restarting = false;
  #restartAttempts = 0;
  readonly #maxRestartAttempts: number;
  readonly #onUnexpectedExit?: EngineClientOptions["onUnexpectedExit"];
  readonly #onReconnected?: EngineClientOptions["onReconnected"];
  readonly #onRestartFailed?: EngineClientOptions["onRestartFailed"];

  constructor(
    executable: string,
    dataDirectory: string,
    options: EngineClientOptions & { bundledPluginRoot?: string | null } = {},
  ) {
    this.#executable = executable;
    this.#dataDirectory = dataDirectory;
    this.#bundledPluginRoot = options.bundledPluginRoot ?? null;
    this.#maxRestartAttempts = options.maxRestartAttempts ?? 3;
    this.#onUnexpectedExit = options.onUnexpectedExit;
    this.#onReconnected = options.onReconnected;
    this.#onRestartFailed = options.onRestartFailed;
  }

  setBundledPluginRoot(path: string | null): void {
    this.#bundledPluginRoot = path;
  }

  get dataDirectory(): string {
    return this.#dataDirectory;
  }

  setDataDirectory(path: string): void {
    this.#dataDirectory = path;
  }

  async start(): Promise<void> {
    if (this.#child) return;
    this.#intentionalStop = false;
    // Allow Node scripts as the Engine executable (used by process-level tests).
    const isNodeScript = /\.[cm]?js$/iu.test(this.#executable);
    const command = isNodeScript ? process.execPath : this.#executable;
    const baseArgs = isNodeScript
      ? [
          this.#executable,
          "--data-dir",
          this.#dataDirectory,
          "--protocol",
          "stdio",
        ]
      : ["--data-dir", this.#dataDirectory, "--protocol", "stdio"];
    const args =
      this.#bundledPluginRoot && this.#bundledPluginRoot.length > 0
        ? [...baseArgs, "--bundled-plugin-root", this.#bundledPluginRoot]
        : baseArgs;
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => this.#consumeStderr(chunk));
    child.once("exit", (code, signal) => {
      void this.#handleExit(code, signal);
    });
    child.once("error", (error) => this.#rejectAll(error));
    await once(child, "spawn");
    await this.call("engine.initialize", {
      protocolVersion: PROTOCOL_VERSION,
      client: { name: "translunar-desktop", version: "0.1.0" },
    });
  }

  async startWithDataDirectory(dataDirectory: string): Promise<void> {
    this.#dataDirectory = dataDirectory;
    await this.start();
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) return;
    this.#intentionalStop = true;
    child.stdin.end();
    const exited = once(child, "exit");
    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 1_500).unref();
    });
    if ((await Promise.race([exited, timeout])) === "timeout") {
      child.kill();
      await once(child, "exit").catch(() => undefined);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    this.#restartAttempts = 0;
    await this.start();
  }

  /**
   * Test/E2E helper: kill the current child without intentional-stop semantics
   * so the bounded unexpected-exit / reconnect path runs.
   */
  forceKillChildForTest(): boolean {
    const child = this.#child;
    if (!child) return false;
    // Leave #intentionalStop false — #handleExit must treat this as unexpected.
    return child.kill();
  }

  /**
   * Test/E2E helper: live child PID, or null when no process is attached.
   */
  getLiveChildPidForTest(): number | null {
    const pid = this.#child?.pid;
    return typeof pid === "number" ? pid : null;
  }

  call<Method extends EngineMethod>(
    method: Method,
    params: EngineParams<Method>,
  ): Promise<EngineResult<Method>> {
    return this.#callRaw(method, params) as Promise<EngineResult<Method>>;
  }

  callInternal(method: string, params: unknown): Promise<unknown> {
    return this.#callRaw(method, params);
  }

  #callRaw(method: string, params: unknown): Promise<unknown> {
    const child = this.#child;
    if (!child?.stdin.writable) {
      return Promise.reject(
        new EngineProcessError(
          "engine_unavailable",
          "Translation engine is not running.",
        ),
      );
    }
    const id = this.#nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      child.stdin.write(`${frame}\n`, (error) => {
        if (!error) return;
        this.#pending.delete(id);
        reject(error);
      });
    });
    return response;
  }

  #consumeStdout(chunk: string): void {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line) this.#consumeFrame(line);
    }
  }

  #consumeFrame(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      this.#rejectAll(
        new Error(`Engine emitted invalid JSON: ${String(error)}`),
      );
      return;
    }
    if (!isRecord(value) || typeof value.id !== "number") return;
    const pending = this.#pending.get(value.id);
    if (!pending) return;
    this.#pending.delete(value.id);
    const response = value as unknown as RpcResponse;
    if ("error" in response) {
      pending.reject(
        new EngineProcessError(
          response.error.code,
          response.error.message,
          response.error.data,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  #consumeStderr(chunk: string): void {
    const lines = chunk.split(/\r?\n/u).filter(Boolean);
    this.#stderrTail.push(...lines);
    if (this.#stderrTail.length > 80)
      this.#stderrTail.splice(0, this.#stderrTail.length - 80);
    process.stderr.write(chunk);
  }

  async #handleExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const detail = this.#stderrTail.slice(-8).join(EOL);
    const intentional = this.#intentionalStop;
    this.#child = null;
    this.#buffer = "";
    this.#rejectAll(
      new EngineProcessError(
        intentional ? "engine_stopped" : "engine_exited",
        `${basename(this.#executable)} exited (${String(code ?? signal)}).${detail ? `${EOL}${detail}` : ""}`,
        { stderrTail: detail, intentional },
      ),
    );

    if (intentional || this.#restarting) {
      this.#intentionalStop = false;
      return;
    }
    this.#restarting = true;
    try {
      let lastError = new Error("Engine restart attempts exhausted.");
      for (let attempt = 1; attempt <= this.#maxRestartAttempts; attempt += 1) {
        this.#restartAttempts = attempt;
        this.#onUnexpectedExit?.({
          code,
          signal,
          stderrTail: detail,
          attempt,
        });
        await sleep(restartDelayMs(attempt));
        try {
          await this.start();
          this.#restartAttempts = 0;
          this.#onReconnected?.({ attempt });
          return;
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error("Engine automatic restart failed.");
          await this.stop().catch(() => undefined);
        }
      }
      this.#onRestartFailed?.({
        attempts: this.#restartAttempts,
        stderrTail: detail,
        error: lastError,
      });
    } finally {
      this.#restarting = false;
      this.#intentionalStop = false;
    }
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

export function restartDelayMs(attempt: number): number {
  return Math.min(4_000, 250 * 2 ** Math.max(0, attempt - 1));
}
