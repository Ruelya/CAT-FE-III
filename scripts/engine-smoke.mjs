// End-to-end smoke of the tl-engine stdio protocol: handshake, project,
// DOCX import, grid edit/confirm, exact TM, number QA, export, and the
// honest AI degradation path. Run with: pnpm test:e2e:engine
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";

const root = resolve(import.meta.dirname, "..");
const binary =
  process.env.TL_ENGINE_BIN ??
  join(
    root,
    "target",
    "debug",
    process.platform === "win32" ? "tl-engine.exe" : "tl-engine",
  );
const fixture = join(root, "fixtures", "docx", "m0-source.docx");

if (!existsSync(binary)) {
  throw new Error(
    `engine binary not found: ${binary} (run cargo build -p tl-engine)`,
  );
}
if (!existsSync(fixture)) {
  throw new Error(`DOCX fixture not found: ${fixture}`);
}

const dataDir = mkdtempSync(join(tmpdir(), "tl-engine-smoke-"));
const outputPath = join(dataDir, "translated.docx");

const child = spawn(binary, ["--data-dir", join(dataDir, "data")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let nextId = 1;
const pending = new Map();
const notifications = [];
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
    if (frame.kind === "notification") {
      notifications.push(frame);
      continue;
    }
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
      30_000,
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

try {
  // Handshake.
  const ready = await call("engine.initialize", {
    protocolVersion: 1,
    clientName: "engine-smoke",
    clientVersion: "0",
  });
  assert(ready.engineName === "tl-engine", "engine name");
  assert(ready.capabilities.filters.includes("builtin.docx"), "docx filter");
  assert(
    notifications.some((frame) => frame.method === "notify.engine.ready"),
    "ready notification emitted",
  );

  // Project + import.
  const project = await call("project.create", {
    name: "Smoke",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
  });
  const imported = await call("document.import", {
    projectId: project.id,
    sourcePath: fixture,
  });
  assert(imported.segmentCount > 0, "segments imported");

  // Edit + confirm + TM.
  const { segments } = await call("segment.list", {
    documentId: imported.document.id,
  });
  const first = segments[0];
  const updated = await call("segment.update", {
    segmentId: first.id,
    targetText: "冒烟测试译文。",
    baseRevision: first.revision,
  });
  const confirmed = await call("segment.confirm", {
    segmentId: first.id,
    baseRevision: updated.segment.revision,
  });
  assert(confirmed.segment.state === "confirmed", "segment confirmed");
  const lookup = await call("tm.lookup", {
    projectId: project.id,
    sourceText: first.sourceText,
  });
  assert(
    lookup.matches.length === 1 && lookup.matches[0].score === 100,
    "exact TM hit",
  );

  // Number QA catches a wrong number.
  const numeric = segments.find((segment) => /\d/.test(segment.sourceText));
  if (numeric && numeric.id !== first.id) {
    await call("segment.update", {
      segmentId: numeric.id,
      targetText: "错误数字 987654。",
      baseRevision: numeric.revision,
    });
  }
  const qa = await call("qa.run", { documentId: imported.document.id });
  assert(qa.openIssues >= 1, "number QA finds the mismatch");

  // Export.
  const exported = await call("document.export", {
    documentId: imported.document.id,
    outputPath,
  });
  assert(existsSync(outputPath), "export file exists");
  assert(statSync(outputPath).size > 0, "export file is not empty");
  assert(exported.translatedSegments >= 1, "translated units exported");

  // Honest AI degradation without a key.
  const aiStatus = await call("ai.status", {});
  assert(aiStatus.configured === false, "AI unconfigured by default");
  await expectError(
    "ai.assist",
    { segmentId: first.id, action: "translate" },
    "aiNotConfigured",
  );
  await expectError(
    "ai.agent.run",
    { documentId: imported.document.id },
    "aiNotConfigured",
  );

  // Clean shutdown.
  await call("engine.shutdown", {});
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  console.log(
    "engine-smoke OK — handshake, vertical slice, QA, export, honest AI degradation",
  );
} catch (error) {
  child.kill();
  console.error(String(error));
  process.exitCode = 1;
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
