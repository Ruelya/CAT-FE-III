import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXPECTED_ELECTRON_VERSION = "41.10.3";
export const ELECTRON_PROBE_TIMEOUT_MS = 20_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

export async function inspectElectronInstall(
  packageRoot = join(
    repositoryRoot,
    "apps",
    "desktop",
    "node_modules",
    "electron",
  ),
) {
  const electronPackage = await readJson(join(packageRoot, "package.json"));
  if (electronPackage.version !== EXPECTED_ELECTRON_VERSION) {
    throw new Error(
      `Expected Electron ${EXPECTED_ELECTRON_VERSION}, found ${String(electronPackage.version)}.`,
    );
  }

  const executableRelativePath = (
    await readFile(join(packageRoot, "path.txt"), "utf8")
  ).trim();
  if (!executableRelativePath || isAbsolute(executableRelativePath)) {
    throw new Error(
      "Electron path.txt must contain a relative executable path.",
    );
  }
  const executable = resolve(packageRoot, "dist", executableRelativePath);
  assertContained(packageRoot, executable, "Electron executable");
  await assertFile(executable, "Electron executable");

  const resourceCandidates = [
    join(packageRoot, "dist", "resources", "default_app.asar"),
    join(
      packageRoot,
      "dist",
      "Electron.app",
      "Contents",
      "Resources",
      "default_app.asar",
    ),
  ];
  const defaultApp = await firstExistingFile(resourceCandidates);
  if (!defaultApp) {
    throw new Error(
      "Electron runtime is incomplete: resources/default_app.asar is missing.",
    );
  }

  // pnpm exposes Electron through a workspace symlink while its dependencies
  // live beside the real package in the virtual store.
  const physicalPackageRoot = await realpath(packageRoot);
  const requireFromElectron = createRequire(
    join(physicalPackageRoot, "package.json"),
  );
  const getPackagePath = await resolvePackageManifest(
    requireFromElectron,
    "@electron/get",
  );
  const getPackage = await readJson(getPackagePath);
  if (!isMajorVersion(getPackage.version, 5)) {
    throw new Error(
      `Expected @electron/get 5.x, found ${String(getPackage.version)}.`,
    );
  }

  const extractPackagePath = await resolvePackageManifest(
    requireFromElectron,
    "@electron-internal/extract-zip",
  );
  const extractPackage = await readJson(extractPackagePath);
  if (!isVersionAtLeast(extractPackage.version, [1, 0, 4])) {
    throw new Error(
      "Expected @electron-internal/extract-zip 1.0.4 or newer, " +
        `found ${String(extractPackage.version)}.`,
    );
  }

  return {
    packageRoot,
    executable,
    defaultApp,
    electronVersion: electronPackage.version,
    getVersion: getPackage.version,
    extractZipVersion: extractPackage.version,
  };
}

export async function probeElectronExecutable(
  executable,
  expectedVersion = EXPECTED_ELECTRON_VERSION,
  timeoutMs = ELECTRON_PROBE_TIMEOUT_MS,
) {
  const output = await runCommandWithTimeout(
    executable,
    ["--version"],
    timeoutMs,
  );
  if (
    !output
      .split(/\r?\n/u)
      .some((line) => line.trim() === `v${expectedVersion}`)
  ) {
    throw new Error(
      `Electron version probe did not report v${expectedVersion}: ${output.trim()}`,
    );
  }
  return output.trim();
}

export function runCommandWithTimeout(command, args, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output = `${output}${String(chunk)}`.slice(-4_000);
    });
    child.stderr.on("data", (chunk) => {
      output = `${output}${String(chunk)}`.slice(-4_000);
    });
    child.once("error", (error) => finish(() => rejectPromise(error)));
    child.once("exit", (code, signal) => {
      finish(() => {
        if (code === 0) resolvePromise(output);
        else {
          rejectPromise(
            new Error(
              `${command} failed (${String(code ?? signal)}): ${output.trim()}`,
            ),
          );
        }
      });
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(() =>
        rejectPromise(new Error(`${command} timed out after ${timeoutMs}ms.`)),
      );
    }, timeoutMs);
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function resolvePackageManifest(packageRequire, packageName) {
  try {
    return packageRequire.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !(
        "code" in error &&
        (error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
          error.code === "MODULE_NOT_FOUND")
      )
    ) {
      throw error;
    }
  }

  let current = dirname(packageRequire.resolve(packageName));
  while (true) {
    const manifestPath = join(current, "package.json");
    const manifest = await readJson(manifestPath).catch(() => null);
    if (manifest?.name === packageName) return manifestPath;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Cannot locate ${packageName} package.json.`);
}

function assertContained(root, target, label) {
  const pathFromRoot = relative(resolve(root), resolve(target));
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} resolves outside the Electron package.`);
  }
}

async function assertFile(path, label) {
  const details = await stat(path).catch(() => null);
  if (!details?.isFile()) throw new Error(`${label} is missing: ${path}`);
  if (details.size === 0) throw new Error(`${label} is empty: ${path}`);
  await access(path, constants.R_OK | constants.X_OK);
}

async function firstExistingFile(paths) {
  for (const path of paths) {
    const details = await stat(path).catch(() => null);
    if (details?.isFile() && details.size > 0) return path;
  }
  return null;
}

function numericVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(version));
  if (!match) return null;
  return match.slice(1, 4).map((value) => Number.parseInt(value, 10));
}

function isMajorVersion(version, expectedMajor) {
  return numericVersion(version)?.[0] === expectedMajor;
}

function isVersionAtLeast(version, minimum) {
  const parsed = numericVersion(version);
  if (!parsed) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (parsed[index] > minimum[index]) return true;
    if (parsed[index] < minimum[index]) return false;
  }
  return true;
}

async function main() {
  const install = await inspectElectronInstall();
  const reportedVersion = await probeElectronExecutable(
    install.executable,
    install.electronVersion,
  );
  console.log(
    JSON.stringify({
      electron: install.electronVersion,
      electronGet: install.getVersion,
      extractZip: install.extractZipVersion,
      executable: install.executable,
      reportedVersion,
    }),
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
