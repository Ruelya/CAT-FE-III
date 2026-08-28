// Bundle the Electron main and preload entries into self-contained files.
// tsc emit would leave bare workspace imports (e.g. @translunar/contracts)
// in the output, and electron-builder.yml excludes node_modules from the
// asar, so a packaged app could never resolve them at runtime. Bundling
// inlines every workspace/runtime dependency; only electron itself and the
// node builtins stay external. Run with: pnpm --filter @translunar/desktop build
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: ["src/main/index.ts"],
  outfile: "dist/electron/main/index.js",
  format: "esm",
});

await build({
  ...common,
  entryPoints: ["src/preload/index.cts"],
  outfile: "dist/electron/preload/index.cjs",
  format: "cjs",
});
