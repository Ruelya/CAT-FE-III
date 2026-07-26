#!/usr/bin/env node

import { createInterface } from "node:readline";

const descriptor = {
  id: "fixture.crash-filter",
  version: "0.1.0",
  displayName: "Crash Filter Fixture",
  extensions: ["crash"],
  capabilities: {
    import: true,
    export: false,
    validate: false,
    inlineTags: false,
    notes: false,
    degradationReport: false,
  },
};

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "filter.import") {
    process.stderr.write("private fixture stderr must never cross RPC\n");
    process.exit(23);
  }
  const result = dispatch(request.method);
  if (request.id !== undefined) {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
    );
  }
});

function dispatch(method) {
  switch (method) {
    case "plugin.handshake":
      return {
        apiVersion: 1,
        pluginId: "fixture.crash-filter",
        contributions: { filters: [descriptor] },
      };
    case "filter.descriptor":
      return descriptor;
    case "filter.probe":
      return { confidence: 100, reason: "deterministic crash fixture" };
    case "plugin.shutdown":
      setTimeout(() => process.exit(0), 0).unref?.();
      return {};
    default:
      return {};
  }
}
