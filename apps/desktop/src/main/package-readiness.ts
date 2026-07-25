/** Pure helpers for package size / readiness / arch gates (unit-tested). */

export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
export const MAX_READY_MS = 3 * 60 * 1000;

export function packageSizeOk(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= MAX_PACKAGE_BYTES;
}

export function readinessOk(elapsedMs: number, ready: boolean): boolean {
  return ready && elapsedMs >= 0 && elapsedMs <= MAX_READY_MS;
}

export function noLoginRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  // Product shell never requires cloud login secrets.
  return !env.TRANSLUNAR_FORCE_LOGIN;
}

/** Engine binary file name for the current (or given) platform. */
export function expectedEngineBinaryName(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "translunar-engine.exe" : "translunar-engine";
}

/**
 * Resolve packaging architecture from env override or host arch.
 * Normalizes PROCESSOR_ARCHITECTURE / uname-style values to node arch names.
 */
export function resolvePackageArch(
  env: NodeJS.ProcessEnv = process.env,
  arch: string = process.arch,
): string {
  const raw =
    env.TRANSLUNAR_PACKAGE_ARCH?.trim() ||
    env.PROCESSOR_ARCHITECTURE?.trim() ||
    arch;
  return normalizeArch(raw);
}

export function normalizeArch(value: string): string {
  const lower = value.toLowerCase();
  if (
    lower === "x64" ||
    lower === "amd64" ||
    lower === "x86_64" ||
    lower === "x86-64"
  ) {
    return "x64";
  }
  if (lower === "arm64" || lower === "aarch64" || lower === "arm64e") {
    return "arm64";
  }
  if (
    lower === "ia32" ||
    lower === "x86" ||
    lower === "i386" ||
    lower === "i686"
  ) {
    return "ia32";
  }
  return lower;
}

/** True when the binary basename matches the platform's expected Engine name. */
export function engineBinaryMatchesPlatform(
  name: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? name;
  return base === expectedEngineBinaryName(platform);
}

/**
 * Packaging must target only the host architecture (no cross-arch matrix in
 * a single runner). Returns true when packageArch matches hostArch.
 */
export function assertHostArchOnly(
  packageArch: string,
  hostArch: string = process.arch,
): boolean {
  return normalizeArch(packageArch) === normalizeArch(hostArch);
}
