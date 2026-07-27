import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

import { build } from "esbuild";
import { format } from "prettier";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "..", "..");
async function buildExample(relativeDirectory, outputName, platform = "node") {
  const exampleRoot = resolve(workspaceRoot, relativeDirectory);
  const outputPath = resolve(exampleRoot, "bin", outputName);
  await mkdir(resolve(exampleRoot, "bin"), { recursive: true });
  const result = await build({
    entryPoints: [resolve(exampleRoot, "src", "index.ts")],
    outfile: outputPath,
    alias: {
      "@translunar/plugin-sdk": resolve(packageRoot, "src", "index.ts"),
    },
    bundle: true,
    platform,
    format: "esm",
    target: "node22",
    legalComments: "none",
    sourcemap: false,
    logLevel: "silent",
    write: false,
    plugins:
      platform === "neutral"
        ? [
            {
              name: "sandbox-node-builtins",
              setup(buildContext) {
                buildContext.onResolve({ filter: /^node:/ }, (args) => ({
                  path: args.path,
                  namespace: "sandbox-node-builtins",
                }));
                buildContext.onLoad(
                  { filter: /.*/, namespace: "sandbox-node-builtins" },
                  () => ({
                    contents:
                      "export const stdin = undefined; export const stdout = undefined; export function createInterface() { throw new Error('process API unavailable'); } export function createHash() { throw new Error('crypto API unavailable'); }",
                    loader: "js",
                  }),
                );
              },
            },
          ]
        : [],
  });
  const output = result.outputFiles?.[0];
  if (!output)
    throw new Error(`esbuild did not produce the ${relativeDirectory} entry`);
  await writeFile(outputPath, await format(output.text, { parser: "babel" }));
}

await buildExample("examples/plugins/hello-srt", "hello-srt.mjs");
await buildExample(
  "examples/plugins/qa-pipeline-process",
  "qa-pipeline-process.mjs",
);
await buildExample(
  "fixtures/plugins/qa-pipeline-sandbox",
  "qa-pipeline-sandbox.mjs",
  "neutral",
);
