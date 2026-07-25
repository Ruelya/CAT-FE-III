#!/usr/bin/env node
/**
 * Native clean-machine install/launch/Engine smoke gate.
 *
 * This deliberately requires a real NSIS installer on Windows or a real DMG
 * on macOS. It never falls back to electron-builder's unpacked output and it
 * never treats SQLite-file creation as Engine readiness evidence.
 */
import { pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  INSTALL_SMOKE_TIMEOUT_MS,
  collectFiles,
  findInstalledApp,
  installMac,
  installWindows,
  resolvePackagedEngine,
  runEngineProbe,
  selectInstallerArtifact,
  sha256File,
  normalizeSmokePlatform,
  waitForAppEngineReadiness,
} from "./release-install-smoke-lib.mjs";

export function parsePlatformArg(
  argv = process.argv,
  fallback = process.platform,
) {
  const index = argv.indexOf("--platform");
  return normalizeSmokePlatform(index >= 0 ? argv[index + 1] : fallback);
}

async function findExistingEngine(appBinary, platform) {
  const candidate = resolvePackagedEngine(appBinary, platform);
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {
    // Some electron-builder layouts put resources beside the app executable.
  }
  const appRoot =
    platform === "darwin"
      ? resolve(appBinary, "..", "..", "..")
      : resolve(appBinary, "..");
  const files = await collectFiles(appRoot);
  const expected =
    platform === "win32" ? "translunar-engine.exe" : "translunar-engine";
  const matches = files.filter(
    (path) =>
      basename(path).toLowerCase() === expected.toLowerCase() &&
      path.replaceAll("\\", "/").toLowerCase().includes("/resources/engine/"),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one packaged Engine binary under resources/engine, found ${matches.length}.`,
    );
  }
  return matches[0];
}

function spawnPackagedApp(binary, appDataDir, userDataDir, readyFile) {
  const child = spawn(binary, [], {
    cwd: resolve(binary, ".."),
    env: {
      ...process.env,
      TRANSLUNAR_DATA_DIR: appDataDir,
      TRANSLUNAR_RELEASE_SMOKE: "1",
      TRANSLUNAR_SMOKE_READY_FILE: readyFile,
      ELECTRON_USER_DATA: userDataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  return { child, getOutput: () => output.slice(-4_000) };
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

async function waitForSpawn(child) {
  await new Promise((resolvePromise, rejectPromise) => {
    const onError = (error) => {
      child.removeListener("spawn", onSpawn);
      rejectPromise(error);
    };
    const onSpawn = () => {
      child.removeListener("error", onError);
      resolvePromise();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

async function discoverInstaller(releaseDir, platform) {
  if (process.env.TRANSLUNAR_INSTALLER_PATH?.trim()) {
    const explicit = resolve(process.env.TRANSLUNAR_INSTALLER_PATH);
    await stat(explicit);
    return explicit;
  }
  const releaseInfo = await stat(releaseDir);
  const files = releaseInfo.isFile()
    ? [releaseDir]
    : await collectFiles(releaseDir);
  return selectInstallerArtifact(files, platform);
}

export async function runSmoke({
  platform = parsePlatformArg(),
  releaseDir = resolve(
    process.cwd(),
    process.env.TRANSLUNAR_RELEASE_DIR ?? "apps/desktop/release",
  ),
} = {}) {
  const startedAt = Date.now();
  const normalizedPlatform = normalizeSmokePlatform(platform);
  const evidencePath = join(releaseDir, "install-smoke-evidence.json");
  let installerPath = null;
  let appBinary = null;
  let engineBinary = null;
  let appProcess = null;
  let appOutput = "";
  let appDataDir = null;
  let engineDataDir = null;
  let userDataDir = null;
  let installRoot = null;
  let probe = null;
  let appEngineHandshake = null;
  let errorMessage = null;
  const evidence = {
    platform: normalizedPlatform,
    runner: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
    arch: process.arch,
    noLogin: !process.env.TRANSLUNAR_FORCE_LOGIN,
    installer: null,
    installedApp: null,
    engine: null,
    appEngineHandshake: null,
    maxMs: INSTALL_SMOKE_TIMEOUT_MS,
  };

  try {
    if (process.env.TRANSLUNAR_FORCE_LOGIN) {
      throw new Error("No-login gate was disabled by the environment.");
    }
    await stat(releaseDir);
    installerPath = await discoverInstaller(releaseDir, normalizedPlatform);
    evidence.installer = {
      path: installerPath,
      sha256: await sha256File(installerPath),
    };
    appDataDir = await mkdtemp(join(tmpdir(), "tl-smoke-app-data-"));
    engineDataDir = await mkdtemp(join(tmpdir(), "tl-smoke-engine-data-"));
    userDataDir = await mkdtemp(join(tmpdir(), "tl-smoke-user-"));
    installRoot = await mkdtemp(join(tmpdir(), "tl-smoke-install-"));

    if (normalizedPlatform === "win32") {
      await installWindows(installerPath, installRoot);
    } else {
      await installMac(installerPath, installRoot);
    }
    appBinary = await findInstalledApp(installRoot, normalizedPlatform);
    engineBinary = await findExistingEngine(appBinary, normalizedPlatform);
    evidence.installedApp = { path: appBinary };
    evidence.engine = {
      path: engineBinary,
      sha256: await sha256File(engineBinary),
    };

    const appStartedAtMs = Date.now();
    const appReadyFile = join(userDataDir, "app-engine-ready.json");
    const launched = spawnPackagedApp(
      appBinary,
      appDataDir,
      userDataDir,
      appReadyFile,
    );
    appProcess = launched.child;
    appOutput = launched.getOutput;
    await waitForSpawn(appProcess);
    const readinessPromise = waitForAppEngineReadiness({
      markerPath: appReadyFile,
      appProcess,
      startedAtMs: appStartedAtMs,
      timeoutMs: INSTALL_SMOKE_TIMEOUT_MS,
    });
    const probePromise = runEngineProbe(engineBinary, engineDataDir);
    const timeout = new Promise((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Install-to-usable-project exceeded ${INSTALL_SMOKE_TIMEOUT_MS}ms.`,
            ),
          ),
        INSTALL_SMOKE_TIMEOUT_MS,
      ).unref();
    });
    [appEngineHandshake, probe] = await Promise.race([
      Promise.all([readinessPromise, probePromise]),
      timeout,
    ]);
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
      throw new Error(
        `Installed application exited before Engine smoke completed (code=${String(appProcess.exitCode)}, signal=${String(appProcess.signalCode)}).`,
      );
    }
    evidence.appEngineHandshake = appEngineHandshake;
    evidence.engine.probe = probe;
    evidence.ready = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (appOutput) console.error(appOutput());
    throw error;
  } finally {
    await terminate(appProcess);
    const elapsedMs = Date.now() - startedAt;
    const finalEvidence = {
      ...evidence,
      elapsedMs,
      ready: evidence.ready === true && errorMessage === null,
      ...(errorMessage ? { error: errorMessage } : {}),
    };
    await mkdir(releaseDir, { recursive: true });
    await writeFile(
      evidencePath,
      `${JSON.stringify(finalEvidence, null, 2)}\n`,
      "utf8",
    ).catch((writeError) => {
      console.error(
        `Could not write install smoke evidence: ${String(writeError)}`,
      );
      process.exitCode = 1;
    });
    console.log(JSON.stringify(finalEvidence));
    for (const path of [appDataDir, engineDataDir, userDataDir, installRoot]) {
      if (path)
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runSmoke()
    .then(() => console.log("release:install-smoke OK"))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
