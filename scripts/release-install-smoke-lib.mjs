import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

export const INSTALL_SMOKE_TIMEOUT_MS = 3 * 60 * 1000;
export const APP_ENGINE_READY_KIND = "translunar.app-engine-ready";
export const APP_ENGINE_READY_VERSION = 1;

export function parseAppEngineReadiness(
  raw,
  { startedAtMs, nowMs = Date.now(), expectedPid = null },
) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "Installed application readiness marker is malformed JSON.",
    );
  }
  if (!value || typeof value !== "object") {
    throw new Error("Installed application readiness marker is not an object.");
  }
  if (
    value.kind !== APP_ENGINE_READY_KIND ||
    value.version !== APP_ENGINE_READY_VERSION
  ) {
    throw new Error(
      "Installed application readiness marker contract is invalid.",
    );
  }
  if (value.healthy !== true) {
    throw new Error("Installed application reported an unhealthy Engine.");
  }
  if (
    typeof value.appVersion !== "string" ||
    !value.appVersion ||
    value.appVersion.trim() !== value.appVersion
  ) {
    throw new Error(
      "Installed application readiness marker has no app version.",
    );
  }
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new Error(
      "Installed application readiness marker has an invalid pid.",
    );
  }
  if (expectedPid !== null && value.pid !== expectedPid) {
    throw new Error(
      `Installed application readiness marker pid ${String(value.pid)} does not match launched pid ${String(expectedPid)}.`,
    );
  }
  if (
    value.schemaVersion !== null &&
    (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 0)
  ) {
    throw new Error(
      "Installed application readiness marker has an invalid schema version.",
    );
  }
  if (!Number.isSafeInteger(value.readyAtMs) || value.readyAtMs < startedAtMs) {
    throw new Error("Installed application readiness marker is stale.");
  }
  if (value.readyAtMs > nowMs + 60_000) {
    throw new Error(
      "Installed application readiness marker timestamp is in the future.",
    );
  }
  return {
    kind: value.kind,
    version: value.version,
    appVersion: value.appVersion,
    pid: value.pid,
    healthy: true,
    schemaVersion: value.schemaVersion,
    readyAtMs: value.readyAtMs,
  };
}

