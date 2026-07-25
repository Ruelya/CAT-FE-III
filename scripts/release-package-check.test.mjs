import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  directorySize,
  findStrayEngineBinaries,
  inspectArtifactEngines,
  inspectEngineResourceDirectory,
  inspectPackagedEngines,
} from "./release-package-check.mjs";

const roots = [];

test.afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("accepts exactly one matching platform and architecture binary", async () => {
  const engineDir = await createEngineDirectory();
  await writeFile(join(engineDir, "translunar-engine.exe"), peFixture(0x8664));

  const result = await inspectEngineResourceDirectory(engineDir, {
    platform: "win32",
    expectedArch: "x64",
  });

  assert.equal(result.name, "translunar-engine.exe");
  assert.equal(result.architecture, "x64");
});

test("rejects an opposite-platform binary even when the expected binary exists", async () => {
  const engineDir = await createEngineDirectory();
  await writeFile(join(engineDir, "translunar-engine.exe"), peFixture(0x8664));
  await writeFile(join(engineDir, "translunar-engine"), Buffer.from("wrong"));

  await assert.rejects(
    inspectEngineResourceDirectory(engineDir, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /must contain exactly one file.*translunar-engine.*translunar-engine\.exe/iu,
  );
});

test("rejects an unknown extra resource and a wrong architecture", async () => {
  const extraDir = await createEngineDirectory();
  await writeFile(join(extraDir, "translunar-engine.exe"), peFixture(0x8664));
  await writeFile(join(extraDir, "README.txt"), "not allowed", "utf8");
  await assert.rejects(
    inspectEngineResourceDirectory(extraDir, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /README\.txt/iu,
  );

  const wrongArchDir = await createEngineDirectory();
  await writeFile(
    join(wrongArchDir, "translunar-engine.exe"),
    peFixture(0xaa64),
  );
  await assert.rejects(
    inspectEngineResourceDirectory(wrongArchDir, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /architecture arm64 does not match expected x64/iu,
  );
});

test("validates every unpacked artifact instead of accepting the first match", async () => {
  const releaseRoot = await createRoot("tl-release-check-");
  const first = join(releaseRoot, "win-unpacked", "resources", "engine");
  const second = join(releaseRoot, "second", "resources", "engine");
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(join(first, "translunar-engine.exe"), peFixture(0x8664));
  await writeFile(join(second, "translunar-engine"), Buffer.from("wrong"));

  await assert.rejects(
    inspectPackagedEngines(releaseRoot, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /invalid binary 'translunar-engine'/iu,
  );
});

test("rejects stray Engine binaries outside resources/engine", async () => {
  const releaseRoot = await createRoot("tl-stray-");
  const sanctioned = join(releaseRoot, "artifact", "resources", "engine");
  const stray = join(releaseRoot, "artifact", "resources", "app");
  await mkdir(sanctioned, { recursive: true });
  await mkdir(stray, { recursive: true });
  await writeFile(join(sanctioned, "translunar-engine.exe"), peFixture(0x8664));
  await writeFile(join(stray, "translunar-engine.exe"), peFixture(0x8664));

  const found = await findStrayEngineBinaries(releaseRoot);
  assert.equal(found.length, 1);
  assert.match(found[0], /resources[\\/]app[\\/]translunar-engine\.exe$/iu);

  await assert.rejects(
    inspectPackagedEngines(releaseRoot, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /outside resources\/engine.*exclusivity/iu,
  );
});

test("rejects Engine-named symlinks outside resources/engine without following them", async (t) => {
  const releaseRoot = await createRoot("tl-stray-link-");
  const sanctioned = join(releaseRoot, "artifact", "resources", "engine");
  const stray = join(releaseRoot, "artifact", "resources", "app");
  await mkdir(sanctioned, { recursive: true });
  await mkdir(stray, { recursive: true });
  await writeFile(join(sanctioned, "translunar-engine.exe"), peFixture(0x8664));
  await writeFile(join(stray, "target.bin"), "not followed", "utf8");
  try {
    await symlink("target.bin", join(stray, "translunar-engine.exe"), "file");
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Windows symlink creation requires additional privilege");
      return;
    }
    throw error;
  }

  const found = await findStrayEngineBinaries(join(releaseRoot, "artifact"));
  assert.equal(found.length, 1);
  assert.match(found[0], /resources[\\/]app[\\/]translunar-engine\.exe$/iu);
  await assert.rejects(
    inspectPackagedEngines(releaseRoot, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /outside resources\/engine.*exclusivity/iu,
  );
});

test("every unpacked artifact must carry its own Engine", async () => {
  const releaseRoot = await createRoot("tl-per-artifact-");
  const first = join(releaseRoot, "valid", "resources", "engine");
  const second = join(releaseRoot, "missing-engine");
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(join(first, "translunar-engine.exe"), peFixture(0x8664));

  const validResult = await inspectArtifactEngines(join(releaseRoot, "valid"), {
    platform: "win32",
    expectedArch: "x64",
  });
  assert.equal(validResult.engines.length, 1);

  await assert.rejects(
    inspectArtifactEngines(second, { platform: "win32", expectedArch: "x64" }),
    /No packaged resources\/engine directory/iu,
  );
});

test("a single unpacked artifact cannot contain multiple resources/engine directories", async () => {
  const artifact = await createRoot("tl-multiple-engine-dirs-");
  const first = join(artifact, "resources", "engine");
  const second = join(artifact, "nested", "resources", "engine");
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(join(first, "translunar-engine.exe"), peFixture(0x8664));
  await writeFile(join(second, "translunar-engine.exe"), peFixture(0x8664));

  await assert.rejects(
    inspectArtifactEngines(artifact, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /exactly one resources\/engine directory; found 2/iu,
  );
});

test("inspectPackagedEngines fails closed when a sibling artifact has no Engine (no masking)", async () => {
  // A valid app directory next to a bare/empty sibling directory. The valid
  // sibling must never mask the Engine-less one; the whole release fails.
  const releaseRoot = await createRoot("tl-mask-bare-");
  const valid = join(releaseRoot, "win-unpacked", "resources", "engine");
  await mkdir(valid, { recursive: true });
  await mkdir(join(releaseRoot, "orphan-unpacked"), { recursive: true });
  await writeFile(join(valid, "translunar-engine.exe"), peFixture(0x8664));

  await assert.rejects(
    inspectPackagedEngines(releaseRoot, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /No packaged resources\/engine directory was found under .*orphan-unpacked/iu,
  );
});

test("inspectPackagedEngines fails closed when a sibling has resources but no engine", async () => {
  const releaseRoot = await createRoot("tl-mask-res-");
  const valid = join(releaseRoot, "win-unpacked", "resources", "engine");
  await mkdir(valid, { recursive: true });
  // Sibling carries a resources tree (locales etc.) but no resources/engine.
  await mkdir(join(releaseRoot, "second", "resources", "locales"), {
    recursive: true,
  });
  await writeFile(join(valid, "translunar-engine.exe"), peFixture(0x8664));

  await assert.rejects(
    inspectPackagedEngines(releaseRoot, {
      platform: "win32",
      expectedArch: "x64",
    }),
    /No packaged resources\/engine directory was found under .*second/iu,
  );
});

test("inspectArtifactEngines validates a single artifact and release inspection ignores dot metadata", async () => {
  // Single artifacts use the explicit single-artifact contract; the release
  // root contract always treats its non-metadata children as artifacts.
  const single = await createRoot("tl-single-artifact-");
  const engineDir = join(single, "resources", "engine");
  await mkdir(engineDir, { recursive: true });
  await mkdir(join(single, "locales"), { recursive: true });
  await writeFile(join(engineDir, "translunar-engine.exe"), peFixture(0x8664));
  const singleResult = await inspectArtifactEngines(single, {
    platform: "win32",
    expectedArch: "x64",
  });
  assert.equal(singleResult.engines.length, 1);

  // A release root with one valid artifact plus a dot-prefixed metadata
  // directory (electron-builder .icon-icns). Metadata is ignored; passes.
  const releaseRoot = await createRoot("tl-dot-meta-");
  const valid = join(releaseRoot, "mac-arm64", "resources", "engine");
  await mkdir(valid, { recursive: true });
  await mkdir(join(releaseRoot, ".icon-icns"), { recursive: true });
  await writeFile(join(valid, "translunar-engine.exe"), peFixture(0x8664));
  const metaResult = await inspectPackagedEngines(releaseRoot, {
    platform: "win32",
    expectedArch: "x64",
  });
  assert.equal(metaResult.length, 1);
});

test("directorySize skips symlinks and does not fail valid macOS .app frameworks", async () => {
  const root = await createRoot("tl-symlink-size-");
  const appDir = join(root, "Translunar.app", "Contents", "Frameworks");
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, "real.txt"), "12345", "utf8");
  try {
    await symlink("real.txt", join(appDir, "link.txt"), "file");
  } catch (error) {
    if (error.code === "EPERM") {
      console.log("# symlink test skipped (Windows without privilege)");
      return;
    }
    throw error;
  }
  const size = await directorySize(join(root, "Translunar.app"));
  assert.equal(size, 5);
});

async function createEngineDirectory() {
  const root = await createRoot("tl-engine-resource-");
  const engineDir = join(root, "artifact", "resources", "engine");
  await mkdir(engineDir, { recursive: true });
  return engineDir;
}

async function createRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function peFixture(machine) {
  const bytes = Buffer.alloc(0x90);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "binary");
  bytes.writeUInt16LE(machine, 0x84);
  return bytes;
}
