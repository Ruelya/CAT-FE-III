import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const declarativeRoot = resolve(
  root,
  "examples",
  "plugins",
  "connector-openai-compatible",
);
const executableRoot = resolve(
  root,
  "examples",
  "plugins",
  "connector-handler-fixture",
);
const executablePath = resolve(executableRoot, "bin", "connector-fixture.mjs");

test("official connector examples exercise the public local contract", async (t) => {
  const [declarativeManifest, executableManifest, executableSource] =
    await Promise.all([
      readJson(resolve(declarativeRoot, "manifest.json")),
      readJson(resolve(executableRoot, "manifest.json")),
      readFile(resolve(executableRoot, "src", "index.ts"), "utf8"),
    ]);

  assert.equal(declarativeManifest.runtime.tier, "declarative");
  assert.equal(
    declarativeManifest.contributions[0]?.protocol,
    "translunar.engineConnector.v1",
  );
  assert.deepEqual(
    declarativeManifest.capabilities.find(
      (request) => request.capabilityId === "network.connect",
    )?.scope.origins,
    ["http://127.0.0.1:43123"],
  );
  assert.equal(executableManifest.runtime.tier, "process");
  assert.match(executableSource, /from "@translunar\/plugin-sdk"/u);
  assert.doesNotMatch(
    executableSource,
    /(?:crates\/|packages\/contracts|packages\/plugin-sdk\/src|apps\/desktop)/u,
  );

  const publicSdk = await loadPublicSdk();
  t.after(publicSdk.close);
  for (const manifest of [declarativeManifest, executableManifest]) {
    const normalized = publicSdk.module.normalizeManifest(manifest);
    assert.deepEqual(
      publicSdk.module.validateNormalizedManifest(normalized),
      [],
    );
    assert.equal(
      publicSdk.module.compatibilityForManifest(normalized).compatible,
      true,
    );
  }

  await runBuild();
  const server = await startFixtureServer();
  const plugin = startPlugin();
  t.after(async () => {
    await plugin.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  });

  await t.test("handshake and closed non-generation operations", async () => {
    const handshake = await plugin.call("plugin.handshake", {});
    assert.equal(handshake.pluginId, executableManifest.id);
    assert.equal(
      handshake.contributions[0]?.id,
      "example.connector-handler-fixture.chat",
    );
    const validation = await plugin.call("connector.validateConfig", {
      request: connectorRequest("validateConfig", "validate-1", {
        scenario: "success",
      }),
    });
    assert.deepEqual(validation, { valid: true, issues: [] });
    const invalid = await plugin.call("connector.validateConfig", {
      request: connectorRequest("validateConfig", "validate-2", {
        scenario: "not-a-scenario",
      }),
    });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.issues.length > 0);

    const tested = await plugin.call("connector.test", {
      request: connectorRequest("test", "test-1", { scenario: "success" }),
      credential: "fixture-secret",
    });
    assert.deepEqual(tested, { ok: true, latencyMs: 0 });
    const models = await plugin.call("connector.models.list", {
      request: connectorRequest("models.list", "models-1", {
        scenario: "success",
      }),
      credential: "fixture-secret",
    });
    assert.deepEqual(models.models, [
      { id: "fixture-translate-1", displayName: "Fixture Translate 1" },
    ]);
  });

  await t.test(
    "success streams ordered text, usage, and completion",
    async () => {
      const start = plugin.notifications.length;
      await plugin.call("connector.generate", {
        request: connectorRequest("generate", "generate-success", {
          scenario: "success",
        }),
        credential: "fixture-secret",
      });
      const events = plugin.notifications
        .slice(start)
        .map((item) => item.params);
      assert.deepEqual(
        events.map((event) => [event.kind, event.sequence]),
        [
          ["delta", 0],
          ["delta", 1],
          ["usage", 2],
          ["completed", 3],
        ],
      );
      assert.equal(
        events
          .filter((event) => event.kind === "delta")
          .map((event) => event.text)
          .join(""),
        "Bonjour",
      );
      assert.deepEqual(events.at(-1)?.result.usage, {
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      });
    },
  );

  await t.test("authentication and rate limit failures are typed", async () => {
    await assert.rejects(
      plugin.call("connector.generate", {
        request: connectorRequest("generate", "generate-auth", {
          scenario: "success",
        }),
      }),
      (error) => error.failure?.code === "authentication",
    );
    await assert.rejects(
      plugin.call("connector.generate", {
        request: connectorRequest("generate", "generate-rate", {
          scenario: "rateLimit",
        }),
        credential: "fixture-secret",
      }),
      (error) =>
        error.failure?.code === "rateLimit" &&
        error.failure?.retryable === true &&
        error.failure?.retryAfterMs === 1000,
    );
  });

  await t.test("malformed response and deadline fail closed", async () => {
    await assert.rejects(
      plugin.call("connector.generate", {
        request: connectorRequest("generate", "generate-malformed", {
          scenario: "malformed",
        }),
        credential: "fixture-secret",
      }),
      (error) => error.failure?.code === "protocol",
    );
    await assert.rejects(
      plugin.call("connector.generate", {
        request: {
          ...connectorRequest("generate", "generate-timeout", {
            scenario: "timeout",
          }),
          deadlineMs: 50,
        },
        credential: "fixture-secret",
      }),
      (error) => error.failure?.code === "timeout",
    );
  });

  await t.test("cancel aborts only the selected active request", async () => {
    const generation = plugin.call("connector.generate", {
      request: connectorRequest("generate", "generate-cancel", {
        scenario: "timeout",
      }),
      credential: "fixture-secret",
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    await plugin.call("connector.cancel", {
      contractVersion: 1,
      requestId: "generate-cancel",
    });
    await assert.rejects(
      generation,
      (error) => error.failure?.code === "cancelled",
    );

    const healthy = await plugin.call("connector.test", {
      request: connectorRequest("test", "test-after-cancel", {
        scenario: "success",
      }),
      credential: "fixture-secret",
    });
    assert.equal(healthy.ok, true);
  });
});

function connectorRequest(operation, requestId, config) {
  const common = {
    operation,
    contractVersion: 1,
    requestId,
    config,
    deadlineMs: 2000,
  };
  if (operation === "test") {
    return { ...common, sourceLocale: "en", targetLocale: "fr" };
  }
  if (operation === "models.list") {
    return { ...common, limit: 10 };
  }
  if (operation === "generate") {
    return {
      ...common,
      sourceLocale: "en",
      targetLocale: "fr",
      sourceText: "Hello",
      messages: [{ role: "user", content: "Hello" }],
      model: "fixture-translate-1",
    };
  }
  return common;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runBuild() {
  const child = spawn(process.execPath, [
    resolve(root, "scripts", "build-connector-examples.mjs"),
  ]);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolveExit) =>
    child.once("exit", resolveExit),
  );
  assert.equal(code, 0, stderr);
}

