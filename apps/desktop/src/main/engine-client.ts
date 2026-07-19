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

export class EngineClient {
  readonly #executable: string;
  readonly #dataDirectory: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #buffer = "";
  #nextId = 1;
  #pending = new Map<number, PendingCall>();
  #stderrTail: string[] = [];

  constructor(executable: string, dataDirectory: string) {
    this.#executable = executable;
    this.#dataDirectory = dataDirectory;
  }

  async start(): Promise<void> {
    if (this.#child) return;
    const child = spawn(
      this.#executable,
      ["--data-dir", this.#dataDirectory, "--protocol", "stdio"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => this.#consumeStderr(chunk));
    child.once("exit", (code, signal) => this.#handleExit(code, signal));
    child.once("error", (error) => this.#rejectAll(error));
    await once(child, "spawn");
    await this.call("engine.initialize", {
      protocolVersion: PROTOCOL_VERSION,
      client: { name: "translunar-desktop", version: "0.1.0" },
    });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) return;
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
    await this.start();
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
      return Promise.reject(new Error("Translation engine is not running."));
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

  #handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const detail = this.#stderrTail.slice(-8).join(EOL);
    this.#child = null;
    this.#buffer = "";
    this.#rejectAll(
      new Error(
        `${basename(this.#executable)} exited (${String(code ?? signal)}).${detail ? `${EOL}${detail}` : ""}`,
      ),
    );
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
