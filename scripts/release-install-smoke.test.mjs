import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  APP_ENGINE_READY_KIND,
  StdioJsonRpcClient,
  macDetachArgs,
  macMountArgs,
  parseAppEngineReadiness,
  selectInstallerArtifact,
  waitForAppEngineReadiness,
  windowsInstallerArgs,
} from "./release-install-smoke-lib.mjs";
import { parsePlatformArg } from "./release-install-smoke.mjs";

test("selects a real installer and rejects unpacked-only output", () => {
  assert.equal(
    selectInstallerArtifact(
      [
        "K:/release/Translunar CAT-win-unpacked/Translunar CAT.exe",
        "K:/release/Translunar CAT Setup 0.1.0.exe",
      ],
      "win32",
    ),
    resolve("K:/release/Translunar CAT Setup 0.1.0.exe"),
  );
  assert.throws(
    () =>
      selectInstallerArtifact(
        ["K:/release/Translunar CAT-win-unpacked/Translunar CAT.exe"],
        "win32",
      ),
    /No NSIS .exe installer artifact/,
  );
  assert.equal(
    selectInstallerArtifact(["/release/Translunar CAT-0.1.0.dmg"], "darwin"),
    resolve("/release/Translunar CAT-0.1.0.dmg"),
  );
});

test("builds native installer and mount command arguments without shell interpolation", () => {
  assert.deepEqual(windowsInstallerArgs("C:/Program Files/Translunar"), [
    "/S",
    `/D=${resolve("C:/Program Files/Translunar")}`,
  ]);
  assert.deepEqual(
    macMountArgs("/tmp/Translunar CAT.dmg", "/tmp/mount point"),
    [
      "attach",
      "/tmp/Translunar CAT.dmg",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      "/tmp/mount point",
    ],
  );
  assert.deepEqual(macDetachArgs("/tmp/mount point"), [
    "detach",
    "/tmp/mount point",
    "-force",
  ]);
  assert.equal(
    parsePlatformArg(["node", "smoke", "--platform", "darwin"]),
    "darwin",
  );
});

test("stdio JSON-RPC framing handles split and out-of-order responses", async () => {
  const root = await mkdtemp(join(tmpdir(), "tl-smoke-rpc-"));
  const script = join(root, "fake-engine.mjs");
  await writeFile(
    script,
    `import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  const delay = request.method === "slow" ? 25 : 1;
  setTimeout(() => {
    const response = JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { method: request.method } }) + "\\n";
    process.stdout.write(response.slice(0, 4));
    setTimeout(() => process.stdout.write(response.slice(4)), 2);
  }, delay);
});
`,
    "utf8",
  );
  const wrapper = join(root, "wrapper.mjs");
  await writeFile(wrapper, `import "${pathToFileURL(script).href}";\n`, "utf8");
  const direct = new StdioJsonRpcClient(wrapper, root);
  await direct.start();
  const [slow, fast] = await Promise.all([
    direct.call("slow", {}),
    direct.call("fast", {}),
  ]);
  assert.deepEqual(slow, { method: "slow" });
  assert.deepEqual(fast, { method: "fast" });
  await direct.stop();
});

test("validates app-owned Engine handshake evidence and rejects stale or unhealthy markers", () => {
  const valid = {
    kind: APP_ENGINE_READY_KIND,
    version: 1,
    appVersion: "0.1.0",
    pid: 42,
    healthy: true,
    schemaVersion: 7,
    readyAtMs: 1_050,
  };
  assert.deepEqual(
    parseAppEngineReadiness(JSON.stringify(valid), {
      startedAtMs: 1_000,
      nowMs: 1_100,
      expectedPid: 42,
    }),
    valid,
  );
  assert.throws(
    () =>
      parseAppEngineReadiness(JSON.stringify({ ...valid, readyAtMs: 999 }), {
        startedAtMs: 1_000,
        nowMs: 1_100,
      }),
    /stale/iu,
  );
  assert.throws(
    () =>
      parseAppEngineReadiness(JSON.stringify({ ...valid, healthy: false }), {
        startedAtMs: 1_000,
        nowMs: 1_100,
      }),
    /unhealthy/iu,
  );
  assert.throws(
    () =>
      parseAppEngineReadiness(JSON.stringify(valid), {
        startedAtMs: 1_000,
        nowMs: 1_100,
        expectedPid: 99,
      }),
    /does not match launched pid/iu,
  );
  assert.throws(
    () =>
      parseAppEngineReadiness("{not-json", {
        startedAtMs: 1_000,
        nowMs: 1_100,
      }),
    /malformed JSON/iu,
  );
});

test("waits for the installed app marker and fails if the app exits first", async () => {
  const root = await mkdtemp(join(tmpdir(), "tl-app-handshake-"));
  const markerPath = join(root, "ready.json");
  const startedAtMs = Date.now();
  const appProcess = { pid: 42, exitCode: null, signalCode: null };
  const write = setTimeout(() => {
    void writeFile(
      markerPath,
      JSON.stringify({
        kind: APP_ENGINE_READY_KIND,
        version: 1,
        appVersion: "0.1.0",
        pid: 42,
        healthy: true,
        schemaVersion: 7,
        readyAtMs: Date.now(),
      }),
      "utf8",
    );
  }, 10);
  try {
    const evidence = await waitForAppEngineReadiness({
      markerPath,
      appProcess,
      startedAtMs,
      timeoutMs: 1_000,
      pollMs: 5,
    });
    assert.equal(evidence.healthy, true);

    await assert.rejects(
      waitForAppEngineReadiness({
        markerPath: join(root, "never.json"),
        appProcess: { exitCode: 1, signalCode: null },
        startedAtMs,
        timeoutMs: 100,
        pollMs: 5,
      }),
      /exited before its Engine handshake marker appeared/iu,
    );
  } finally {
    clearTimeout(write);
    await rm(root, { recursive: true, force: true });
  }
});
