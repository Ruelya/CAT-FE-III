import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

import { build } from "esbuild";
import { format } from "prettier";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "..", "..");
const exampleRoot = resolve(workspaceRoot, "examples", "plugins", "hello-srt");

const outputPath = resolve(exampleRoot, "bin", "hello-srt.mjs");
const result = await build({
  entryPoints: [resolve(exampleRoot, "src", "index.ts")],
  outfile: outputPath,
  alias: {
    "@translunar/plugin-sdk": resolve(packageRoot, "src", "index.ts"),
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
if (!output) throw new Error("esbuild did not produce the hello-srt entry");
await writeFile(outputPath, await format(output.text, { parser: "babel" }));
