#!/usr/bin/env node
/**
 * Hard package gates:
 * - measured artifact directory/file ≤ 200 MB
 * - required Engine binary present under resources/engine
 * - Engine binary name matches the host platform
 * - TRANSLUNAR_PACKAGE_ARCH (when set) matches process.arch
 * - optional readiness deadline helper for install smoke
 */
import { readFile, readdir, lstat, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectExecutableArch,
  expectedEngineBinaryName,
  normalizeArch,
} from "./package-architecture.mjs";

export const MAX_BYTES = 200 * 1024 * 1024;
const root = resolve(process.cwd());
const releaseDir = resolve(
  root,
  process.env.TRANSLUNAR_RELEASE_DIR ?? "apps/desktop/release",
);

export async function directorySize(path) {
  const info = await lstat(path);
  // Internal symlinks (for example the versioned-framework links inside every
  // real macOS .app bundle) are never followed and contribute no measured
  // bytes. They are a legitimate part of a valid app, so they must not fail the
  // size gate; the Engine-exclusivity walk below still rejects symlinks inside
  // its own resources/engine scope.
  if (info.isSymbolicLink()) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    total += await directorySize(join(path, entry.name));
  }
  return total;
}

export async function releaseArtifacts(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const ignored = new Set(["install-smoke-evidence.json", "macos-min-os.txt"]);
  const artifacts = entries
    .filter((entry) => !ignored.has(entry.name))
    .filter(
      (entry) =>
        entry.isDirectory() ||
        /\.(?:exe|dmg|pkg|zip|appimage)$/iu.test(entry.name),
    )
    .map((entry) => join(path, entry.name));
  // Do not return a fallback placeholder when no artifact directory or
  // installer file was found; the Engine inspection step will fail closed.
  return artifacts;
}

/**
 * Find every unpacked `resources/engine` directory without following links.
 * A release can contain more than one unpacked artifact (for example a macOS
 * app directory and a dir target); each one must pass the same exclusivity
 * check. Compressed installer files are inspected after installation by the
 * native smoke gate and are intentionally not unpacked here.
 */
export async function findEngineResourceDirectories(rootPath) {
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return [];
  const directories = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const full = join(current, entry.name);
      if (
        entry.name.toLowerCase() === "engine" &&
        basename(dirname(full)).toLowerCase() === "resources"
      ) {
        directories.push(full);
        continue;
      }
      await walk(full);
    }
  }
  await walk(rootPath);
  return directories.sort((left, right) => left.localeCompare(right));
}

/**
 * Find any Engine-named binary (translunar-engine / translunar-engine.exe)
 * that lives outside a `resources/engine` directory. A stray copy at an app
 * root, inside `resources/app`, or anywhere else defeats the exclusivity
 * guarantee even when the sanctioned resources/engine directory is valid.
 * Symlinks are ignored (never followed) and reported names are matched
 * case-insensitively to catch Windows/macOS filesystem variance.
 */
export async function findStrayEngineBinaries(rootPath) {
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return [];
  const engineNames = new Set(["translunar-engine", "translunar-engine.exe"]);
  const stray = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      const engineNamed = engineNames.has(entry.name.toLowerCase());
      const sanctioned =
        basename(current).toLowerCase() === "engine" &&
        basename(dirname(current)).toLowerCase() === "resources";
      if (entry.isSymbolicLink()) {
        // Never follow links, but an Engine-named alias outside the sanctioned
        // directory still violates the one-binary artifact contract.
        if (engineNamed && !sanctioned) stray.push(full);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!engineNamed) continue;
      if (!sanctioned) stray.push(full);
    }
  }
  await walk(rootPath);
  return stray.sort((left, right) => left.localeCompare(right));
}

/**
 * Validate one packaged Engine resource directory. The directory is a strict
 * contract: exactly one regular, non-symlink file is allowed and its name and
 * executable header must match the current package platform/architecture.
 */
