// Verify the unpackaged electron-builder output honors the packaged-main
// engine contract: resources/engine/tl-engine must sit next to app.asar so
// resolveEngineBinary finds it at process.resourcesPath/engine/tl-engine.
// Run with: pnpm --filter @translunar/desktop package:check
import { existsSync, statSync } from "node:fs";
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
      `unpacked output not found: ${unpacked} (run pnpm --filter @translunar/desktop package:dir)`,
    );
  }
  return join(unpacked, "resources");
}

const resources = resolveResourcesDir();

const asar = join(resources, "app.asar");
if (!existsSync(asar)) {
  throw new Error(`packaged app archive missing: ${asar}`);
}

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

console.log("package check OK");
console.log(`  app archive:   ${asar}`);
console.log(
  `  engine binary: ${engineBinary} (${(stats.size / 1024 / 1024).toFixed(1)} MiB)`,
);