export async function waitForAppEngineReadiness({
  markerPath,
  appProcess,
  startedAtMs,
  timeoutMs = INSTALL_SMOKE_TIMEOUT_MS,
  pollMs = 50,
}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (
      appProcess &&
      (appProcess.exitCode !== null || appProcess.signalCode !== null)
    ) {
      throw new Error(
        `Installed application exited before its Engine handshake marker appeared (code=${String(appProcess.exitCode)}, signal=${String(appProcess.signalCode)}).`,
      );
    }
    try {
      const raw = await readFile(markerPath, "utf8");
      return parseAppEngineReadiness(raw, {
        startedAtMs,
        nowMs: Date.now(),
        expectedPid:
          appProcess && Number.isSafeInteger(appProcess.pid)
            ? appProcess.pid
            : null,
      });
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Installed application did not publish an Engine handshake marker within ${timeoutMs}ms.`,
      );
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
  }
}

export function normalizeSmokePlatform(value) {
  if (value !== "win32" && value !== "darwin") {
    throw new Error(
      `Unsupported installer smoke platform: ${String(value)}. Run on a native Windows or macOS runner.`,
    );
  }
  return value;
}

export function installerExtension(platform) {
  return normalizeSmokePlatform(platform) === "win32" ? ".exe" : ".dmg";
}

export function isInstallerCandidate(path, platform) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const extension = installerExtension(platform);
  if (!normalized.endsWith(extension)) return false;
  if (normalized.includes("-unpacked/") || normalized.includes("/resources/")) {
    return false;
  }
  const name = basename(normalized);
  if (platform === "win32") {
    return (
      /setup|installer/u.test(name) || !name.includes("translunar cat.exe")
    );
  }
  return !name.startsWith("translunar cat-unpacked");
}

export function selectInstallerArtifact(paths, platform) {
  normalizeSmokePlatform(platform);
  const candidates = paths.filter((path) =>
    isInstallerCandidate(path, platform),
  );
  if (candidates.length === 0) {
    throw new Error(
      `No ${platform === "win32" ? "NSIS .exe" : "macOS .dmg"} installer artifact was found; unpacked output is not accepted.`,
    );
  }
  const preferred = candidates.filter((path) =>
    platform === "win32"
      ? /setup|installer/iu.test(basename(path))
      : extname(path).toLowerCase() === ".dmg",
  );
  const selected =
    preferred.length === 1
      ? preferred[0]
      : candidates.length === 1
        ? candidates[0]
        : null;
  if (!selected) {
    throw new Error(
      `Installer artifact selection is ambiguous: ${candidates.map(basename).join(", ")}`,
    );
  }
  return resolve(selected);
}

export function windowsInstallerArgs(installRoot) {
  return ["/S", `/D=${resolve(installRoot)}`];
}

export function macMountArgs(dmgPath, mountPoint) {
  return [
    "attach",
    dmgPath,
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mountPoint,
  ];
}

export function macDetachArgs(mountPoint) {
  return ["detach", mountPoint, "-force"];
}

export async function collectFiles(root) {
  const output = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) output.push(full);
    }
  }
  await walk(root);
  return output;
}

export async function findInstalledApp(root, platform) {
  normalizeSmokePlatform(platform);
  const files = await collectFiles(root);
  if (platform === "win32") {
    const candidates = files.filter(
      (path) => basename(path).toLowerCase() === "translunar cat.exe",
    );
    if (candidates.length !== 1) {
      throw new Error(
        `Expected one installed Translunar CAT.exe, found ${candidates.length}.`,
      );
    }
    return candidates[0];
  }
  const apps = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && entry.name.endsWith(".app")) apps.push(full);
      else if (entry.isDirectory()) await walk(full);
    }
  }
  await walk(root);
  if (apps.length !== 1) {
    throw new Error(
      `Expected one installed .app bundle, found ${apps.length}.`,
    );
  }
  return join(apps[0], "Contents", "MacOS", "Translunar CAT");
}

export function resolvePackagedEngine(appBinary, platform) {
  normalizeSmokePlatform(platform);
  const appRoot =
    platform === "darwin"
      ? resolve(appBinary, "..", "..", "..")
      : dirname(appBinary);
  const binary =
    platform === "win32" ? "translunar-engine.exe" : "translunar-engine";
  const candidates = [
    join(appRoot, "resources", "engine", binary),
    join(appRoot, "Resources", "engine", binary),
    join(appRoot, "resources", "app", "resources", "engine", binary),
  ];
  return candidates[0];
}

export async function sha256File(path) {
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  return digest;
}

export class StdioJsonRpcClient {
  #child = null;
  #nextId = 1;
  #buffer = "";
  #pending = new Map();
  #stderr = [];

  constructor(binary, dataDirectory, options = {}) {
    this.binary = binary;
    this.dataDirectory = dataDirectory;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  get stderrTail() {
    return this.#stderr.slice(-20).join("\n");
  }

  async start() {
    const isNodeScript = /\.[cm]?js$/iu.test(this.binary);
    const command = isNodeScript ? process.execPath : this.binary;
    const commandArgs = isNodeScript
      ? [this.binary, "--data-dir", this.dataDirectory, "--protocol", "stdio"]
      : ["--data-dir", this.dataDirectory, "--protocol", "stdio"];
    this.#child = spawn(command, commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env },
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stderr.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => this.#consume(String(chunk)));
    this.#child.stderr.on("data", (chunk) => {
      this.#stderr.push(...String(chunk).split(/\r?\n/u).filter(Boolean));
      if (this.#stderr.length > 80)
        this.#stderr.splice(0, this.#stderr.length - 80);
    });
    this.#child.once("exit", (code, signal) => {
      const error = new Error(
        `Engine exited (${String(code ?? signal)}).${this.stderrTail ? `\n${this.stderrTail}` : ""}`,
      );
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.#pending.clear();
    });
    await new Promise((resolvePromise, rejectPromise) => {
      this.#child.once("spawn", resolvePromise);
      this.#child.once("error", rejectPromise);
    });
  }

  call(method, params) {
    const child = this.#child;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      return Promise.reject(new Error("Engine process is not running."));
    }
    const id = this.#nextId++;
    const frame = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        rejectPromise(
          new Error(`Timed out waiting for Engine method ${method}.`),
        );
      }, this.timeoutMs);
      this.#pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
      child.stdin.write(frame, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        rejectPromise(error);
      });
    });
  }

  #consume(chunk) {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        for (const pending of this.#pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(
            new Error(`Engine emitted invalid JSON: ${String(error)}`),
          );
        }
        this.#pending.clear();
        return;
      }
      const pending = this.#pending.get(response?.id);
      if (!pending) continue;
      this.#pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) {
        const error = new Error(
          `${response.error.code}: ${response.error.message}`,
        );
        error.code = response.error.code;
        error.data = response.error.data;
        pending.reject(error);
      } else {
        pending.resolve(response.result);
      }
    }
  }

  async stop() {
    const child = this.#child;
    if (!child) return;
    this.#child = null;
    child.stdin.end();
    await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill();
        resolvePromise();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }
}

export async function installWindows(installerPath, installRoot) {
  await mkdir(installRoot, { recursive: true });
  await runCommand(installerPath, windowsInstallerArgs(installRoot), {
    windowsHide: true,
    timeoutMs: INSTALL_SMOKE_TIMEOUT_MS,
  });
}

export async function installMac(installerPath, installRoot) {
  const mountPoint = await mkdtemp(join(tmpdir(), "tl-smoke-mount-"));
  await mkdir(installRoot, { recursive: true });
  let mounted = false;
  try {
    await runCommand("hdiutil", macMountArgs(installerPath, mountPoint), {
      timeoutMs: 60_000,
    });
    mounted = true;
    const mountedApp = await findAppBundle(mountPoint);
    if (!mountedApp)
      throw new Error("Mounted DMG did not contain a .app bundle.");
    await cp(mountedApp, join(installRoot, basename(mountedApp)), {
      recursive: true,
      force: false,
    });
  } finally {
    if (mounted)
      await runCommand("hdiutil", macDetachArgs(mountPoint), {
        timeoutMs: 60_000,
      }).catch(() => undefined);
    await rm(mountPoint, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

async function findAppBundle(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) return full;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const nested = await findAppBundle(full).catch(() => null);
      if (nested) return nested;
    }
  }
  return null;
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(options.cwd ? { cwd: options.cwd } : {}),
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
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(
        new Error(
          `${command} timed out after ${options.timeoutMs ?? 60_000}ms.`,
        ),
      );
    }, options.timeoutMs ?? 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(
          new Error(
            `${command} failed (${String(code ?? signal)}): ${output.slice(-2_000)}`,
          ),
        );
      } else {
        resolvePromise(output);
      }
    });
  });
}

export async function runEngineProbe(engineBinary, dataDirectory) {
  const fixture = join(dataDirectory, "release-smoke.txt");
  await writeFile(fixture, "A release smoke source sentence.\n", "utf8");
  const client = new StdioJsonRpcClient(engineBinary, dataDirectory);
  await client.start();
  try {
    const initialized = await client.call("engine.initialize", {
      protocolVersion: 1,
      client: { name: "release-install-smoke", version: "1.0.0" },
    });
    const health = await client.call("data.checkHealth", {});
    if (!health?.healthy)
      throw new Error("Installed Engine health check reported unhealthy.");
    const project = await client.call("project.create", {
      name: "Release smoke project",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      domain: "general",
    });
    const imported = await client.call("document.import", {
      projectId: project.id,
      sourcePath: fixture,
      relativePath: "release-smoke.txt",
    });
    const page = await client.call("segment.list", {
      documentId: imported.document.id,
      offset: 0,
      limit: 20,
    });
    if (!Array.isArray(page?.items) || page.items.length < 1) {
      throw new Error("Installed Engine imported no usable segments.");
    }
    return {
      protocolVersion: initialized?.protocolVersion ?? null,
      engineVersion: initialized?.engineVersion ?? null,
      healthy: Boolean(health.healthy),
      schemaVersion: health.schemaVersion ?? null,
      projectId: project.id,
      documentId: imported.document.id,
      segmentCount: page.items.length,
    };
  } finally {
    await client.stop();
  }
}

function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