export async function inspectEngineResourceDirectory(directory, options = {}) {
  const platform = options.platform ?? process.platform;
  const expectedArch = options.expectedArch
    ? normalizeArch(options.expectedArch)
    : null;
  const wanted = expectedEngineBinaryName(platform);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== 1) {
    const names = entries
      .map((entry) => entry.name)
      .sort()
      .join(", ");
    throw new Error(
      `Engine resource directory must contain exactly one file (${wanted}); found ${entries.length}${names ? `: ${names}` : ""} at ${directory}`,
    );
  }
  const [entry] = entries;
  if (!entry.isFile() || entry.isSymbolicLink() || entry.name !== wanted) {
    throw new Error(
      `Engine resource directory contains an invalid binary '${entry.name}'; expected only '${wanted}' at ${directory}`,
    );
  }
  const path = join(directory, entry.name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Engine resource is not a regular file: ${path}`);
  }
  const architecture = detectExecutableArch(await readFile(path), platform);
  if (expectedArch && architecture !== expectedArch) {
    throw new Error(
      `Packaged Engine architecture ${architecture} does not match expected ${expectedArch}: ${path}`,
    );
  }
  return {
    directory,
    path,
    name: entry.name,
    architecture,
  };
}

/**
 * Enumerate the immediate unpacked-artifact directories directly under a
 * release output root (for example `win-unpacked`, `mac-arm64`). EVERY immediate
 * subdirectory is treated as an artifact that must carry its own Engine — this
 * is deliberately fail-closed so a sibling directory that dropped its Engine
 * (including a bare/empty one) cannot be masked by a valid sibling. Only
 * electron-builder metadata is excluded: dot-prefixed directories (for example
 * `.icon-icns`) and the ignored release-metadata names. Symlinks are never
 * followed. Installer files (.exe/.dmg/.zip) are not returned here — they are
 * validated post-install by the native smoke gate.
 */
export async function unpackedArtifactDirectories(rootPath) {
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return [];
  const ignored = new Set(["install-smoke-evidence.json", "macos-min-os.txt"]);
  const entries = await readdir(rootPath, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !entry.name.startsWith(".") &&
        !ignored.has(entry.name),
    )
    .map((entry) => join(rootPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Inspect a single unpacked artifact directory as an atomic unit. The artifact
 * must carry at least one verified `resources/engine` directory, every such
 * directory must satisfy the strict single-binary contract, and no Engine-named
 * binary may exist anywhere outside a sanctioned `resources/engine` path within
 * this artifact's tree. Installer files are skipped (validated post-install).
 */
export async function inspectArtifactEngines(artifactPath, options = {}) {
  const info = await lstat(artifactPath);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(
      `Unpacked artifact must be a regular non-symlink directory: ${artifactPath}`,
    );
  }
  const directories = await findEngineResourceDirectories(artifactPath);
  if (directories.length !== 1) {
    throw new Error(
      directories.length === 0
        ? `No packaged resources/engine directory was found under ${artifactPath}`
        : `Unpacked artifact must contain exactly one resources/engine directory; found ${directories.length} under ${artifactPath}: ${directories.join(", ")}`,
    );
  }
  const stray = await findStrayEngineBinaries(artifactPath);
  if (stray.length > 0) {
    throw new Error(
      `Engine binary found outside resources/engine (exclusivity violation): ${stray.join(", ")}`,
    );
  }
  const engine = await inspectEngineResourceDirectory(directories[0], options);
  return { artifact: artifactPath, engines: [engine] };
}

/**
 * Validate a release output root by enumerating immediate unpacked-artifact
 * subdirectories: EVERY one must carry its own verified Engine. A sibling
 * artifact that happens to bundle an Engine can never satisfy this check on
 * another artifact's behalf, so a release containing one valid app directory
 * and one Engine-less directory fails closed rather than being masked by the
 * first match. Returns the flattened list of every verified Engine. For a
 * single artifact directory (not a release root), call inspectArtifactEngines
 * directly.
 */
export async function inspectPackagedEngines(rootPath, options = {}) {
  const artifactDirs = await unpackedArtifactDirectories(rootPath);
  if (artifactDirs.length === 0) {
    throw new Error(`No packaged artifact directories found under ${rootPath}`);
  }
  const results = [];
  for (const directory of artifactDirs) {
    const { engines } = await inspectArtifactEngines(directory, options);
    results.push(...engines);
  }
  if (results.length === 0) {
    throw new Error(
      `No packaged resources/engine directory was found under ${rootPath}`,
    );
  }
  return results;
}

async function main() {
  let releaseStat;
  try {
    releaseStat = await stat(releaseDir);
  } catch {
    console.error(`release directory missing: ${releaseDir}`);
    console.error("Run pnpm package:dir (or package:win / package:mac) first.");
    process.exit(1);
  }

  const artifacts = await releaseArtifacts(releaseDir);
  for (const artifact of artifacts) {
    const size = await directorySize(artifact);
    const mb = (size / (1024 * 1024)).toFixed(2);
    console.log(`artifact size: ${mb} MB (${size} bytes) at ${artifact}`);
    if (size > MAX_BYTES) {
      console.error(
        `FAIL: artifact exceeds 200 MB gate (${mb} MB): ${artifact}`,
      );
      process.exit(1);
    }
  }

  const packageArch = process.env.TRANSLUNAR_PACKAGE_ARCH;
  const expectedArch = normalizeArch(packageArch || process.arch);
  if (packageArch) {
    const normalizedPackage = normalizeArch(packageArch);
    const hostArch = normalizeArch(process.arch);
    if (normalizedPackage !== hostArch) {
      console.error(
        `FAIL: TRANSLUNAR_PACKAGE_ARCH=${packageArch} (${normalizedPackage}) does not match host arch ${hostArch}`,
      );
      process.exit(1);
    }
    console.log(`package arch: ${normalizedPackage} (matches host)`);
  } else {
    console.log(
      `package arch: (TRANSLUNAR_PACKAGE_ARCH unset; host=${process.arch})`,
    );
  }

  // inspectPackagedEngines now enforces per-artifact completeness: every
  // unpacked artifact directory must carry its own verified Engine. Compressed
  // installer files are validated post-install by the native smoke gate.
  let engines;
  try {
    engines = await inspectPackagedEngines(releaseDir, {
      platform: process.platform,
      expectedArch,
    });
  } catch (error) {
    console.error(
      `FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  for (const engine of engines) {
    console.log(`engine binary: ${engine.path}`);
    console.log(`engine architecture: ${engine.architecture}`);
  }
  if (engines.length === 0) {
    console.error(
      "FAIL: No Engine binaries were found in any unpacked artifact. Compressed installers are validated by release:install-smoke.",
    );
    process.exit(1);
  }

  console.log("release:package:check OK");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
