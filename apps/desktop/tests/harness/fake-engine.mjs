#!/usr/bin/env node
// Minimal stand-in for tl-engine used by the engine-supervisor unit tests.
// Speaks the same JSONL stdio protocol and is driven by marker files inside
// the --data-dir the supervisor passes:
//
//   crash-on-start  exit(1) immediately (spawn storm -> restart budget)
//   reject-init     answer engine.initialize with an error but stay alive
//
// Methods: engine.initialize, engine.shutdown, echo (returns params), and
// exit.now (dies without responding, simulating a mid-request crash).

import { existsSync } from "node:fs";
import { join } from "node:path";

const dataDirIndex = process.argv.indexOf("--data-dir");
const dataDir = dataDirIndex >= 0 ? process.argv[dataDirIndex + 1] : ".";

if (existsSync(join(dataDir, "crash-on-start"))) {
  process.exit(1);
}

function send(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (line) {
      handle(JSON.parse(line));
    }
  }
});

function handle(request) {
  const { id, method, params } = request;
  switch (method) {
    case "engine.initialize":
      if (existsSync(join(dataDir, "reject-init"))) {
        send({
          kind: "response",
          id,
          error: {
            code: "protocolMismatch",
            message: "fake engine rejects initialize",
          },
        });
        return;
      }
      send({
        kind: "notification",
        method: "notify.engine.ready",
        params: { engineVersion: "0.0.0-fake" },
      });
      send({ kind: "response", id, result: { engineVersion: "0.0.0-fake" } });
      return;
    case "echo":
      send({ kind: "response", id, result: params ?? null });
      return;
    case "exit.now":
      process.exit(1);
      return;
    case "engine.shutdown":
      send({ kind: "response", id, result: {} });
      process.exit(0);
      return;
    default:
      send({
        kind: "response",
        id,
        error: { code: "notFound", message: `unknown method ${method}` },
      });
  }
}
