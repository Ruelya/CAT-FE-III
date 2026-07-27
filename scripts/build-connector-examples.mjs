import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromSdk = createRequire(
  resolve(root, "packages", "plugin-sdk", "package.json"),
);
const { build } = requireFromSdk("esbuild");
const { format } = requireFromSdk("prettier");
const exampleRoot = resolve(
  root,
  "examples",
  "plugins",
  "connector-handler-fixture",
);
const outputPath = resolve(exampleRoot, "bin", "connector-fixture.mjs");

const result = await build({
  entryPoints: [resolve(exampleRoot, "src", "index.ts")],
  outfile: outputPath,
  alias: {
    "@translunar/plugin-sdk": resolve(
      root,
      "packages",
      "plugin-sdk",
      "src",
      "index.ts",
    ),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  sourcemap: false,
  logLevel: "silent",
  write: false,
});

const output = result.outputFiles?.[0];
if (!output) throw new Error("connector example build produced no output");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, await format(output.text, { parser: "babel" }));
