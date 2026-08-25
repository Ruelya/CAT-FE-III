// Stage the release tl-engine binary where electron-builder.yml's
// extraResources mapping expects it (.package-engine/ -> resources/engine/),
// matching the packaged-main lookup in apps/desktop/src/main/index.ts:
// process.resourcesPath/engine/tl-engine (tl-engine.exe on Windows).
// Run with: pnpm --filter @translunar/desktop package:dir
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const binaryName = process.platform === "win32" ? "tl-engine.exe" : "tl-engine";
// Same override the Electron main process honors in development.
const source =
  process.env.TL_ENGINE_BIN ?? join(repoRoot, "target", "release", binaryName);

if (!existsSync(source)) {
  throw new Error(
    `engine binary not found: ${source} (run cargo build -p tl-engine --release)`,
  );
}

const stageDir = join(desktopRoot, ".package-engine");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
const staged = join(stageDir, binaryName);
copyFileSync(source, staged);
chmodSync(staged, 0o755);
console.log(`staged engine binary: ${source} -> ${staged}`);
