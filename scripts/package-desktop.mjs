#!/usr/bin/env node
/**
 * Host-arch-only desktop packaging wrapper.
 *
 * Detects the runner architecture, exports TRANSLUNAR_PACKAGE_ARCH, and
 * invokes electron-builder for only that arch (win/mac/dir). Cross-arch
 * multi-target builds are intentionally rejected so the bundled Engine
 * binary from target/release always matches the package.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  crossPlatformPackagingError,
  detectExecutableArch,
  expectedEngineBinaryName,
  normalizeArch,
} from "./package-architecture.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const desktopDir = join(root, "apps", "desktop");

function parseArgs(argv) {
  const args = { target: "dir", extra: [] };
  for (const item of argv) {
    if (item === "--win" || item === "win" || item === "windows") {
      args.target = "win";
    } else if (item === "--mac" || item === "mac" || item === "darwin") {
      args.target = "mac";
    } else if (item === "--dir" || item === "dir") {
      args.target = "dir";
    } else {
      args.extra.push(item);
    }
  }
  return args;
}

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: desktopDir,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}

async function main() {
  const { target, extra } = parseArgs(process.argv.slice(2));
  const hostArch = normalizeArch(process.arch);
  const packageArch = normalizeArch(
    process.env.TRANSLUNAR_PACKAGE_ARCH || hostArch,
  );
  if (packageArch !== hostArch) {
    console.error(
      `FAIL: TRANSLUNAR_PACKAGE_ARCH=${packageArch} does not match host arch ${hostArch}. Packaging is host-arch only.`,
    );
    process.exit(1);
  }

  // Reject cross-platform packaging: --win on macOS or --mac on Windows would
  // use the wrong Engine binary name (translunar-engine vs .exe) and pass the
  // host binary to electron-builder with no early failure. The installer smoke
  // would later fail, but the gate must fail closed here instead.
  const crossPlatformError = crossPlatformPackagingError(
    target,
    process.platform,
  );
  if (crossPlatformError) {
    console.error(`FAIL: ${crossPlatformError}`);
    process.exit(1);
  }

  const engineName = expectedEngineBinaryName();
  const enginePath = join(root, "target", "release", engineName);
  if (!existsSync(enginePath)) {
    console.error(
      `FAIL: host Engine binary missing at ${enginePath}. Run cargo build -p translunar-engine --release first.`,
    );
    process.exit(1);
  }
  const engineArch = detectExecutableArch(
    await readFile(enginePath),
    process.platform,
  );
  if (engineArch !== packageArch) {
    console.error(
      `FAIL: Engine architecture ${engineArch} does not match package arch ${packageArch}: ${enginePath}`,
    );
    process.exit(1);
  }
  console.log(`engine binary: ${enginePath}`);
  console.log(`package arch: ${packageArch} (Engine=${engineArch}, host-only)`);

  const engineResourceDir = await mkdtemp(
    join(tmpdir(), "translunar-engine-package-"),
  );
  const env = {
    ...process.env,
    TRANSLUNAR_PACKAGE_ARCH: packageArch,
    TRANSLUNAR_ENGINE_RESOURCE_DIR: engineResourceDir,
  };

  try {
    await copyFile(enginePath, join(engineResourceDir, engineName));
    // Ensure desktop dist is built.
    await run(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["build"],
      env,
    );

    const builderArgs = [
      "electron-builder",
      "--config",
      "electron-builder.yml",
    ];
    if (target === "win") {
      builderArgs.push("--win", `--${packageArch}`);
    } else if (target === "mac") {
      builderArgs.push("--mac", `--${packageArch}`);
    } else {
      builderArgs.push("--dir", `--${packageArch}`);
    }
    builderArgs.push(...extra);

    await run(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["exec", ...builderArgs],
      env,
    );
    console.log("package-desktop: OK");
  } finally {
    await rm(engineResourceDir, { recursive: true, force: true }).catch(
      (error) => {
        console.warn(
          `Could not remove temporary Engine resource directory ${engineResourceDir}: ${String(error)}`,
        );
      },
    );
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
