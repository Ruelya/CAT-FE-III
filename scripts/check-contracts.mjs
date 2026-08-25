// Verify the committed TypeScript contracts match the Rust protocol schema.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "tl-contracts-"));
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
const pnpmPrefix =
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd"] : [];

try {
  run("cargo", [
    "run",
    "-q",
    "-p",
    "tl-protocol",
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
  compare(committedSchema, schema, "protocol.schema.json");
  compare(committedTypes, types, "protocol.generated.ts");
  console.log(
    "contracts:check OK — committed contracts match the Rust protocol",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`command failed: ${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function compare(committedPath, generatedPath, label) {
  const committed = readFileSync(committedPath, "utf8");
  const generated = readFileSync(generatedPath, "utf8");
  if (committed !== generated) {
    console.error(
      `${label} is stale. Run \`pnpm contracts:generate\` and commit the result.`,
    );
    process.exit(1);
  }
}
