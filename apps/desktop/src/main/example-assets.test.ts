import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertExampleBundle,
  ExampleAssetError,
  materializeExampleProject,
} from "./example-assets.js";

// Resolve against the package root (pnpm --filter @translunar/desktop cwd).
// Avoid import.meta.url: Vitest may load this file under a non-file scheme.
const PACKAGED_WELCOME = join(
  process.cwd(),
  "resources",
  "examples",
  "welcome",
);

describe("example assets", () => {
  it("ships a licensed manifest-backed offline example", async () => {
    expect(
      existsSync(PACKAGED_WELCOME),
      `packaged example missing at ${PACKAGED_WELCOME} (cwd=${process.cwd()}); run vitest from apps/desktop`,
    ).toBe(true);
    const bundle = await assertExampleBundle(PACKAGED_WELCOME);
    expect(await readFile(bundle.sourcePath, "utf8")).toMatch(/Translunar/i);
    expect(await readFile(bundle.licensePath, "utf8")).toMatch(/Apache/i);
    const manifest = JSON.parse(
      await readFile(bundle.manifestPath, "utf8"),
    ) as { id: string; formatVersion: number; sourceFile: string };
    expect(manifest).toMatchObject({
      id: "welcome",
      formatVersion: 1,
      sourceFile: "source.txt",
    });
  });

  it("fails truthfully instead of synthesizing missing assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-example-missing-"));
    await expect(assertExampleBundle(root)).rejects.toMatchObject({
      code: "example_asset_missing",
    });
    await expect(
      materializeExampleProject({
        dataDirectory: root,
        resourceRoots: [join(root, "absent")],
      }),
    ).rejects.toBeInstanceOf(ExampleAssetError);

    const partial = join(root, "partial");
    await mkdir(partial, { recursive: true });
    await writeFile(join(partial, "source.txt"), "only source", "utf8");
    await expect(assertExampleBundle(partial)).rejects.toMatchObject({
      code: "example_asset_missing",
    });
  });

  it("copies the complete bundle into the managed data directory", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "tl-example-stage-"));
    const stagedSource = await materializeExampleProject({
      dataDirectory,
      resourceRoots: [PACKAGED_WELCOME],
    });
    expect(stagedSource.replaceAll("\\", "/")).toContain(
      ".desktop/examples/welcome/source.txt",
    );
    await expect(
      assertExampleBundle(dirname(stagedSource)),
    ).resolves.toMatchObject({ root: dirname(stagedSource) });
  });
});
