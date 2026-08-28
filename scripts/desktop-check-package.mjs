// Verify the electron-builder output honors the packaged-app contracts:
//
// - resources/engine/tl-engine must sit next to app.asar so
//   resolveEngineBinary finds it at process.resourcesPath/engine/tl-engine.
// - app.asar must carry the bundled main entry (dist/electron/main/index.js)
//   with no bare @translunar/* import left in any main/preload module:
//   node_modules stays out of the asar, so such an import would crash the
//   packaged app at startup (ERR_MODULE_NOT_FOUND) even though the dir
//   layout looks fine.
// - on win32 the user deliverable is the NSIS installer, so a
//   translunar-cat-setup-*.exe must exist next to win-unpacked/.
//
// Run with: pnpm --filter @translunar/desktop package:check
import asar from "@electron/asar";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const releaseDir = join(repoRoot, "apps", "desktop", "release");
const binaryName = process.platform === "win32" ? "tl-engine.exe" : "tl-engine";

function resolveResourcesDir() {
  if (process.platform === "darwin") {
    // mac dir output nests resources inside the .app bundle.
    for (const dir of ["mac", "mac-arm64", "mac-universal"]) {
      const candidate = join(
        releaseDir,
        dir,
        "Translunar CAT.app",
        "Contents",
        "Resources",
      );
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    throw new Error(`no mac*/Translunar CAT.app bundle under ${releaseDir}`);
  }
  const unpacked = join(
    releaseDir,
    process.platform === "win32" ? "win-unpacked" : "linux-unpacked",
  );
  if (!existsSync(unpacked)) {
    throw new Error(
      `unpacked output not found: ${unpacked} (run pnpm --filter @translunar/desktop ${
        process.platform === "win32" ? "package:win" : "package:dir"
      })`,
    );
  }
  return join(unpacked, "resources");
}

// A bare workspace import in specifier position (static import, dynamic
// import(), or require()) can never resolve inside the asar.
const BARE_TRANSLUNAR_IMPORT =
  /(?:from|import|require)\s*\(?\s*["']@translunar\//;

function checkAsarContents(asarPath) {
  // Extract next to the release output rather than under os.tmpdir(): the
  // release dir always exists here, and tmpdir() resolution depends on
  // platform-specific env vars this script must not rely on.
  const extracted = mkdtempSync(join(releaseDir, ".asar-check-"));
  try {
    asar.extractAll(asarPath, extracted);
    if (existsSync(join(extracted, "node_modules"))) {
      throw new Error(
        `asar must not contain node_modules (electron-builder files config regressed): ${asarPath}`,
      );
    }
    const mainEntry = join(extracted, "dist", "electron", "main", "index.js");
    if (!existsSync(mainEntry)) {
      throw new Error(
        `bundled main entry missing from asar: dist/electron/main/index.js in ${asarPath}`,
      );
    }
    const electronDir = join(extracted, "dist", "electron");
    const offenders = [];
    for (const entry of readdirSync(electronDir, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.(?:js|cjs|mjs)$/.test(entry.name)) {
        continue;
      }
      const file = join(entry.parentPath, entry.name);
      if (BARE_TRANSLUNAR_IMPORT.test(readFileSync(file, "utf8"))) {
        offenders.push(file.slice(extracted.length + 1));
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `asar main/preload modules still import @translunar/* as a bare package ` +
          `(node_modules is excluded, so the packaged app crashes at startup): ` +
          `${offenders.join(", ")} — esbuild.electron.mjs must bundle these`,
      );
    }
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}

function checkWindowsInstaller() {
  const installers = readdirSync(releaseDir).filter((name) =>
    /^translunar-cat-setup-.*\.exe$/.test(name),
  );
  if (installers.length === 0) {
    throw new Error(
      `NSIS installer missing under ${releaseDir}: expected translunar-cat-setup-*.exe ` +
        `(run pnpm --filter @translunar/desktop package:win)`,
    );
  }
  return installers.map((name) => join(releaseDir, name));
}

const resources = resolveResourcesDir();

const asarPath = join(resources, "app.asar");
if (!existsSync(asarPath)) {
  throw new Error(`packaged app archive missing: ${asarPath}`);
}
checkAsarContents(asarPath);

const engineBinary = join(resources, "engine", binaryName);
if (!existsSync(engineBinary)) {
  throw new Error(
    `packaged engine binary missing: ${engineBinary} (extraResources staging broke)`,
  );
}
const stats = statSync(engineBinary);
if (!stats.isFile()) {
  throw new Error(
    `packaged engine path is not a regular file: ${engineBinary}`,
  );
}
if (process.platform !== "win32" && (stats.mode & 0o111) === 0) {
  throw new Error(`packaged engine binary is not executable: ${engineBinary}`);
}

const installers = process.platform === "win32" ? checkWindowsInstaller() : [];

console.log("package check OK");
console.log(`  app archive:   ${asarPath} (no bare @translunar/* imports)`);
console.log(
  `  engine binary: ${engineBinary} (${(stats.size / 1024 / 1024).toFixed(1)} MiB)`,
);
for (const installer of installers) {
  const size = statSync(installer).size;
  console.log(
    `  installer:     ${installer} (${(size / 1024 / 1024).toFixed(1)} MiB)`,
  );
}
