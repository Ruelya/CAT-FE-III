import { cp, lstat, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export class ExampleAssetError extends Error {
  readonly code = "example_asset_missing" as const;

  constructor(message: string) {
    super(message);
    this.name = "ExampleAssetError";
  }
}

export interface ExampleBundlePaths {
  root: string;
  sourcePath: string;
  licensePath: string;
  manifestPath: string;
}

export async function assertExampleBundle(
  root: string,
): Promise<ExampleBundlePaths> {
  const sourcePath = join(root, "source.txt");
  const licensePath = join(root, "LICENSE.txt");
  const manifestPath = join(root, "manifest.json");

  for (const path of [sourcePath, licensePath, manifestPath]) {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error();
    } catch {
      throw new ExampleAssetError(
        `Packaged example asset is missing or invalid: ${basename(path)}`,
      );
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new ExampleAssetError("Example manifest.json is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    parsed.id !== "welcome" ||
    parsed.formatVersion !== 1 ||
    parsed.license !== "Apache-2.0" ||
    parsed.sourceFile !== "source.txt" ||
    parsed.licenseFile !== "LICENSE.txt" ||
    parsed.sourceLocale !== "en-US" ||
    parsed.targetLocale !== "zh-CN"
  ) {
    throw new ExampleAssetError("Example manifest.json is incompatible.");
  }

  const source = await readFile(sourcePath, "utf8");
  const license = await readFile(licensePath, "utf8");
  if (!source.trim()) {
    throw new ExampleAssetError("Example source.txt is empty.");
  }
  if (!license.trim()) {
    throw new ExampleAssetError("Example LICENSE.txt is empty.");
  }

  return { root, sourcePath, licensePath, manifestPath };
}

export async function materializeExampleProject(options: {
  dataDirectory: string;
  resourceRoots: string[];
}): Promise<string> {
  let bundle: ExampleBundlePaths | null = null;
  let lastError: ExampleAssetError | null = null;
  for (const root of options.resourceRoots) {
    try {
      bundle = await assertExampleBundle(root);
      break;
    } catch (error) {
      lastError =
        error instanceof ExampleAssetError
          ? error
          : new ExampleAssetError("Packaged example resources are invalid.");
    }
  }
  if (!bundle) {
    throw (
      lastError ??
      new ExampleAssetError(
        "Packaged example resources are missing (source.txt, LICENSE.txt, manifest.json).",
      )
    );
  }

  const stagedDir = join(
    options.dataDirectory,
    ".desktop",
    "examples",
    "welcome",
  );
  await mkdir(stagedDir, { recursive: true });
  const stagedSource = join(stagedDir, "source.txt");
  await cp(bundle.sourcePath, stagedSource, { force: true });
  await cp(bundle.licensePath, join(stagedDir, "LICENSE.txt"), { force: true });
  await cp(bundle.manifestPath, join(stagedDir, "manifest.json"), {
    force: true,
  });
  return stagedSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
