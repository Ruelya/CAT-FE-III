import { randomUUID } from "node:crypto";
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export const RELEASE_SMOKE_ENV = "TRANSLUNAR_RELEASE_SMOKE";
export const RELEASE_SMOKE_MARKER_ENV = "TRANSLUNAR_SMOKE_READY_FILE";
export const RELEASE_SMOKE_MARKER_KIND = "translunar.app-engine-ready";
export const RELEASE_SMOKE_MARKER_VERSION = 1;

export interface ReleaseSmokeReadinessEvidence {
  kind: typeof RELEASE_SMOKE_MARKER_KIND;
  version: typeof RELEASE_SMOKE_MARKER_VERSION;
  appVersion: string;
  pid: number;
  healthy: true;
  schemaVersion: number | null;
  readyAtMs: number;
}

export interface ReleaseSmokeHealthReport {
  healthy: boolean;
  schemaVersion?: unknown;
}

export function releaseSmokeReadinessRequested(
  env: NodeJS.ProcessEnv,
): boolean {
  return env[RELEASE_SMOKE_ENV] === "1";
}

/**
 * Publish an opt-in, non-sensitive app↔Engine readiness marker. The marker is
 * written only for native release smoke and is never part of the normal
 * product settings or renderer API. A hard-link publication keeps readers
 * from observing a partially written JSON file and refuses clobbering a
 * stale/competing marker.
 */
export async function writeReleaseSmokeReadiness(
  env: NodeJS.ProcessEnv,
  options: {
    appVersion: string;
    health: ReleaseSmokeHealthReport;
    pid?: number;
    nowMs?: number;
  },
): Promise<ReleaseSmokeReadinessEvidence | null> {
  if (!releaseSmokeReadinessRequested(env)) return null;
  const markerPath = env[RELEASE_SMOKE_MARKER_ENV]?.trim();
  if (!markerPath || !isAbsolute(markerPath)) {
    throw new Error(
      `${RELEASE_SMOKE_MARKER_ENV} must be an absolute path when release smoke is enabled.`,
    );
  }
  if (!options.health.healthy) {
    throw new Error(
      "Electron Engine health check failed during release smoke.",
    );
  }
  if (!options.appVersion || options.appVersion.trim() !== options.appVersion) {
    throw new Error(
      "Electron application version is invalid for release smoke.",
    );
  }
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("Release smoke readiness timestamp is invalid.");
  }
  const schemaVersion =
    typeof options.health.schemaVersion === "number" &&
    Number.isSafeInteger(options.health.schemaVersion) &&
    options.health.schemaVersion >= 0
      ? options.health.schemaVersion
      : null;
  const evidence: ReleaseSmokeReadinessEvidence = {
    kind: RELEASE_SMOKE_MARKER_KIND,
    version: RELEASE_SMOKE_MARKER_VERSION,
    appVersion: options.appVersion,
    pid: options.pid ?? process.pid,
    healthy: true,
    schemaVersion,
    readyAtMs: nowMs,
  };
  await publishJsonNoClobber(markerPath, evidence);
  return evidence;
}

async function publishJsonNoClobber(
  markerPath: string,
  value: ReleaseSmokeReadinessEvidence,
): Promise<void> {
  await mkdir(dirname(markerPath), { recursive: true });
  const temporaryPath = join(
    dirname(markerPath),
    `.${markerPath.split(/[\\/]/u).pop() ?? "ready"}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    // Hard-link creation is atomic and no-clobber on both supported filesystems.
    await link(temporaryPath, markerPath);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(
        `Release smoke readiness marker already exists: ${markerPath}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}
