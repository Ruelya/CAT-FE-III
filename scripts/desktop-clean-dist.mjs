// tsc never cleans apps/desktop/dist/electron, so stale modules from a
// previous checkout would silently leak into the packaged asar. Vite already
// empties dist/renderer; this clears the whole dist tree before a package
// build. Run with: pnpm --filter @translunar/desktop package:dir
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
rmSync(join(repoRoot, "apps", "desktop", "dist"), {
  recursive: true,
  force: true,
});
