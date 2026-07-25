import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectElectronInstall,
  runCommandWithTimeout,
} from "./check-electron-install.mjs";

test("validates a complete repaired Electron dependency chain", async () => {
  const root = await createElectronFixture();
  try {
    const result = await inspectElectronInstall(root);
    assert.equal(result.electronVersion, "41.10.3");
    assert.equal(result.getVersion, "5.0.0");
    assert.equal(result.extractZipVersion, "1.0.4");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves the repaired dependency chain through a pnpm package link", async () => {
  const fixture = await createPnpmLinkedElectronFixture();
  try {
    const result = await inspectElectronInstall(fixture.packageRoot);
    assert.equal(result.getVersion, "5.0.0");
    assert.equal(result.extractZipVersion, "1.0.4");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects an incomplete Electron runtime inventory", async () => {
  const root = await createElectronFixture({ includeDefaultApp: false });
  try {
    await assert.rejects(
      inspectElectronInstall(root),
      /default_app\.asar is missing/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an Electron executable path outside the package", async () => {
  const root = await createElectronFixture();
  try {
    await writeFile(join(root, "path.txt"), "../../outside-electron.exe\n");
    await assert.rejects(
      inspectElectronInstall(root),
      /resolves outside the Electron package/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an extractor older than the glibc repair", async () => {
  const root = await createElectronFixture({ extractVersion: "1.0.3" });
  try {
    await assert.rejects(
      inspectElectronInstall(root),
      /1\.0\.4 or newer.*1\.0\.3/isu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an extractor prerelease at the minimum stable version", async () => {
  const root = await createElectronFixture({ extractVersion: "1.0.4-rc.1" });
  try {
    await assert.rejects(
      inspectElectronInstall(root),
      /1\.0\.4 or newer.*1\.0\.4-rc\.1/isu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces a hard timeout for executable probes", async () => {
  await assert.rejects(
    runCommandWithTimeout(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      100,
    ),
    /timed out after 100ms/iu,
  );
});

async function createElectronFixture(options = {}) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "tl-electron-integrity-"));
  const dist = join(fixtureRoot, "dist");
  const getRoot = join(fixtureRoot, "node_modules", "@electron", "get");
  const extractRoot = join(
    fixtureRoot,
    "node_modules",
    "@electron-internal",
    "extract-zip",
  );
  await mkdir(join(dist, "resources"), { recursive: true });
  await mkdir(getRoot, { recursive: true });
  await mkdir(extractRoot, { recursive: true });
  await writeFile(
    join(fixtureRoot, "package.json"),
    JSON.stringify({ name: "electron", version: "41.10.3" }),
  );
  await writeFile(join(fixtureRoot, "path.txt"), "electron.exe\n");
  await writeFile(join(dist, "electron.exe"), "fixture", { mode: 0o755 });
  if (options.includeDefaultApp !== false) {
    await writeFile(join(dist, "resources", "default_app.asar"), "fixture");
  }
  await writeFile(
    join(getRoot, "package.json"),
    JSON.stringify({ name: "@electron/get", version: "5.0.0" }),
  );
  await writeFile(
    join(extractRoot, "package.json"),
    JSON.stringify({
      name: "@electron-internal/extract-zip",
      version: options.extractVersion ?? "1.0.4",
    }),
  );
  return fixtureRoot;
}

async function createPnpmLinkedElectronFixture() {
  const root = await mkdtemp(join(tmpdir(), "tl-electron-pnpm-link-"));
  const virtualModules = join(
    root,
    "node_modules",
    ".pnpm",
    "electron@41.10.3",
    "node_modules",
  );
  const physicalPackageRoot = join(virtualModules, "electron");
  const packageRoot = join(root, "apps", "desktop", "node_modules", "electron");
  const dist = join(physicalPackageRoot, "dist");
  await mkdir(join(dist, "resources"), { recursive: true });
  await mkdir(join(virtualModules, "@electron", "get"), { recursive: true });
  await mkdir(join(virtualModules, "@electron-internal", "extract-zip"), {
    recursive: true,
  });
  await mkdir(join(packageRoot, ".."), { recursive: true });
  await writeFile(
    join(physicalPackageRoot, "package.json"),
    JSON.stringify({ name: "electron", version: "41.10.3" }),
  );
  await writeFile(join(physicalPackageRoot, "path.txt"), "electron.exe\n");
  await writeFile(join(dist, "electron.exe"), "fixture", { mode: 0o755 });
  await writeFile(join(dist, "resources", "default_app.asar"), "fixture");
  await writeFile(
    join(virtualModules, "@electron", "get", "package.json"),
    JSON.stringify({ name: "@electron/get", version: "5.0.0" }),
  );
  await writeFile(
    join(virtualModules, "@electron-internal", "extract-zip", "package.json"),
    JSON.stringify({
      name: "@electron-internal/extract-zip",
      version: "1.0.4",
    }),
  );
  await symlink(
    physicalPackageRoot,
    packageRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  return { packageRoot, root };
}
