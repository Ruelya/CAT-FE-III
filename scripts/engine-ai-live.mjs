// Live AI provider verification against a REAL gateway, driven entirely by
// environment variables so no endpoint or credential ever lands in the repo:
//
//   TL_AI_BASE_URL   required  gateway base URL (e.g. https://host/v1)
//   TL_AI_API_KEY    required  gateway API key (kept in engine memory only)
//   TL_AI_MODEL      required  model identifier
//   TL_AI_PROVIDER   optional  provider kind (default: openaiCompatible)
//
// Run with: node scripts/engine-ai-live.mjs
//
// The script walks the honest AI lifecycle over the stdio protocol:
// aiNotConfigured before a key, ai.configure, an async ai.assist.start on a
// real segment polled to done, the cancel path, and an agent run that must
// park at awaitingReview without confirming, writing TM, signing off, or
// exporting. The API key is redacted (last 4 chars) in every line printed.
//
// This is a manual, secrets-required check; CI uses engine-smoke.mjs, which
// covers the same paths against loopback mocks.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";

const baseUrl = process.env.TL_AI_BASE_URL;
const apiKey = process.env.TL_AI_API_KEY;
const model = process.env.TL_AI_MODEL;
const provider = process.env.TL_AI_PROVIDER ?? "openaiCompatible";
if (!baseUrl || !apiKey || !model) {
  console.error(
    "engine-ai-live: set TL_AI_BASE_URL, TL_AI_API_KEY, and TL_AI_MODEL " +
      "(never commit these values). Optional: TL_AI_PROVIDER.",
  );
  process.exit(2);
}
const redactedKey = `…${apiKey.slice(-4)} (${apiKey.length} chars)`;

const root = resolve(import.meta.dirname, "..");
const binary =
  process.env.TL_ENGINE_BIN ??
  join(
    root,
    "target",
    "debug",
    process.platform === "win32" ? "tl-engine.exe" : "tl-engine",
  );
if (!existsSync(binary)) {
  throw new Error(
    `engine binary not found: ${binary} (run cargo build -p tl-engine)`,
  );
}

