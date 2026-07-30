import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps", "desktop", "resources", "plugins");

test("plugin core catalog builds and checks deterministically", () => {
  const build = spawnSync(process.execPath, ["scripts/package-plugins.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.ok(existsSync(join(outDir, "index.json")));
  const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
  assert.equal(index.catalogVersion, 1);
  assert.ok(index.packages.length >= 5);
  for (const pkg of index.packages) {
    assert.match(pkg.packageSha256, /^[0-9a-f]{64}$/);
    assert.match(pkg.archiveSha256, /^[0-9a-f]{64}$/);
    assert.ok(pkg.publisher);
    assert.ok(pkg.license);
    assert.ok(existsSync(join(outDir, pkg.archive)));
  }
  const check = spawnSync(
    process.execPath,
    ["scripts/package-plugins.mjs", "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stderr || check.stdout);
});
