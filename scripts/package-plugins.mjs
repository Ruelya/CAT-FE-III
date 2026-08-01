#!/usr/bin/env node
/**
 * Build deterministic offline core plugin archives and index.
 *
 * Usage:
 *   node scripts/package-plugins.mjs [--out <dir>] [--check]
 *
 * --check validates an existing output against a fresh build without writing.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = join(root, "scripts", "plugin-core-allowlist.json");
const defaultOut = join(root, "apps", "desktop", "resources", "plugins");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outIdx = args.indexOf("--out");
const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : defaultOut);

const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
if (allowlist.catalogVersion !== 1) {
  throw new Error(
    `unsupported allowlist catalogVersion ${allowlist.catalogVersion}`,
  );
}

function walkFiles(dir, base = dir, acc = []) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlink rejected: ${full}`);
    }
    if (entry.isDirectory()) {
      walkFiles(full, base, acc);
    } else if (entry.isFile()) {
      acc.push(relative(base, full).split("\\").join("/"));
    } else {
      throw new Error(`non-regular entry: ${full}`);
    }
  }
  return acc;
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Canonical package tree hash matching plugin-runtime identity. */
function packageSha256(packageDir) {
  const files = walkFiles(packageDir);
  const entries = files.map((path) => {
    const bytes = readFileSync(join(packageDir, path));
    return {
      path,
      size: bytes.length,
      sha256: sha256Buffer(bytes),
    };
  });
  entries.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  const canonical = {
    algorithm: "sha256",
    version: 1,
    entries,
  };
  return {
    sha256: sha256Buffer(Buffer.from(JSON.stringify(canonical))),
    totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
    entries,
  };
}

function requireLicense(packageDir) {
  const names = readdirSync(packageDir, { withFileTypes: true });
  const ok = names.some((entry) => {
    if (!entry.isFile()) return false;
    const name = entry.name;
    const upper = name.toUpperCase();
    return (
      upper === "LICENSE" ||
      upper.startsWith("LICENSE.") ||
      upper === "LICENCE" ||
      upper.startsWith("LICENCE.")
    );
  });
  if (!ok) throw new Error(`missing regular LICENSE in ${packageDir}`);
  const license = names.find(
    (entry) =>
      entry.isFile() &&
      ["LICENSE", "LICENCE"].some((prefix) =>
        entry.name.toUpperCase().startsWith(prefix),
      ),
  );
  if (license && statSync(join(packageDir, license.name)).size === 0) {
    throw new Error(`empty LICENSE in ${packageDir}`);
  }
}

