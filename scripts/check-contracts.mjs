import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "translunar-contracts-"));
const schema = join(temporary, "protocol.schema.json");
const types = join(temporary, "protocol.generated.ts");
const committedSchema = join(
  root,
  "packages",
  "contracts",
  "src",
  "protocol.schema.json",
);
const committedTypes = join(
  root,
  "packages",
  "contracts",
  "src",
  "protocol.generated.ts",
);
const pnpm = process.platform === "win32" ? "cmd.exe" : "pnpm";
const pnpmPrefix = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd"] : [];

try {
  run("cargo", [
    "run",
    "-q",
    "-p",
    "translunar-protocol",
    "--bin",
    "export-schema",
    "--",
    schema,
  ]);
  run(pnpm, [
    ...pnpmPrefix,
    "--filter",
    "@translunar/contracts",
    "exec",
    "json2ts",
    "-i",
    schema,
    "-o",
    types,
    "--bannerComment",
    "/* eslint-disable -- Generated from the Rust protocol schema. Do not edit. */",
  ]);
  assertSame(committedSchema, schema, "Rust JSON schema");
  assertSame(committedTypes, types, "generated TypeScript contracts");
  console.log("Protocol contracts are current.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
}

function assertSame(committed, generated, label) {
  const expected = readFileSync(committed, "utf8").replaceAll("\r\n", "\n");
  const actual = readFileSync(generated, "utf8").replaceAll("\r\n", "\n");
  if (expected !== actual) {
    console.error(`${label} is stale. Run pnpm contracts:generate.`);
    process.exitCode = 1;
  }
}