const dataDir = mkdtempSync(join(tmpdir(), "tl-engine-ai-live-"));
const child = spawn(binary, ["--data-dir", join(dataDir, "data")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let nextId = 1;
const pending = new Map();
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\n");
    if (!line) continue;
    const frame = JSON.parse(line);
    if (frame.kind === "response" && typeof frame.id === "number") {
      const entry = pending.get(frame.id);
      if (entry) {
        pending.delete(frame.id);
        clearTimeout(entry.timer);
        entry.resolve(frame);
      }
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new Error(`${method} timed out`)),
      120_000,
    );
    pending.set(id, { resolve: resolvePromise, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

async function call(method, params) {
  const response = await request(method, params);
  if (response.error) {
    throw new Error(`${method} failed: ${JSON.stringify(response.error)}`);
  }
  return response.result;
}

async function expectError(method, params, code) {
  const response = await request(method, params);
  if (!response.error) {
    throw new Error(`${method} unexpectedly succeeded`);
  }
  if (response.error.code !== code) {
    throw new Error(
      `${method} failed with ${response.error.code}, expected ${code}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function log(message) {
  console.log(`[ai-live] ${message}`);
}

async function pollAssist(assistId, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let view = await call("ai.assist.status", { assistId });
  while (view.status === "running") {
    assert(Date.now() < deadline, "assist finished before the deadline");
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
    view = await call("ai.assist.status", { assistId });
  }
  return view;
}

try {
  log(`provider=${provider} model=${model} baseUrl=${baseUrl}`);
  log(`apiKey=${redactedKey}`);

  await call("engine.initialize", {
    protocolVersion: 1,
    clientName: "engine-ai-live",
    clientVersion: "0",
  });

  const project = await call("project.create", {
    name: "AI live test",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
  });
  const sourcePath = join(dataDir, "live-source.txt");
  writeFileSync(
    sourcePath,
    "The retention period for exported archives is 30 days.\n\n" +
      "Click Save to keep your changes.\n\n" +
      "This sentence exists to exercise the cancel path.\n",
  );
  const imported = await call("document.import", {
    projectId: project.id,
    sourcePath,
  });
  const { segments } = await call("segment.list", {
    documentId: imported.document.id,
  });
  assert(segments.length >= 3, "live fixture imports three segments");

  // 1. Honest refusal before any key is configured.
  const before = await call("ai.status", {});
  assert(before.configured === false, "AI starts unconfigured");
  await expectError(
    "ai.assist.start",
    { segmentId: segments[0].id, action: "translate" },
    "aiNotConfigured",
  );
  log("aiNotConfigured verified before configuration");

  // 2. Configure the real gateway (key stays in engine memory).
  const status = await call("ai.configure", {
    provider,
    model,
    baseUrl,
    apiKey,
  });
  assert(status.configured === true, "gateway configured");
  log(`ai.configure ok: provider=${status.provider} model=${status.model}`);

  // 3. Real assist call on a real segment, polled to terminal.
  const startedAt = Date.now();
  const started = await call("ai.assist.start", {
    segmentId: segments[0].id,
    action: "translate",
  });
  assert(started.status === "running", "assist starts asynchronously");
  const finished = await pollAssist(started.assistId, 90_000);
  const elapsed = Date.now() - startedAt;
  if (finished.status === "done") {
    const result = finished.result;
    log(
      `assist DONE in ${elapsed}ms (provider ${result.elapsedMs}ms): ` +
        `provider=${result.provider} model=${result.model} tagCheck.ok=${result.tagCheck.ok}`,
    );
    log(`suggestion: ${JSON.stringify(result.draftTarget.slice(0, 120))}`);
  } else {
    // Honest failure: report the exact engine error and stop with a
    // non-zero exit. Nothing is fabricated.
    log(
      `assist ${finished.status}: ${finished.errorMessage ?? "(no message)"}`,
    );
    throw new Error(`live assist did not succeed: ${finished.status}`);
  }

  // 4. Cancel path: request a second assist and cancel it immediately.
  const toCancel = await call("ai.assist.start", {
    segmentId: segments[2].id,
    action: "translate",
  });
  const canceled = await call("ai.assist.cancel", {
    assistId: toCancel.assistId,
  });
  assert(canceled.cancelRequested === true, "cancel was requested");
  const cancelView = await pollAssist(toCancel.assistId, 90_000);
  assert(
    cancelView.status === "canceled",
    `canceled run turns terminal as canceled, got ${cancelView.status}`,
  );
  assert(cancelView.result == null, "canceled runs carry no result");
  log("assist cancel path verified (late result discarded)");

  // 5. Agent run on the remaining untranslated segments. It must park at
  // awaitingReview: no confirmations, no sign-off, no export.
  const run = await call("ai.agent.start", {
    documentId: imported.document.id,
    maxSegments: 2,
  });
  log(`agent started: planned=${run.plannedSegments}`);
  let runView = run;
  const runDeadline = Date.now() + 120_000;
  while (runView.status === "running") {
    assert(Date.now() < runDeadline, "agent run finished before the deadline");
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    runView = await call("ai.agent.status", { runId: run.runId });
  }
  log(
    `agent terminal: status=${runView.status} tm=${runView.tmApplied} ` +
      `ai=${runView.aiDrafted} failed=${runView.failedSegments}`,
  );
  assert(
    runView.status === "awaitingReview",
    `agent parks at the human gate, got ${runView.status}`,
  );
  const after = await call("segment.list", {
    documentId: imported.document.id,
  });
  assert(
    after.segments.every((segment) => segment.state !== "confirmed"),
    "the agent never confirmed a segment",
  );
  log("agent parked at awaitingReview; zero confirmations, zero exports");

  await call("engine.shutdown", {});
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  log("LIVE TEST OK");
} catch (error) {
  child.kill();
  // Never echo the raw key, even inside quoted error bodies.
  console.error(String(error).replaceAll(apiKey, "[REDACTED]"));
  process.exitCode = 1;
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