async function loadPublicSdk() {
  const fixtureRoot = await mkdtemp(
    join(tmpdir(), "translunar-connector-sdk-"),
  );
  const outputPath = resolve(fixtureRoot, "plugin-sdk.mjs");
  const requireFromSdk = createRequire(
    resolve(root, "packages", "plugin-sdk", "package.json"),
  );
  const { build } = requireFromSdk("esbuild");
  await build({
    entryPoints: [resolve(root, "packages", "plugin-sdk", "src", "index.ts")],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "none",
    logLevel: "silent",
  });
  return {
    module: await import(pathToFileURL(outputPath).href),
    close: () => rm(fixtureRoot, { recursive: true, force: true }),
  };
}

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const authorization = request.headers.authorization;
    if (authorization !== "Bearer fixture-secret") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const scenario = request.headers["x-fixture-scenario"] ?? "success";
    if (scenario === "rateLimit") {
      response.writeHead(429, { "retry-after": "1" });
      response.end();
      return;
    }
    if (scenario === "timeout") {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      if (response.destroyed) return;
    }
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [{ id: "fixture-translate-1", object: "model" }],
        }),
      );
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404);
      response.end();
      return;
    }
    await readBoundedBody(request);
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    if (scenario === "malformed") {
      response.end("data: {not-json}\n\n");
      return;
    }
    const frames = [
      { choices: [{ delta: { content: "Bon" } }] },
      { choices: [{ delta: { content: "jour" } }] },
      {
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      },
    ];
    for (const frame of frames) {
      response.write(`data: ${JSON.stringify(frame)}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(43123, "127.0.0.1", resolveListen);
  });
  return server;
}

async function readBoundedBody(request) {
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error("fixture request is oversized");
  }
}

function startPlugin() {
  const child = spawn(process.execPath, [executablePath], {
    cwd: executableRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  const notifications = [];
  let nextId = 1;
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "connector.event") {
      notifications.push(message);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message);
      error.failure = message.error.data;
      waiter.reject(error);
    } else {
      waiter.resolve(message.result);
    }
  });
  return {
    notifications,
    call(method, params) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolveCall, rejectCall) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectCall(new Error(`timed out waiting for ${method}: ${stderr}`));
        }, 5000);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timeout);
            resolveCall(value);
          },
          reject(error) {
            clearTimeout(timeout);
            rejectCall(error);
          },
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
    },
    async close() {
      try {
        await this.call("plugin.shutdown", {});
      } catch {
        // Process teardown below is authoritative for a failed fixture.
      }
      lines.close();
      if (child.exitCode === null) child.kill();
      await new Promise((resolveExit) => {
        if (child.exitCode !== null) resolveExit();
        else child.once("exit", resolveExit);
      });
      assert.equal(stderr, "");
    },
  };
}
