// Windows-semantics coverage for the packaging scripts and the
// electron-builder win contract, runnable on any host:
//
// - desktop-stage-engine.mjs must stage `tl-engine.exe` (default path and
//   TL_ENGINE_BIN override) when process.platform is win32.
// - desktop-check-package.mjs must look in `win-unpacked/`, require
//   `resources/engine/tl-engine.exe`, and skip the POSIX executable-bit
//   check on win32 (and still enforce it elsewhere).
// - electron-builder.yml must keep `extraResources.from` relative (absolute
//   temp paths silently drop the binary on Windows) and keep `win.target`
//   on `dir`.
//
// Each script run copies the real script into a sandbox that mimics the
// repo layout (scripts/ next to apps/desktop/), then executes it in a child
// node process that pins process.platform to win32 before the module loads.
// Run with: node --test scripts/desktop-package-win-semantics.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const sandboxes = [];

function makeSandbox(scriptName) {
  const sandbox = mkdtempSync(join(tmpdir(), "tl-win-semantics-"));
  sandboxes.push(sandbox);
  mkdirSync(join(sandbox, "scripts"));
  mkdirSync(join(sandbox, "apps", "desktop"), { recursive: true });
  copyFileSync(
    join(repoRoot, "scripts", scriptName),
    join(sandbox, "scripts", scriptName),
  );
  return sandbox;
}

function runScript(sandbox, scriptName, { platform, env = {} } = {}) {
  const scriptUrl = pathToFileURL(join(sandbox, "scripts", scriptName)).href;
  const preamble = platform
    ? `Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });`
    : "";
  const childEnv = { ...process.env, ...env };
  delete childEnv.TL_ENGINE_BIN;
  Object.assign(childEnv, env);
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `${preamble}await import(${JSON.stringify(scriptUrl)});`,
    ],
    { encoding: "utf8", env: childEnv },
  );
}

function writeFakeBinary(path) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  // Deliberately created without the executable bit so the win32 check can
  // prove it skips the POSIX permission test.
  writeFileSync(path, "fake engine binary\n");
}

after(() => {
  for (const sandbox of sandboxes) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

describe("desktop-stage-engine.mjs on win32", () => {
  it("stages tl-engine.exe from the default target/release path", () => {
    const sandbox = makeSandbox("desktop-stage-engine.mjs");
    writeFakeBinary(join(sandbox, "target", "release", "tl-engine.exe"));
    const result = runScript(sandbox, "desktop-stage-engine.mjs", {
      platform: "win32",
    });
    assert.equal(result.status, 0, result.stderr);
    const staged = join(sandbox, "apps", "desktop", ".package-engine");
    assert.equal(
      readFileSync(join(staged, "tl-engine.exe"), "utf8"),
      "fake engine binary\n",
    );
  });

  it("honors the TL_ENGINE_BIN override", () => {
    const sandbox = makeSandbox("desktop-stage-engine.mjs");
    const override = join(sandbox, "elsewhere", "custom-engine.exe");
    writeFakeBinary(override);
    const result = runScript(sandbox, "desktop-stage-engine.mjs", {
      platform: "win32",
      env: { TL_ENGINE_BIN: override },
    });
    assert.equal(result.status, 0, result.stderr);
    // The staged name stays tl-engine.exe regardless of the override's name:
    // that is the packaged-main lookup contract.
    assert.equal(
      readFileSync(
        join(sandbox, "apps", "desktop", ".package-engine", "tl-engine.exe"),
        "utf8",
      ),
      "fake engine binary\n",
    );
  });

  it("fails with the .exe name when the release binary is missing", () => {
    const sandbox = makeSandbox("desktop-stage-engine.mjs");
    const result = runScript(sandbox, "desktop-stage-engine.mjs", {
      platform: "win32",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tl-engine\.exe/);
    assert.match(result.stderr, /engine binary not found/);
  });
});

describe("desktop-check-package.mjs on win32", () => {
  function layoutWinUnpacked(sandbox, { withEngine = true } = {}) {
    const resources = join(
      sandbox,
      "apps",
      "desktop",
      "release",
      "win-unpacked",
      "resources",
    );
    mkdirSync(resources, { recursive: true });
    writeFileSync(join(resources, "app.asar"), "asar");
    if (withEngine) {
      writeFakeBinary(join(resources, "engine", "tl-engine.exe"));
    }
    return resources;
  }

  it("accepts win-unpacked with app.asar and tl-engine.exe", () => {
    const sandbox = makeSandbox("desktop-check-package.mjs");
    layoutWinUnpacked(sandbox);
    const result = runScript(sandbox, "desktop-check-package.mjs", {
      platform: "win32",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /package check OK/);
    assert.match(result.stdout, /tl-engine\.exe/);
  });

  it("fails when resources/engine/tl-engine.exe is missing", () => {
    const sandbox = makeSandbox("desktop-check-package.mjs");
    layoutWinUnpacked(sandbox, { withEngine: false });
    const result = runScript(sandbox, "desktop-check-package.mjs", {
      platform: "win32",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /packaged engine binary missing/);
    assert.match(result.stderr, /tl-engine\.exe/);
  });

  it("skips the executable-bit check only on win32", (t) => {
    if (process.platform === "win32") {
      // POSIX file modes do not exist on a real Windows host, so the
      // differential half of this test has nothing to compare against.
      t.skip();
      return;
    }
    // Same sandbox contents, two platforms: the non-executable engine file
    // passes under win32 semantics and fails under native POSIX semantics.
    const winSandbox = makeSandbox("desktop-check-package.mjs");
    layoutWinUnpacked(winSandbox);
    const win = runScript(winSandbox, "desktop-check-package.mjs", {
      platform: "win32",
    });
    assert.equal(win.status, 0, win.stderr);

    const posixSandbox = makeSandbox("desktop-check-package.mjs");
    const resources = join(
      posixSandbox,
      "apps",
      "desktop",
      "release",
      "linux-unpacked",
      "resources",
    );
    mkdirSync(join(resources, "engine"), { recursive: true });
    writeFileSync(join(resources, "app.asar"), "asar");
    writeFileSync(join(resources, "engine", "tl-engine"), "fake\n");
    const posix = runScript(posixSandbox, "desktop-check-package.mjs");
    assert.notEqual(posix.status, 0);
    assert.match(posix.stderr, /not executable/);
  });
});

describe("electron-builder.yml Windows contract", () => {
  const config = readFileSync(
    join(repoRoot, "apps", "desktop", "electron-builder.yml"),
    "utf8",
  );

  it("maps a relative staging dir to resources/engine", () => {
    const match = config.match(
      /extraResources:\s*\n\s*- from: (?<from>\S+)\s*\n\s+to: (?<to>\S+)/,
    );
    assert.ok(match, "extraResources from/to mapping present");
    // electron-builder joins `from` against the project directory; absolute
    // paths (POSIX or drive-letter) silently drop the binary on Windows.
    assert.equal(match.groups.from, ".package-engine/");
    assert.doesNotMatch(match.groups.from, /^([A-Za-z]:|[\\/])/);
    assert.equal(match.groups.to, "engine");
  });

  it("keeps the win target on dir (unsigned unpacked output)", () => {
    assert.match(config, /^win:\n\s+target:\n\s+- dir$/m);
  });
});
