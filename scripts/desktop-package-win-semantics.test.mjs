// Windows-semantics coverage for the packaging scripts and the
// electron-builder win contract, runnable on any host:
//
// - desktop-stage-engine.mjs must stage `tl-engine.exe` (default path and
//   TL_ENGINE_BIN override) when process.platform is win32.
// - desktop-check-package.mjs must look in `win-unpacked/`, require
//   `resources/engine/tl-engine.exe`, require the NSIS installer exe next to
//   it, reject asars whose main/preload modules keep a bare @translunar/*
//   import (node_modules is excluded, so those crash at startup), and skip
//   the POSIX executable-bit check on win32 (still enforcing it elsewhere).
// - electron-builder.yml must keep `extraResources.from` relative (absolute
//   temp paths silently drop the binary on Windows), keep `win.target` on
//   `nsis`, and name the win artifact as a setup executable.
//
// Each script run copies the real script into a sandbox that mimics the
// repo layout (scripts/ next to apps/desktop/, node_modules linked from the
// repo so @electron/asar resolves), then executes it in a child node process
// that pins process.platform to win32 before the module loads.
// Run with: node --test scripts/desktop-package-win-semantics.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

import asar from "@electron/asar";

const repoRoot = resolve(import.meta.dirname, "..");
const sandboxes = [];

// What esbuild-bundled main output looks like: electron stays external,
// workspace code is inlined, no bare @translunar/* specifier remains.
const BUNDLED_MAIN =
  'import { app } from "electron";\nconst PROTOCOL_VERSION = "1";\napp.whenReady();\n';
// What unbundled tsc output looked like: the bare workspace import that
// ERR_MODULE_NOT_FOUNDs inside the asar.
const UNBUNDLED_MAIN =
  'import { PROTOCOL_VERSION } from "@translunar/contracts";\n';

function makeSandbox(scriptName) {
  const sandbox = mkdtempSync(join(tmpdir(), "tl-win-semantics-"));
  sandboxes.push(sandbox);
  mkdirSync(join(sandbox, "scripts"));
  mkdirSync(join(sandbox, "apps", "desktop"), { recursive: true });
  copyFileSync(
    join(repoRoot, "scripts", scriptName),
    join(sandbox, "scripts", scriptName),
  );
  // The copied script resolves its own imports (@electron/asar) by walking
  // up from the sandbox; "junction" keeps this privilege-free on Windows
  // hosts and is ignored on POSIX.
  symlinkSync(
    join(repoRoot, "node_modules"),
    join(sandbox, "node_modules"),
    "junction",
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

// Build a real (minimal) asar so the package check can extract and scan it:
// the bundled main entry where the check expects it, plus package.json.
async function makeAsar(destination, mainSource) {
  const fixture = mkdtempSync(join(tmpdir(), "tl-asar-fixture-"));
  sandboxes.push(fixture);
  mkdirSync(join(fixture, "dist", "electron", "main"), { recursive: true });
  writeFileSync(
    join(fixture, "dist", "electron", "main", "index.js"),
    mainSource,
  );
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify({
      name: "@translunar/desktop",
      main: "dist/electron/main/index.js",
    }),
  );
  mkdirSync(resolve(destination, ".."), { recursive: true });
  await asar.createPackage(fixture, destination);
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
  async function layoutWinUnpacked(
    sandbox,
    { withEngine = true, withInstaller = true, mainSource = BUNDLED_MAIN } = {},
  ) {
    const releaseDir = join(sandbox, "apps", "desktop", "release");
    const resources = join(releaseDir, "win-unpacked", "resources");
    mkdirSync(resources, { recursive: true });
    await makeAsar(join(resources, "app.asar"), mainSource);
    if (withEngine) {
      writeFakeBinary(join(resources, "engine", "tl-engine.exe"));
    }
    if (withInstaller) {
      writeFileSync(
        join(releaseDir, "translunar-cat-setup-0.1.0-x64.exe"),
        "fake nsis installer\n",
      );
    }
    return resources;
  }

  it("accepts win-unpacked plus the NSIS installer exe", async () => {
    const sandbox = makeSandbox("desktop-check-package.mjs");
    await layoutWinUnpacked(sandbox);
    const result = runScript(sandbox, "desktop-check-package.mjs", {
      platform: "win32",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /package check OK/);
    assert.match(result.stdout, /tl-engine\.exe/);
    assert.match(result.stdout, /translunar-cat-setup-0\.1\.0-x64\.exe/);
  });

  it("fails when resources/engine/tl-engine.exe is missing", async () => {
    const sandbox = makeSandbox("desktop-check-package.mjs");
    await layoutWinUnpacked(sandbox, { withEngine: false });
    const result = runScript(sandbox, "desktop-check-package.mjs", {
      platform: "win32",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /packaged engine binary missing/);
    assert.match(result.stderr, /tl-engine\.exe/);
  });

  it("fails when the NSIS installer exe is missing", async () => {
    const sandbox = makeSandbox("desktop-check-package.mjs");
    await layoutWinUnpacked(sandbox, { withInstaller: false });
    const result = runScript(sandbox, "desktop-check-package.mjs", {
      platform: "win32",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /NSIS installer missing/);
    assert.match(result.stderr, /translunar-cat-setup-\*\.exe/);
  });

  it("fails when asar main keeps a bare @translunar/* import", async () => {
    const sandbox = makeSandbox("desktop-check-package.mjs");
    await layoutWinUnpacked(sandbox, { mainSource: UNBUNDLED_MAIN });
    const result = runScript(sandbox, "desktop-check-package.mjs", {
      platform: "win32",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bare package/);
    assert.match(result.stderr, /dist[/\\]electron[/\\]main[/\\]index\.js/);
  });

  it("skips the executable-bit check only on win32", async (t) => {
    if (process.platform === "win32") {
      // POSIX file modes do not exist on a real Windows host, so the
      // differential half of this test has nothing to compare against.
      t.skip();
      return;
    }
    // Same sandbox contents, two platforms: the non-executable engine file
    // passes under win32 semantics and fails under native POSIX semantics.
    const winSandbox = makeSandbox("desktop-check-package.mjs");
    await layoutWinUnpacked(winSandbox);
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
    await makeAsar(join(resources, "app.asar"), BUNDLED_MAIN);
    writeFileSync(join(resources, "engine", "tl-engine"), "fake\n");
    const posix = runScript(posixSandbox, "desktop-check-package.mjs");
    assert.notEqual(posix.status, 0);
    assert.match(posix.stderr, /not executable/);
  });
});

describe("electron-builder.yml Windows contract", () => {
  // Windows runners check out with CRLF; normalize so the contract regexes
  // pin YAML structure rather than the host's line endings.
  const config = readFileSync(
    join(repoRoot, "apps", "desktop", "electron-builder.yml"),
    "utf8",
  ).replace(/\r\n/g, "\n");

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

  it("keeps the win target on nsis (installer deliverable)", () => {
    assert.match(config, /^win:\n\s+target:\n\s+- nsis$/m);
    const crlfCheckout = config.replace(/\n/g, "\r\n");
    assert.match(
      crlfCheckout.replace(/\r\n/g, "\n"),
      /^win:\n\s+target:\n\s+- nsis$/m,
    );
  });

  it("names the win artifact as a setup executable", () => {
    assert.match(
      config,
      /artifactName: translunar-cat-setup-\$\{version\}-\$\{arch\}\.\$\{ext\}/,
    );
  });
});
