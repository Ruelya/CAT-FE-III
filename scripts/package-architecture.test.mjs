import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  crossPlatformPackagingError,
  detectExecutableArch,
  expectedEngineBinaryName,
  normalizeArch,
} from "./package-architecture.mjs";

test("normalizes common runner architecture names", () => {
  assert.equal(normalizeArch("AMD64"), "x64");
  assert.equal(normalizeArch("aarch64"), "arm64");
  assert.equal(normalizeArch("i686"), "ia32");
});

test("detects PE machine architecture", () => {
  assert.equal(detectExecutableArch(peFixture(0x8664), "win32"), "x64");
  assert.equal(detectExecutableArch(peFixture(0xaa64), "win32"), "arm64");
});

test("detects thin Mach-O and rejects universal binaries for host-only packaging", () => {
  assert.equal(detectExecutableArch(machFixture(0x01000007), "darwin"), "x64");
  assert.equal(
    detectExecutableArch(machFixture(0x0100000c), "darwin"),
    "arm64",
  );
  const universal = Buffer.alloc(8);
  universal.writeUInt32BE(0xcafebabe, 0);
  assert.equal(detectExecutableArch(universal, "darwin"), "universal");
});

test("detects ELF architecture and platform binary names", () => {
  assert.equal(detectExecutableArch(elfFixture(62), "linux"), "x64");
  assert.equal(detectExecutableArch(elfFixture(183), "linux"), "arm64");
  assert.equal(expectedEngineBinaryName("win32"), "translunar-engine.exe");
  assert.equal(expectedEngineBinaryName("darwin"), "translunar-engine");
});

test("electron-builder consumes only the isolated verified Engine resource directory", async () => {
  const config = await readFile(
    resolve("apps/desktop/electron-builder.yml"),
    "utf8",
  );
  assert.match(config, /\$\{env\.TRANSLUNAR_ENGINE_RESOURCE_DIR\}/u);
  assert.doesNotMatch(config, /from:\s*\.\.\/\.\.\/target\/release/iu);
});

test("rejects cross-platform packaging targets and allows host and dir builds", () => {
  // --win only on Windows, --mac only on macOS.
  assert.match(
    crossPlatformPackagingError("win", "darwin"),
    /--win.*not supported/iu,
  );
  assert.match(
    crossPlatformPackagingError("win", "linux"),
    /--win.*not supported/iu,
  );
  assert.match(
    crossPlatformPackagingError("mac", "win32"),
    /--mac.*not supported/iu,
  );
  assert.match(
    crossPlatformPackagingError("mac", "linux"),
    /--mac.*not supported/iu,
  );
  // Matching host and the host-neutral dir target are allowed (null).
  assert.equal(crossPlatformPackagingError("win", "win32"), null);
  assert.equal(crossPlatformPackagingError("mac", "darwin"), null);
  assert.equal(crossPlatformPackagingError("dir", "win32"), null);
  assert.equal(crossPlatformPackagingError("dir", "darwin"), null);
  assert.equal(crossPlatformPackagingError("dir", "linux"), null);
});

function peFixture(machine) {
  const bytes = Buffer.alloc(0x90);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "binary");
  bytes.writeUInt16LE(machine, 0x84);
  return bytes;
}

function machFixture(cpuType) {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpuType, 4);
  return bytes;
}

function elfFixture(machine) {
  const bytes = Buffer.alloc(20);
  bytes.set([0x7f, 0x45, 0x4c, 0x46], 0);
  bytes[5] = 1;
  bytes.writeUInt16LE(machine, 18);
  return bytes;
}
