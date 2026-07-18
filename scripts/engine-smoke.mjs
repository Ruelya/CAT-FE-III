import { existsSync, mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const binary =
    process.env.TRANSLUNAR_ENGINE_BIN ??
    join(
      root,
      "target",
      "debug",
      process.platform === "win32"
        ? "translunar-engine.exe"
        : "translunar-engine",
    );
  const fixture = join(root, "fixtures", "docx", "m0-source.docx");
  if (!existsSync(binary))
    throw new Error(`Engine binary not found: ${binary}`);
  if (!existsSync(fixture))
    throw new Error(`DOCX fixture not found: ${fixture}`);

  const dataDirectory = mkdtempSync(join(tmpdir(), "translunar-engine-smoke-"));
  const outputPath = join(dataDirectory, "translated.docx");
  let processHandle;

  try {
    processHandle = await EngineProcess.start(binary, dataDirectory);
    await processHandle.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke", version: "0.1.0" },
    });
    const project = await processHandle.call("project.create", {
      name: "Smoke project",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      domain: "legal",
    });
    const document = await processHandle.call("document.importDocx", {
      projectId: project.id,
      sourcePath: fixture,
    });
    const page = await processHandle.call("segment.list", {
      documentId: document.id,
      offset: 0,
      limit: 200,
    });
    assert(page.items.length === 3, "fixture should produce three segments");
    const first = page.items[0];
    await processHandle.call("segment.updateTarget", {
      segmentId: first.id,
      targetText: "保留期为 60 天。",
      expectedRevision: first.revision,
    });
    await processHandle.stop();

    processHandle = await EngineProcess.start(binary, dataDirectory);
    await processHandle.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "engine-smoke", version: "0.1.0" },
    });
    const recovered = await processHandle.call("segment.list", {
      documentId: document.id,
      offset: 0,
      limit: 200,
    });
    assert(
      recovered.items[0].targetText === "保留期为 60 天。",
      "draft should recover after restart",
    );
    try {
      await processHandle.call("segment.updateTarget", {
        segmentId: first.id,
        targetText: "stale",
        expectedRevision: 0,
      });
      throw new Error("stale write unexpectedly succeeded");
    } catch (error) {
      assert(error?.code === "conflict", "stale write should return conflict");
    }
    const confirmed = await processHandle.call("segment.confirm", {
      segmentId: first.id,
      expectedRevision: recovered.items[0].revision,
    });
    assert(confirmed.qaIssues.length === 1, "30/60 should create one QA issue");
    const exact = await processHandle.call("tm.lookupExact", {
      projectId: project.id,
      sourceText: first.sourceText,
    });
    assert(exact.matches.length === 1, "confirmation should sink one TM entry");
    const corrected = await processHandle.call("segment.updateTarget", {
      segmentId: first.id,
      targetText: "保留期为 30 天。",
      expectedRevision: confirmed.segment.revision,
    });
    await processHandle.call("segment.confirm", {
      segmentId: first.id,
      expectedRevision: corrected.revision,
    });
    const issues = await processHandle.call("qa.list", {
      documentId: document.id,
      includeResolved: true,
    });
    assert(
      issues.issues.length === 1 && issues.issues[0].status === "resolved",
      "QA issue should resolve",
    );
    const exported = await processHandle.call("document.exportDocx", {
      documentId: document.id,
      outputPath,
    });
    assert(
      exported.translatedSegments === 1,
      "export should contain one translated segment",
    );
    assert(statSync(outputPath).size > 0, "export should be non-empty");
    console.log(`Engine smoke passed: ${outputPath}`);
  } finally {
    await processHandle?.stop();
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

class EngineProcess {
  #child;
  #nextId = 1;
  #buffer = "";
  #responses = [];
  #waiters = [];

  static async start(binaryPath, dataDir) {
    const processHandle = new EngineProcess(binaryPath, dataDir);
    await processHandle.#start();
    return processHandle;
  }

  constructor(binaryPath, dataDir) {
    this.binaryPath = binaryPath;
    this.dataDir = dataDir;
  }

  async #start() {
    this.#child = spawn(
      this.binaryPath,
      ["--data-dir", this.dataDir, "--protocol", "stdio"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => this.#consume(chunk));
    this.#child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    this.#child.once("error", (error) => this.#fail(error));
    await new Promise((resolvePromise, rejectPromise) => {
      this.#child.once("spawn", resolvePromise);
      this.#child.once("error", rejectPromise);
    });
  }

  call(method, params) {
    const id = this.#nextId++;
    this.#child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return new Promise((resolvePromise, rejectPromise) => {
      this.#waiters.push({
        id,
        resolve: resolvePromise,
        reject: rejectPromise,
      });
    });
  }

  async stop() {
    if (!this.#child) return;
    const child = this.#child;
    this.#child = null;
    child.stdin.end();
    await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill();
        resolvePromise();
      }, 1_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }

  #consume(chunk) {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const waiterIndex = this.#waiters.findIndex(
        (waiter) => waiter.id === response.id,
      );
      if (waiterIndex < 0) continue;
      const [waiter] = this.#waiters.splice(waiterIndex, 1);
      if (response.error) {
        const error = new Error(response.error.message);
        error.code = response.error.code;
        error.data = response.error.data;
        waiter.reject(error);
      } else {
        waiter.resolve(response.result);
      }
    }
  }

  #fail(error) {
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await main();