function validateReleaseSafety(packageDir, allowlistItem, manifest) {
  const normalizedPath = allowlistItem.path.replace(/\\/g, "/");
  if (
    normalizedPath.startsWith("/") ||
    normalizedPath.includes("..") ||
    !normalizedPath.startsWith("examples/plugins/")
  ) {
    throw new Error(
      `allowlist path is not a public example: ${allowlistItem.path}`,
    );
  }
  if (tierOf(manifest) !== allowlistItem.tier) {
    throw new Error(
      `package ${allowlistItem.id} tier ${tierOf(manifest)} != allowlist ${allowlistItem.tier}`,
    );
  }
  const contributions = Array.isArray(manifest.contributions)
    ? manifest.contributions
    : Object.entries(manifest.contributions ?? {}).flatMap(([kind, values]) => {
        const normalizedKind = kind === "filters" ? "filter" : kind;
        return Array.isArray(values)
          ? values.map((value) => ({ ...value, kind: normalizedKind }))
          : [];
      });
  const kinds = new Set(contributions.map((contribution) => contribution.kind));
  for (const surface of allowlistItem.surfaces ?? []) {
    if (!kinds.has(surface)) {
      throw new Error(
        `package ${allowlistItem.id} is missing allowlisted ${surface} surface`,
      );
    }
  }
  for (const path of walkFiles(packageDir)) {
    const lower = path.toLowerCase();
    if (
      lower
        .split("/")
        .some(
          (name) =>
            name === ".env" ||
            name.startsWith(".env.") ||
            name.includes("credential") ||
            name.endsWith(".pem") ||
            name.endsWith(".key"),
        )
    ) {
      throw new Error(`credential-shaped release path: ${path}`);
    }
    const bytes = readFileSync(join(packageDir, path));
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    if (
      /-----BEGIN [^-]*PRIVATE KEY-----|\b(?:sk|ghp|xox[baprs])-[A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b/u.test(
        text,
      )
    ) {
      throw new Error(`credential-shaped content in ${path}`);
    }
    if (
      /(?:[A-Za-z]:\\Users\\|[A-Za-z]:\\Workspaces?\\|\/home\/[^/]+\/|\/Users\/[^/]+\/)/u.test(
        text,
      )
    ) {
      throw new Error(`private absolute path in ${path}`);
    }
  }
}

function validateManifest(packageDir, expectedId) {
  const manifestPath = join(packageDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`missing manifest.json in ${packageDir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.id !== expectedId) {
    throw new Error(`manifest id ${manifest.id} != allowlist ${expectedId}`);
  }
  const dist = manifest.distribution;
  if (!dist?.publisher || !dist?.license) {
    throw new Error(
      `package ${expectedId} missing distribution.publisher/license`,
    );
  }
  if (dist.homepage && !String(dist.homepage).startsWith("https://")) {
    throw new Error(`package ${expectedId} homepage must be https`);
  }
  requireLicense(packageDir);
  return manifest;
}

function buildArchiveWithPython(packageDir, archivePath) {
  // Deterministic ZIP via Python: fixed 1980-01-01 timestamps, sorted names,
  // deflate, and a closed .tlplugin-format marker.
  const script = `
import json, os, sys, zipfile
from pathlib import Path
package = Path(sys.argv[1])
output = Path(sys.argv[2])
files = []
for root, dirs, names in os.walk(package):
    dirs.sort()
    for name in sorted(names):
        full = Path(root) / name
        if full.is_symlink():
            raise SystemExit(f"symlink rejected: {full}")
        rel = full.relative_to(package).as_posix()
        files.append((rel, full))
files.sort(key=lambda item: item[0].encode("utf-8"))
marker = json.dumps({"formatVersion": 1}, separators=(",", ":")).encode("utf-8")
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    info = zipfile.ZipInfo(".tlplugin-format")
    info.date_time = (1980, 1, 1, 0, 0, 0)
    info.external_attr = 0o644 << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, marker)
    for rel, full in files:
        data = full.read_bytes()
        info = zipfile.ZipInfo(rel)
        info.date_time = (1980, 1, 1, 0, 0, 0)
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, data)
`;
  const result = spawnSync("python", ["-c", script, packageDir, archivePath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `python archive build failed: ${result.stderr || result.stdout || result.status}`,
    );
  }
}

function contributionCount(manifest) {
  if (Array.isArray(manifest.contributions)) {
    return manifest.contributions.length;
  }
  const contributions = manifest.contributions ?? {};
  return Object.values(contributions).reduce(
    (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
    0,
  );
}

function tierOf(manifest) {
  return manifest.runtime?.tier || manifest.tier || "process";
}

function buildCatalog() {
  const packages = [];
  const tempRoot = join(root, ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  const temp = mkdtempSync(join(tempRoot, "plugin-core-build-"));

  try {
    for (const item of allowlist.packages) {
      const packageDir = resolve(root, item.path);
      if (!existsSync(packageDir)) {
        throw new Error(`package path missing: ${item.path}`);
      }
      const manifest = validateManifest(packageDir, item.id);
      validateReleaseSafety(packageDir, item, manifest);
      const packageHash = packageSha256(packageDir);
      const archiveName = `${item.id.replace(/[^A-Za-z0-9._-]+/g, "_")}-${manifest.version}.tlplugin`;
      const archivePath = join(temp, archiveName);
      buildArchiveWithPython(packageDir, archivePath);
      const archiveHash = sha256File(archivePath);
      packages.push({
        pluginId: item.id,
        displayName: manifest.displayName,
        version: manifest.version,
        tier: tierOf(manifest),
        archive: archiveName,
        packageSha256: packageHash.sha256,
        archiveSha256: archiveHash,
        publisher: manifest.distribution.publisher,
        license: manifest.distribution.license,
        homepage: manifest.distribution.homepage ?? null,
        contributionCount: contributionCount(manifest),
        sourcePath: item.path,
        archivePath,
      });
    }
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }

  packages.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  const index = {
    catalogVersion: 1,
    packages: packages.map(
      ({
        pluginId,
        displayName,
        version,
        tier,
        archive,
        packageSha256,
        archiveSha256,
        publisher,
        license,
        homepage,
        contributionCount,
      }) => ({
        pluginId,
        displayName,
        version,
        tier,
        archive,
        packageSha256,
        archiveSha256,
        publisher,
        license,
        homepage,
        contributionCount,
      }),
    ),
  };
  return { packages, index, temp };
}

function writeCatalog({ packages, index }) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const pkg of packages) {
    copyFileSync(pkg.archivePath, join(outDir, pkg.archive));
  }
  writeFileSync(
    join(outDir, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  const evidence = {
    builtAt: "deterministic",
    outDir: relative(root, outDir).split("\\").join("/"),
    packages: index.packages.map((pkg) => ({
      pluginId: pkg.pluginId,
      version: pkg.version,
      packageSha256: pkg.packageSha256,
      archiveSha256: pkg.archiveSha256,
    })),
  };
  writeFileSync(
    join(outDir, "evidence-manifest.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
}

function checkCatalog({ packages, index }) {
  if (!existsSync(join(outDir, "index.json"))) {
    throw new Error(`missing catalog index at ${outDir}`);
  }
  const existing = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
  const expected = JSON.stringify(index);
  const actual = JSON.stringify({
    catalogVersion: existing.catalogVersion,
    packages: existing.packages,
  });
  if (expected !== actual) {
    throw new Error(
      "bundled plugin catalog index drifted from allowlist rebuild",
    );
  }
  for (const pkg of packages) {
    const path = join(outDir, pkg.archive);
    if (!existsSync(path)) {
      throw new Error(`missing archive ${pkg.archive}`);
    }
    const hash = sha256File(path);
    if (hash !== pkg.archiveSha256) {
      throw new Error(`archive hash drift for ${pkg.archive}`);
    }
  }
  console.log(`plugin catalog check ok (${packages.length} packages)`);
}

let built;
try {
  built = buildCatalog();
  if (checkOnly) {
    checkCatalog(built);
  } else {
    writeCatalog(built);
    console.log(
      `wrote ${built.packages.length} core plugin archives to ${relative(root, outDir)}`,
    );
  }
} finally {
  if (built) rmSync(built.temp, { recursive: true, force: true });
}
