import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const catRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const binary =
  process.env.TRANSLUNAR_ENGINE_BIN ??
  join(
    catRoot,
    "target",
    "debug",
    process.platform === "win32" ? "translunar-engine.exe" : "translunar-engine",
  );
if (!existsSync(binary)) throw new Error(`binary missing: ${binary}`);

class EngineProcess {
  #child;
  #nextId = 1;
  #buffer = "";
  #waiters = [];
  constructor(binaryPath, dataDir) {
    this.binaryPath = binaryPath;
    this.dataDir = dataDir;
  }
  static async start(binaryPath, dataDir) {
    const p = new EngineProcess(binaryPath, dataDir);
    await p.#start();
    return p;
  }
  async #start() {
    this.#child = spawn(
      this.binaryPath,
      ["--data-dir", this.dataDir, "--protocol", "stdio"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          TRANSLUNAR_AI_TEST_MODE: "1",
          TRANSLUNAR_AI_TEST_CREDENTIAL: "engine-smoke-secret",
        },
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
        method,
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
      }, 1000);
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
      const waiterIndex = this.#waiters.findIndex((w) => w.id === response.id);
      if (waiterIndex < 0) continue;
      const [waiter] = this.#waiters.splice(waiterIndex, 1);
      if (response.error) {
        const error = new Error(`${waiter.method}: ${response.error.message}`);
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = {};
const dataDirectory = mkdtempSync(join(tmpdir(), "collab-ttl-probe-"));
const fixtureDirectory = mkdtempSync(join(tmpdir(), "collab-ttl-fix-"));
let processHandle;
try {
  const sourcePath = join(fixtureDirectory, "sample.txt");
  writeFileSync(sourcePath, "Hello collab probe.\n\nSecond.", "utf8");
  processHandle = await EngineProcess.start(binary, dataDirectory);
  await processHandle.call("engine.initialize", {
    protocolVersion: 1,
    client: { name: "collab-ttl-probe", version: "0.1.0" },
  });
  const project = await processHandle.call("project.create", {
    name: "TTL probe",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    domain: "general",
  });
  const imported = await processHandle.call("document.import", {
    projectId: project.id,
    sourcePath,
  });
  const segments = await processHandle.call("segment.list", {
    documentId: imported.document.id,
    offset: 0,
    limit: 10,
  });
  assert(segments.items.length >= 1, "need segment");
  const segmentId = segments.items[0].id;
  const documentId = imported.document.id;

  // Q3: real wall-clock presence TTL
  await processHandle.call("collab.presence.heartbeat", {
    projectId: project.id,
    actorId: "alice",
    documentId,
    segmentId,
    ttlMs: 1000,
  });
  const presenceImmediate = await processHandle.call("collab.presence.list", {
    projectId: project.id,
  });
  results.presence_immediate_visible = presenceImmediate.items.some(
    (i) => i.actorId === "alice",
  );
  assert(results.presence_immediate_visible, "presence should be visible immediately");

  await sleep(1300);
  const presenceAfterTtl = await processHandle.call("collab.presence.list", {
    projectId: project.id,
  });
  results.presence_after_ttl_omitted = !presenceAfterTtl.items.some(
    (i) => i.actorId === "alice",
  );
  assert(results.presence_after_ttl_omitted, "presence must expire after wall-clock TTL");

  // Q3: real wall-clock lock TTL
  const lock = await processHandle.call("collab.lock.acquire", {
    projectId: project.id,
    documentId,
    segmentId,
    actorId: "alice",
    ttlMs: 1000,
  });
  results.lock_alice = lock.actorId === "alice";
  try {
    await processHandle.call("collab.lock.acquire", {
      projectId: project.id,
      documentId,
      segmentId,
      actorId: "bob",
      ttlMs: 5000,
    });
    results.bob_blocked_while_alice_holds = false;
  } catch (error) {
    results.bob_blocked_while_alice_holds =
      error.code === "conflict" &&
      error.data?.entity === "segment_lock" &&
      error.data?.holderActorId === "alice";
    results.lock_conflict = {
      code: error.code,
      entity: error.data?.entity,
      holderActorId: error.data?.holderActorId,
    };
  }
  assert(results.bob_blocked_while_alice_holds, "bob must conflict while lock live");

  await sleep(1300);
  const bobLock = await processHandle.call("collab.lock.acquire", {
    projectId: project.id,
    documentId,
    segmentId,
    actorId: "bob",
    ttlMs: 5000,
  });
  results.bob_acquires_after_ttl = bobLock.actorId === "bob";
  assert(results.bob_acquires_after_ttl, "bob should acquire after alice lock TTL");

  // Q4: assignment complete requires expectedRevision
  const assignment = await processHandle.call("collab.assignment.create", {
    projectId: project.id,
    documentId,
    assigneeActorId: "bob",
    ordinalStart: 0,
    ordinalEnd: 0,
    createdBy: "alice",
  });
  results.assignment_revision_before = assignment.revision;
  results.assignment_status_before = assignment.status;

  const opsBeforeMissing = await processHandle.call("collab.opLog.list", {
    projectId: project.id,
    afterSequence: 0,
    limit: 100,
  });
  results.ops_total_before_missing = opsBeforeMissing.total;

  try {
    await processHandle.call("collab.assignment.complete", {
      assignmentId: assignment.id,
      actorId: "bob",
    });
    results.missing_revision_rejected = false;
    results.missing_revision_error = null;
  } catch (error) {
    results.missing_revision_rejected = true;
    results.missing_revision_error = {
      code: error.code,
      message: error.message,
      data: error.data,
    };
  }
  assert(results.missing_revision_rejected, "missing expectedRevision must fail");

  const listedAfterMissing = await processHandle.call("collab.assignment.list", {
    projectId: project.id,
  });
  const rowAfterMissing = listedAfterMissing.items.find(
    (i) => i.id === assignment.id,
  );
  results.after_missing_status = rowAfterMissing?.status;
  results.after_missing_revision = rowAfterMissing?.revision;
  results.missing_no_state_change =
    rowAfterMissing?.status === assignment.status &&
    rowAfterMissing?.revision === assignment.revision;

  const opsAfterMissing = await processHandle.call("collab.opLog.list", {
    projectId: project.id,
    afterSequence: 0,
    limit: 100,
  });
  results.ops_total_after_missing = opsAfterMissing.total;
  results.missing_no_oplog_change =
    opsAfterMissing.total === opsBeforeMissing.total;

  try {
    await processHandle.call("collab.assignment.complete", {
      assignmentId: assignment.id,
      expectedRevision: assignment.revision + 99,
      actorId: "bob",
    });
    results.stale_revision_rejected = false;
  } catch (error) {
    results.stale_revision_rejected = error.code === "conflict";
    results.stale_revision_error = {
      code: error.code,
      data: error.data,
    };
  }
  assert(results.stale_revision_rejected, "stale expectedRevision must conflict");

  const listedAfterStale = await processHandle.call("collab.assignment.list", {
    projectId: project.id,
  });
  const rowAfterStale = listedAfterStale.items.find((i) => i.id === assignment.id);
  results.after_stale_status = rowAfterStale?.status;
  results.after_stale_revision = rowAfterStale?.revision;
  results.stale_no_state_change =
    rowAfterStale?.status === assignment.status &&
    rowAfterStale?.revision === assignment.revision;

  const opsAfterStale = await processHandle.call("collab.opLog.list", {
    projectId: project.id,
    afterSequence: 0,
    limit: 100,
  });
  results.ops_total_after_stale = opsAfterStale.total;
  results.stale_no_oplog_change = opsAfterStale.total === opsBeforeMissing.total;

  const completed = await processHandle.call("collab.assignment.complete", {
    assignmentId: assignment.id,
    expectedRevision: assignment.revision,
    actorId: "bob",
  });
  results.complete_ok_status = completed.status;
  results.complete_ok_revision = completed.revision;
  results.complete_incremented =
    completed.status === "completed" &&
    completed.revision === assignment.revision + 1;

  const opsAfterOk = await processHandle.call("collab.opLog.list", {
    projectId: project.id,
    afterSequence: 0,
    limit: 100,
  });
  results.ops_total_after_ok = opsAfterOk.total;
  results.complete_appended_once =
    opsAfterOk.total === opsBeforeMissing.total + 1 &&
    opsAfterOk.items.filter((o) => o.kind === "assignment.complete").length === 1;

  try {
    await processHandle.call("collab.assignment.complete", {
      assignmentId: assignment.id,
      expectedRevision: assignment.revision,
      actorId: "bob",
    });
    results.second_stale_rejected = false;
  } catch (error) {
    results.second_stale_rejected = error.code === "conflict";
  }
  const finalList = await processHandle.call("collab.assignment.list", {
    projectId: project.id,
  });
  const finalRow = finalList.items.find((i) => i.id === assignment.id);
  results.final_status = finalRow?.status;
  results.final_revision = finalRow?.revision;
  results.final_stable =
    finalRow?.status === "completed" &&
    finalRow?.revision === assignment.revision + 1;

  console.log(JSON.stringify({ ok: true, binary, results }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          data: error.data,
          stack: error.stack,
        },
        results,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await processHandle?.stop();
  try {
    rmSync(dataDirectory, { recursive: true, force: true });
    rmSync(fixtureDirectory, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
