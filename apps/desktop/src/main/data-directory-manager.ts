import {
  access,
  constants,
  copyFile,
  cp,
  mkdir,
  lstat,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { freeDiskSpace } from "./disk-space.js";
import {
  directoryExists,
  formatBytesLabel,
  pathLooksLikeWorkspace,
  resolveAbsolutePath,
  isPathInside,
  validateAbsoluteCandidate,
} from "./path-safety.js";
import type {
  DataDirectoryMigrationPhase,
  DataDirectoryMigrationResult,
  DataDirectoryStatus,
  DataDirectoryValidation,
  RestoreApplyParams,
  RestorePreviewSummary,
} from "../shared/product-shell.js";

const MIN_FREE_BYTES = 64 * 1024 * 1024;
const RESTORE_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_BACKUP_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_BACKUP_FILES = 100_000;

interface RestoreConfirmationRecord {
  token: string;
  backupPath: string;
  manifestFingerprint: string;
  issuedAtMs: number;
  expiresAtMs: number;
  state: "issued" | "applying" | "consumed";
}

interface BackupManifest {
  formatVersion: number;
  schemaVersion: number;
  engineVersion: string;
  createdAtMs: number;
  files: Array<{ relativePath: string; size: number; sha256: string }>;
}

export interface BackupValidationResult {
  ok: boolean;
  path: string;
  code?: string;
  message?: string;
  manifest?: BackupManifest;
  freeBytes?: number | null;
  /** Set when file digests were fully verified against the manifest. */
  hashesOk: boolean;
  /** Set when format/schema is compatible with the live Engine. */
  compatible: boolean;
}

export interface DataDirectoryEngineBridge {
  stop(): Promise<void>;
  startWithDataDirectory(dataDirectory: string): Promise<void>;
  checkHealth(): Promise<{ healthy: boolean; schemaVersion: number }>;
  createBackup(destinationPath: string): Promise<{
    destinationPath: string;
    manifest: {
      schemaVersion: number;
      engineVersion: string;
      createdAtMs: number;
      files: Array<{ relativePath: string; size: number; sha256: string }>;
    };
  }>;
  getDataDirectory(): string;
  setDataDirectory(path: string): void;
}

export type QuarantinePath = (
  sourcePath: string,
  quarantinePath: string,
) => Promise<void>;

export interface DataDirectoryManagerOptions {
  isTestOverride?: boolean;
  /** Test seam for the rollback-only quarantine rename. */
  quarantinePath?: QuarantinePath;
}

export class DataDirectoryManager {
  #livePath: string;
  #phase: DataDirectoryMigrationPhase = "ready";
  readonly #isTestOverride: boolean;
  readonly #engine: DataDirectoryEngineBridge;
  readonly #quarantinePath: QuarantinePath;
  /** At most one outstanding restore confirmation; replaced by a new preview. */
  #restoreConfirmation: RestoreConfirmationRecord | null = null;

  constructor(
    livePath: string,
    engine: DataDirectoryEngineBridge,
    options?: DataDirectoryManagerOptions,
  ) {
    this.#livePath = resolveAbsolutePath(livePath);
    this.#engine = engine;
    this.#isTestOverride = options?.isTestOverride === true;
    this.#quarantinePath = options?.quarantinePath ?? rename;
  }

  get phase(): DataDirectoryMigrationPhase {
    return this.#phase;
  }

  get livePath(): string {
    return this.#livePath;
  }

  get isTestOverride(): boolean {
    return this.#isTestOverride;
  }

  async status(): Promise<DataDirectoryStatus> {
    const absolutePath = this.#livePath;
    const exists = await directoryExists(absolutePath);
    let writable = false;
    if (exists) {
      try {
        await access(absolutePath, constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
    }
    const freeBytes = await freeDiskSpace(absolutePath);
    let healthy: boolean | null;
    let schemaVersion: number | null = null;
    try {
      const report = await this.#engine.checkHealth();
      healthy = report.healthy;
      schemaVersion = report.schemaVersion;
    } catch {
      healthy = null;
    }
    return {
      path: absolutePath,
      absolutePath,
      exists,
      writable,
      freeBytes,
      freeBytesLabel:
        freeBytes === null ? "unknown" : formatBytesLabel(freeBytes),
      isTestOverride: this.#isTestOverride,
      healthy,
      schemaVersion,
    };
  }

  async validateTarget(target: string): Promise<DataDirectoryValidation> {
    const candidate = validateAbsoluteCandidate(target, this.#livePath);
    if (!candidate.ok) {
      return {
        ok: false,
        path: target,
        code: candidate.code,
        message: candidate.message,
      };
    }
    const absolute = candidate.path;
    // Never create or delete the final target during validation.
    if (await pathExists(absolute)) {
      if (await pathLooksLikeWorkspace(absolute)) {
        return {
          ok: false,
          path: absolute,
          code: "existing_workspace",
          message:
            "Target already looks like an unrelated Translunar workspace.",
        };
      }
      return {
        ok: false,
        path: absolute,
        code: "destination_exists",
        message: "Target path already exists.",
      };
    }
    try {
      await assertWritableAncestorDirectory(absolute);
    } catch {
      return {
        ok: false,
        path: absolute,
        code: "not_writable",
        message: "Target directory is not writable.",
      };
    }
    const freeBytes = await freeDiskSpace(absolute);
    if (freeBytes !== null && freeBytes < MIN_FREE_BYTES) {
      return {
        ok: false,
        path: absolute,
        code: "insufficient_space",
        message: "Target volume does not have enough free space.",
        freeBytes,
      };
    }
    return { ok: true, path: absolute, freeBytes: freeBytes ?? undefined };
  }

  async migrate(target: string): Promise<DataDirectoryMigrationResult> {
    const sourcePath = this.#livePath;
    this.#phase = "validating";
    const validation = await this.validateTarget(target);
    if (!validation.ok) {
      this.#phase = "ready";
      return this.#migrationResult({
        ok: false,
        phase: "validating",
        sourcePath,
        targetPath: target,
        code: validation.code,
        message: validation.message,
      });
    }
    const targetPath = validation.path;
    const stagingPath = `${targetPath}.staging-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      // Quiesce the Engine before copying live workspace data.
      this.#phase = "stopping-engine";
      await this.#engine.stop();

      this.#phase = "staging-copy";
      await mkdir(dirname(stagingPath), { recursive: true });
      if (await directoryExists(sourcePath)) {
        await cp(sourcePath, stagingPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      } else {
        await mkdir(stagingPath, { recursive: true });
      }

      await verifyDirectoryCopy(sourcePath, stagingPath);

      if (
        (await pathLooksLikeWorkspace(sourcePath)) &&
        !(await pathLooksLikeWorkspace(stagingPath))
      ) {
        throw Object.assign(
          new Error("Staged workspace is incomplete after copy."),
          { code: "staging_incomplete" },
        );
      }

      this.#phase = "health-check";
      await this.#engine.startWithDataDirectory(stagingPath);
      const health = await this.#engine.checkHealth();
      if (!health.healthy) {
        throw Object.assign(
          new Error("Staged workspace failed health check."),
          {
            code: "health_failed",
          },
        );
      }

      await this.#engine.stop();

      this.#phase = "swapping";
      // Reserve the final directory atomically and copy into that reservation.
      // Node's directory rename can replace an existing target on POSIX, so a
      // check-then-rename sequence is not a portable no-clobber boundary.
      await publishDirectoryNoClobber(stagingPath, targetPath);
      await verifyDirectoryCopy(sourcePath, targetPath);
      await rm(stagingPath, { recursive: true, force: true });

      // Keep original live directory untouched at sourcePath until committed.
      this.#livePath = targetPath;
      this.#engine.setDataDirectory(targetPath);

      this.#phase = "restarting-engine";
      await this.#engine.startWithDataDirectory(targetPath);
      const liveHealth = await this.#engine.checkHealth();
      if (!liveHealth.healthy) {
        throw Object.assign(
          new Error("Live workspace failed health after swap."),
          { code: "post_swap_health_failed" },
        );
      }

      this.#phase = "committed";
      return this.#migrationResult({
        ok: true,
        phase: "committed",
        sourcePath,
        targetPath,
      });
    } catch (error) {
      this.#phase = "rollback";
      await this.#engine.stop().catch(() => undefined);
      await rm(stagingPath, { recursive: true, force: true }).catch(
        () => undefined,
      );
      // Never delete the original source on failure; restore and restart it.
      this.#livePath = sourcePath;
      this.#engine.setDataDirectory(sourcePath);
      try {
        await this.#engine.startWithDataDirectory(sourcePath);
      } catch {
        // leave rollback message as primary failure
      }
      this.#phase = "ready";
      return this.#migrationResult({
        ok: false,
        phase: "rollback",
        sourcePath,
        targetPath,
        code:
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "migrate_failed")
            : "migrate_failed",
        message:
          error instanceof Error
            ? error.message
            : "Data directory migration failed.",
      });
    }
  }

  async createBackup(destinationPath: string): Promise<{
    destinationPath: string;
    manifest: {
      schemaVersion: number;
      engineVersion: string;
      createdAtMs: number;
      files: Array<{ relativePath: string; size: number; sha256: string }>;
    };
  }> {
    const absolute = resolveAbsolutePath(destinationPath);
    try {
      await access(absolute, constants.F_OK);
      throw Object.assign(new Error("Backup destination already exists."), {
        code: "destination_exists",
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "destination_exists"
      ) {
        throw error;
      }
    }
    return this.#engine.createBackup(absolute);
  }

  async validateBackup(backupPath: string): Promise<BackupValidationResult> {
    const absolute = resolveAbsolutePath(backupPath);
    const manifestPath = join(absolute, "manifest.json");
    let hashesOk = false;
    let compatible = false;
    try {
      const manifestInfo = await lstat(manifestPath);
      if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) {
        return {
          ok: false,
          path: absolute,
          code: "unsafe_manifest",
          message: "Backup manifest must be a regular file.",
          hashesOk: false,
          compatible: false,
        };
      }
      if (manifestInfo.size > MAX_BACKUP_MANIFEST_BYTES) {
        return {
          ok: false,
          path: absolute,
          code: "manifest_too_large",
          message: "Backup manifest exceeds the permitted size.",
          hashesOk: false,
          compatible: false,
        };
      }
      const raw = await readFile(manifestPath, "utf8");
      const rawBytes = Buffer.byteLength(raw, "utf8");
      const manifestInfoAfterRead = await lstat(manifestPath);
      if (
        manifestInfoAfterRead.isSymbolicLink() ||
        !manifestInfoAfterRead.isFile()
      ) {
        return {
          ok: false,
          path: absolute,
          code: "unsafe_manifest",
          message: "Backup manifest changed while it was being read.",
          hashesOk: false,
          compatible: false,
        };
      }
      if (
        rawBytes > MAX_BACKUP_MANIFEST_BYTES ||
        manifestInfoAfterRead.size !== rawBytes
      ) {
        return {
          ok: false,
          path: absolute,
          code: "manifest_too_large",
          message: "Backup manifest exceeds the permitted size.",
          hashesOk: false,
          compatible: false,
        };
      }
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
        return {
          ok: false,
          path: absolute,
          code: "invalid_manifest",
          message: "Backup manifest is malformed.",
          hashesOk: false,
          compatible: false,
        };
      }
      if (parsed.files.length === 0 || parsed.files.length > MAX_BACKUP_FILES) {
        return {
          ok: false,
          path: absolute,
          code: "manifest_too_many_files",
          message: "Backup manifest contains an invalid number of files.",
          hashesOk: false,
          compatible: false,
        };
      }
      const formatVersion = Number(parsed.formatVersion ?? 0);
      const schemaVersion = Number(parsed.schemaVersion ?? 0);
      const createdAtMs = Number(parsed.createdAtMs ?? 0);
      if (
        formatVersion !== 1 ||
        !Number.isSafeInteger(schemaVersion) ||
        schemaVersion < 0 ||
        !Number.isSafeInteger(createdAtMs) ||
        createdAtMs < 0
      ) {
        return {
          ok: false,
          path: absolute,
          code: "incompatible_manifest",
          message: "Backup format or schema version is unsupported.",
          hashesOk: false,
          compatible: false,
        };
      }
      const files: BackupManifest["files"] = [];
      const pathKeys = new Set<string>();
      let totalBytes = 0;
      for (const rawFile of parsed.files) {
        if (!isRecord(rawFile)) {
          return {
            ok: false,
            path: absolute,
            code: "invalid_manifest",
            message: "Backup manifest contains a malformed file entry.",
            hashesOk: false,
            compatible: false,
          };
        }
        const relativePath = normalizeManifestRelativePath(
          rawFile.relativePath ?? rawFile.relative_path,
        );
        if (!relativePath || relativePath === "manifest.json") {
          return {
            ok: false,
            path: absolute,
            code: "unsafe_path",
            message: "Backup contains an unsafe or reserved relative path.",
            hashesOk: false,
            compatible: false,
          };
        }
        const pathKey = relativePath.toLowerCase();
        if (pathKeys.has(pathKey)) {
          return {
            ok: false,
            path: absolute,
            code: "duplicate_path",
            message: `Backup manifest contains a duplicate path: ${relativePath}`,
            hashesOk: false,
            compatible: false,
          };
        }
        pathKeys.add(pathKey);
        const size = Number(rawFile.size ?? 0);
        const sha256 = stringField(rawFile.sha256).toLowerCase();
        if (
          !Number.isSafeInteger(size) ||
          size < 0 ||
          !/^[a-f0-9]{64}$/u.test(sha256)
        ) {
          return {
            ok: false,
            path: absolute,
            code: "invalid_manifest",
            message: `Backup manifest contains an invalid file entry: ${relativePath}`,
            hashesOk: false,
            compatible: false,
          };
        }
        if (totalBytes > Number.MAX_SAFE_INTEGER - size) {
          return {
            ok: false,
            path: absolute,
            code: "manifest_too_large",
            message: "Backup manifest file sizes exceed the safe limit.",
            hashesOk: false,
            compatible: false,
          };
        }
        totalBytes += size;
        files.push({ relativePath, size, sha256 });
      }
      if (!files.some((file) => file.relativePath === "translunar.sqlite3")) {
        return {
          ok: false,
          path: absolute,
          code: "invalid_workspace_shape",
          message: "Backup does not contain a complete workspace.",
          hashesOk: false,
          compatible: false,
        };
      }
      for (const file of files) {
        const full = resolveManifestFilePath(absolute, file.relativePath);
        if (!full || !isPathInside(absolute, full) || full === absolute) {
          return {
            ok: false,
            path: absolute,
            code: "unsafe_path",
            message: "Backup contains an unsafe relative path.",
            hashesOk: false,
            compatible: false,
          };
        }
        const info = await lstat(full);
        if (
          info.isSymbolicLink() ||
          !info.isFile() ||
          info.size !== file.size
        ) {
          return {
            ok: false,
            path: absolute,
            code: "size_mismatch",
            message: `Backup file size mismatch: ${file.relativePath}`,
            hashesOk: false,
            compatible: false,
          };
        }
        const digest = await sha256File(full);
        if (digest !== file.sha256) {
          return {
            ok: false,
            path: absolute,
            code: "hash_mismatch",
            message: `Backup file hash mismatch: ${file.relativePath}`,
            hashesOk: false,
            compatible: false,
          };
        }
      }
      const unexpected = await findUnexpectedBackupEntry(absolute, pathKeys);
      if (unexpected) {
        return {
          ok: false,
          path: absolute,
          code: unexpected.code,
          message: unexpected.message,
          hashesOk: false,
          compatible: false,
        };
      }
      hashesOk = true;
      const currentHealth = await this.#engine.checkHealth();
      if (schemaVersion > currentHealth.schemaVersion) {
        return {
          ok: false,
          path: absolute,
          code: "schema_too_new",
          message: "Backup was created by a newer, incompatible Engine schema.",
          hashesOk: true,
          compatible: false,
        };
      }
      compatible = true;
      const freeBytes = await freeDiskSpace(this.#livePath);
      const requiredBytes =
        totalBytes > Number.MAX_SAFE_INTEGER - MIN_FREE_BYTES
          ? Number.MAX_SAFE_INTEGER
          : totalBytes + MIN_FREE_BYTES;
      if (freeBytes !== null && freeBytes < requiredBytes) {
        return {
          ok: false,
          path: absolute,
          code: "insufficient_space",
          message: "Not enough free space to restore this backup.",
          freeBytes,
          hashesOk: true,
          compatible: true,
        };
      }
      return {
        ok: true,
        path: absolute,
        freeBytes,
        hashesOk: true,
        compatible: true,
        manifest: {
          formatVersion,
          schemaVersion,
          engineVersion: stringField(parsed.engineVersion),
          createdAtMs,
          files,
        },
      };
    } catch (error) {
      return {
        ok: false,
        path: absolute,
        code: "invalid_backup",
        message:
          error instanceof Error ? error.message : "Backup validation failed.",
        hashesOk,
        compatible,
      };
    }
  }

  /**
   * Validate a backup and issue a single-use confirmation token bound to the
   * canonical path and exact validated manifest/hash fingerprint.
   */
  async previewRestore(backupPath: string): Promise<{
    ok: boolean;
    code?: string;
    message?: string;
    summary?: RestorePreviewSummary;
  }> {
    if (this.#restoreConfirmation?.state === "applying") {
      return {
        ok: false,
        code: "restore_in_progress",
        message: "A workspace restore is already in progress.",
      };
    }
    const validation = await this.validateBackup(backupPath);
    if (!validation.ok || !validation.manifest) {
      return {
        ok: false,
        ...(validation.code ? { code: validation.code } : {}),
        ...(validation.message ? { message: validation.message } : {}),
      };
    }
    if (!validation.hashesOk || !validation.compatible) {
      return {
        ok: false,
        code: validation.code ?? "invalid_backup",
        message:
          validation.message ??
          "Backup failed hash or compatibility validation.",
      };
    }

    const manifest = validation.manifest;
    const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
    const freeBytes = validation.freeBytes ?? null;
    const fingerprint = fingerprintBackupManifest(validation.path, manifest);
    const now = Date.now();
    const token = randomBytes(32).toString("base64url");
    this.#restoreConfirmation = {
      token,
      backupPath: validation.path,
      manifestFingerprint: fingerprint,
      issuedAtMs: now,
      expiresAtMs: now + RESTORE_TOKEN_TTL_MS,
      state: "issued",
    };

    const summary: RestorePreviewSummary = {
      path: validation.path,
      formatVersion: manifest.formatVersion,
      schemaVersion: manifest.schemaVersion,
      engineVersion: manifest.engineVersion,
      createdAtMs: manifest.createdAtMs,
      fileCount: manifest.files.length,
      totalBytes,
      hashesOk: validation.hashesOk,
      compatible: validation.compatible,
      freeBytes,
      freeBytesLabel:
        freeBytes === null ? "unknown" : formatBytesLabel(freeBytes),
      confirmationToken: token,
    };
    return { ok: true, summary };
  }

  /**
   * Apply a previously previewed restore. Requires the opaque confirmation
   * token; revalidates the bound backup before any Engine stop/swap.
   */
  async restoreFromConfirmedPreview(
    params: RestoreApplyParams,
  ): Promise<DataDirectoryMigrationResult> {
    const sourcePath = this.#livePath;
    const requestedPath =
      typeof params.path === "string" ? params.path.trim() : "";
    const token =
      typeof params.confirmationToken === "string"
        ? params.confirmationToken.trim()
        : "";

    if (!requestedPath || !token) {
      return this.#migrationResult({
        ok: false,
        phase: "validating",
        sourcePath,
        targetPath: requestedPath || "",
        code: "missing_confirmation",
        message: "Restore requires a path and confirmation token from preview.",
      });
    }

    const gate = this.#consumeRestoreTokenGate(token, requestedPath);
    if (!gate.ok) {
      return this.#migrationResult({
        ok: false,
        phase: "validating",
        sourcePath,
        targetPath: requestedPath,
        code: gate.code,
        message: gate.message,
      });
    }

    // Revalidate immediately before staging; reject without stopping Engine.
    const validation = await this.validateBackup(gate.record.backupPath);
    if (!validation.ok || !validation.manifest || !validation.hashesOk) {
      this.#invalidateRestoreToken(token);
      return this.#migrationResult({
        ok: false,
        phase: "validating",
        sourcePath,
        targetPath: gate.record.backupPath,
        code: validation.code ?? "revalidation_failed",
        message:
          validation.message ??
          "Backup revalidation failed after preview; live workspace unchanged.",
      });
    }
    const fingerprint = fingerprintBackupManifest(
      validation.path,
      validation.manifest,
    );
    if (
      fingerprint !== gate.record.manifestFingerprint ||
      validation.path !== gate.record.backupPath
    ) {
      this.#invalidateRestoreToken(token);
      return this.#migrationResult({
        ok: false,
        phase: "validating",
        sourcePath,
        targetPath: gate.record.backupPath,
        code: "backup_changed",
        message:
          "Backup contents changed after preview; request a fresh preview.",
      });
    }
    if (!validation.compatible) {
      this.#invalidateRestoreToken(token);
      return this.#migrationResult({
        ok: false,
        phase: "validating",
        sourcePath,
        targetPath: gate.record.backupPath,
        code: validation.code ?? "incompatible_manifest",
        message:
          validation.message ??
          "Backup is no longer compatible with the Engine.",
      });
    }

    const result = await this.#performRestore(
      validation.path,
      validation.manifest,
    );
    if (result.ok) {
      this.#markRestoreTokenConsumed(token);
    } else {
      // Failed attempt invalidates the token so it cannot be replayed.
      this.#invalidateRestoreToken(token);
    }
    return result;
  }

  /**
   * Trusted main-process restore (e.g. update recovery). Product-shell IPC
   * must use {@link restoreFromConfirmedPreview} with a preview token.
   */
  async restoreFromBackup(
    backupPath: string,
  ): Promise<DataDirectoryMigrationResult> {
    const sourcePath = this.#livePath;
    this.#phase = "validating";
    const validation = await this.validateBackup(backupPath);
    if (!validation.ok || !validation.manifest || !validation.hashesOk) {
      this.#phase = "ready";
      return this.#migrationResult({
        ok: false,
        phase: "validating",
        sourcePath,
        targetPath: backupPath,
        code: validation.code,
        message: validation.message,
      });
    }
    return this.#performRestore(validation.path, validation.manifest);
  }

  #consumeRestoreTokenGate(
    token: string,
    requestedPath: string,
  ):
    | { ok: true; record: RestoreConfirmationRecord }
    | { ok: false; code: string; message: string } {
    const record = this.#restoreConfirmation;
    if (!record || record.token !== token) {
      return {
        ok: false,
        code: "invalid_confirmation",
        message: "Restore confirmation token is unknown or has been replaced.",
      };
    }
    if (record.state === "consumed") {
      return {
        ok: false,
        code: "confirmation_consumed",
        message: "Restore confirmation token was already used.",
      };
    }
    if (record.state === "applying") {
      return {
        ok: false,
        code: "confirmation_in_progress",
        message: "Restore confirmation token is already being applied.",
      };
    }
    if (Date.now() > record.expiresAtMs) {
      this.#invalidateRestoreToken(token);
      return {
        ok: false,
        code: "confirmation_expired",
        message: "Restore confirmation token expired; preview again.",
      };
    }
    const canonicalRequested = resolveAbsolutePath(requestedPath);
    if (canonicalRequested !== record.backupPath) {
      return {
        ok: false,
        code: "confirmation_path_mismatch",
        message:
          "Restore path does not match the preview confirmation binding.",
      };
    }
    // Reserve synchronously before any await so concurrent apply calls cannot
    // both pass the gate with the same token.
    const applying: RestoreConfirmationRecord = {
      ...record,
      state: "applying",
    };
    this.#restoreConfirmation = applying;
    return { ok: true, record: applying };
  }

  #invalidateRestoreToken(token: string): void {
    if (this.#restoreConfirmation?.token === token) {
      this.#restoreConfirmation = null;
    }
  }

  #markRestoreTokenConsumed(token: string): void {
    if (this.#restoreConfirmation?.token === token) {
      this.#restoreConfirmation = {
        ...this.#restoreConfirmation,
        state: "consumed",
      };
    }
  }

  async #performRestore(
    absoluteBackupPath: string,
    manifest: BackupManifest,
  ): Promise<DataDirectoryMigrationResult> {
    const sourcePath = this.#livePath;
    this.#phase = "validating";

    const stagingParent = dirname(sourcePath);
    const stagingPath = join(
      stagingParent,
      `${basename(sourcePath)}.restore-staging-${process.pid}-${randomBytes(6).toString("hex")}`,
    );
    const previousPath = join(
      stagingParent,
      `${basename(sourcePath)}.pre-restore-${process.pid}-${randomBytes(6).toString("hex")}`,
    );
    const failedPublishedPath = join(
      stagingParent,
      `${basename(sourcePath)}.restore-failed-${process.pid}-${randomBytes(6).toString("hex")}`,
    );
    let sourceMoved = false;
    let stagedPublished = false;

    try {
      this.#phase = "staging-copy";
      if (
        (await pathExists(stagingPath)) ||
        (await pathExists(previousPath)) ||
        (await pathExists(failedPublishedPath))
      ) {
        throw restoreFileError(
          "restore_path_exists",
          "A restore staging path is already occupied.",
        );
      }
      await copyValidatedBackupFiles(absoluteBackupPath, stagingPath, manifest);

      this.#phase = "health-check";
      await this.#engine.stop();
      await this.#engine.startWithDataDirectory(stagingPath);
      const stagedHealth = await this.#engine.checkHealth();
      if (!stagedHealth.healthy) {
        throw Object.assign(
          new Error("Restored staging failed health check."),
          {
            code: "health_failed",
          },
        );
      }

      this.#phase = "stopping-engine";
      await this.#engine.stop();

      this.#phase = "swapping";
      // Preserve live workspace until the restored engine is healthy.
      // previousPath is unique per attempt — never check-then-delete a competitor.
      if (await directoryExists(sourcePath)) {
        await rename(sourcePath, previousPath);
        sourceMoved = true;
      }
      await publishDirectoryNoClobber(stagingPath, sourcePath);
      stagedPublished = true;
      await verifyDirectoryCopy(stagingPath, sourcePath);
      await rm(stagingPath, { recursive: true, force: true });
      this.#livePath = sourcePath;
      this.#engine.setDataDirectory(sourcePath);

      this.#phase = "restarting-engine";
      await this.#engine.startWithDataDirectory(sourcePath);
      const liveHealth = await this.#engine.checkHealth();
      if (!liveHealth.healthy) {
        throw Object.assign(
          new Error("Restored live workspace failed health check."),
          { code: "post_swap_health_failed" },
        );
      }

      // Only remove the pre-restore copy after successful open.
      await rm(previousPath, { recursive: true, force: true }).catch(
        () => undefined,
      );
      this.#phase = "committed";
      return this.#migrationResult({
        ok: true,
        phase: "committed",
        sourcePath,
        targetPath: absoluteBackupPath,
      });
    } catch (error) {
      this.#phase = "rollback";
      await this.#engine.stop().catch(() => undefined);
      await rm(stagingPath, { recursive: true, force: true }).catch(
        () => undefined,
      );
      let rollbackPath = sourcePath;
      if (sourceMoved && (await directoryExists(previousPath))) {
        if (await pathExists(sourcePath)) {
          // Whether this is our partially/fully published restore or a path a
          // competitor created after the live directory moved, preserve it by
          // quarantining it. Never recursively delete an unknown occupant.
          await this.#quarantinePath(sourcePath, failedPublishedPath).catch(
            () => undefined,
          );
        }
        if (!(await pathExists(sourcePath))) {
          await rename(previousPath, sourcePath).catch(() => undefined);
        }
        if (await pathExists(previousPath)) {
          // If the original path could not be reclaimed, keep the known-good
          // pre-restore workspace live at its rollback artifact path instead
          // of starting the Engine against an unknown competitor.
          rollbackPath = previousPath;
        }
      } else if (stagedPublished && (await pathExists(sourcePath))) {
        await this.#quarantinePath(sourcePath, failedPublishedPath).catch(
          () => undefined,
        );
      }
      this.#livePath = rollbackPath;
      this.#engine.setDataDirectory(rollbackPath);
      await this.#engine
        .startWithDataDirectory(rollbackPath)
        .catch(() => undefined);
      this.#phase = "ready";
      return this.#migrationResult({
        ok: false,
        phase: "rollback",
        sourcePath,
        targetPath: absoluteBackupPath,
        code:
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "restore_failed")
            : "restore_failed",
        message:
          error instanceof Error ? error.message : "Workspace restore failed.",
      });
    }
  }

  #migrationResult(
    fields: Omit<DataDirectoryMigrationResult, "activePath">,
  ): DataDirectoryMigrationResult {
    return {
      ...fields,
      activePath: this.#livePath,
    };
  }
}

interface BackupEntryProblem {
  code: string;
  message: string;
}

function normalizeManifestRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return null;
  }
  const parts = value.split("/");
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.includes(":") ||
        part.includes("\0"),
    )
  ) {
    return null;
  }
  const normalized = parts.join("/");
  return normalized === value ? normalized : null;
}

function resolveManifestFilePath(
  root: string,
  relativePath: string,
): string | null {
  const normalized = normalizeManifestRelativePath(relativePath);
  if (!normalized) return null;
  const full = resolve(root, ...normalized.split("/"));
  return full !== resolve(root) && isPathInside(root, full) ? full : null;
}

async function findUnexpectedBackupEntry(
  root: string,
  listedPathKeys: ReadonlySet<string>,
): Promise<BackupEntryProblem | null> {
  let fileCount = 0;
  const visit = async (
    directory: string,
    relativeDirectory: string,
  ): Promise<BackupEntryProblem | null> => {
    const directoryInfo = await lstat(directory);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      return {
        code: "unsafe_backup_entry",
        message: "Backup contains a non-directory workspace entry.",
      };
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const full = join(directory, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) {
        return {
          code: "unsafe_backup_entry",
          message: `Backup contains a symbolic link: ${relativePath}`,
        };
      }
      if (info.isDirectory()) {
        const nested = await visit(full, relativePath);
        if (nested) return nested;
        continue;
      }
      if (!info.isFile()) {
        return {
          code: "unsafe_backup_entry",
          message: `Backup contains an unsupported entry: ${relativePath}`,
        };
      }
      if (relativePath === "manifest.json") continue;
      fileCount += 1;
      if (fileCount > MAX_BACKUP_FILES) {
        return {
          code: "manifest_too_many_files",
          message: "Backup contains too many files.",
        };
      }
      if (!listedPathKeys.has(relativePath.toLowerCase())) {
        return {
          code: "extra_backup_file",
          message: `Backup contains a file not listed in its manifest: ${relativePath}`,
        };
      }
    }
    return null;
  };

  return visit(root, "");
}

function restoreFileError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function verifyManifestFile(
  path: string,
  file: BackupManifest["files"][number],
): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size !== file.size) {
    throw restoreFileError(
      "backup_changed",
      `Backup file changed during restore: ${file.relativePath}`,
    );
  }
  const digest = await sha256File(path);
  if (digest !== file.sha256) {
    throw restoreFileError(
      "backup_changed",
      `Backup file hash changed during restore: ${file.relativePath}`,
    );
  }
}

async function copyValidatedBackupFiles(
  backupPath: string,
  stagingPath: string,
  manifest: BackupManifest,
): Promise<void> {
  await mkdir(stagingPath, { recursive: true });
  for (const file of manifest.files) {
    const source = resolveManifestFilePath(backupPath, file.relativePath);
    const destination = resolveManifestFilePath(stagingPath, file.relativePath);
    if (!source || !destination) {
      throw restoreFileError(
        "unsafe_path",
        `Backup contains an unsafe relative path: ${file.relativePath}`,
      );
    }
    await verifyManifestFile(source, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await verifyManifestFile(destination, file);
    // Re-check the source after copying to close the common source-replaced
    // TOCTOU window. A changed source invalidates the whole staged restore.
    await verifyManifestFile(source, file);
  }
}

function fingerprintBackupManifest(
  absolutePath: string,
  manifest: BackupManifest,
): string {
  const hash = createHash("sha256");
  hash.update(absolutePath);
  hash.update("\0");
  hash.update(String(manifest.formatVersion));
  hash.update("\0");
  hash.update(String(manifest.schemaVersion));
  hash.update("\0");
  hash.update(manifest.engineVersion);
  hash.update("\0");
  hash.update(String(manifest.createdAtMs));
  hash.update("\0");
  const files = [...manifest.files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reserve a final directory without replacing an existing path, then copy the
 * complete staged tree into that reservation with per-entry no-overwrite
 * semantics. The caller owns verification and staging cleanup. On failure the
 * destination is intentionally preserved as an inspectable incomplete
 * artifact; this function never recursively deletes a potentially contested
 * final path.
 */
async function publishDirectoryNoClobber(
  stagingPath: string,
  destinationPath: string,
): Promise<void> {
  try {
    await mkdir(destinationPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: string }).code) === "EEXIST"
    ) {
      throw restoreFileError(
        "destination_exists",
        "Destination path already exists.",
      );
    }
    throw error;
  }

  const entries = await readdir(stagingPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const source = join(stagingPath, entry.name);
    const destination = join(destinationPath, entry.name);
    await cp(source, destination, {
      recursive: entry.isDirectory(),
      force: false,
      errorOnExist: true,
    });
  }
}

/**
 * Verify a staged directory is an exact regular-file copy of the quiesced
 * source. This keeps SQLite/WAL and managed-file changes from being silently
 * lost between the copy and staged Engine health check.
 */
async function verifyDirectoryCopy(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const sourceExists = await pathExists(sourcePath);
  const targetExists = await pathExists(targetPath);
  if (!sourceExists) {
    if (!targetExists) {
      throw Object.assign(new Error("Staged workspace was not created."), {
        code: "staging_incomplete",
      });
    }
    return;
  }
  if (!targetExists) {
    throw Object.assign(
      new Error("Staged workspace shape differs from source."),
      {
        code: "staging_incomplete",
      },
    );
  }

  const sourceFiles = await listRegularFiles(sourcePath);
  const targetFiles = await listRegularFiles(targetPath);
  if (sourceFiles.length !== targetFiles.length) {
    throw Object.assign(
      new Error("Staged workspace file set differs from source."),
      {
        code: "staging_mismatch",
      },
    );
  }
  const targetByRelative = new Map(
    targetFiles.map((file) => [file.relativePath, file]),
  );
  for (const source of sourceFiles) {
    const target = targetByRelative.get(source.relativePath);
    if (
      !target ||
      target.size !== source.size ||
      target.sha256 !== source.sha256
    ) {
      throw Object.assign(
        new Error(`Staged workspace differs at ${source.relativePath}.`),
        { code: "staging_mismatch" },
      );
    }
  }
}

interface RegularFileSnapshot {
  relativePath: string;
  size: number;
  sha256: string;
}

async function listRegularFiles(root: string): Promise<RegularFileSnapshot[]> {
  const output: RegularFileSnapshot[] = [];
  const visit = async (directory: string, relativeDirectory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(directory, entry.name);
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const info = await lstat(full);
      if (info.isSymbolicLink()) {
        throw Object.assign(
          new Error(`Workspace contains a symbolic link: ${relativePath}`),
          { code: "unsafe_workspace_entry" },
        );
      }
      if (info.isDirectory()) {
        await visit(full, relativePath);
      } else if (info.isFile()) {
        output.push({
          relativePath,
          size: info.size,
          sha256: await sha256File(full),
        });
      } else {
        throw Object.assign(
          new Error(`Workspace contains an unsupported entry: ${relativePath}`),
          { code: "unsafe_workspace_entry" },
        );
      }
    }
  };
  await visit(root, "");
  output.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return output;
}

async function assertWritableAncestorDirectory(path: string): Promise<void> {
  let current = dirname(resolveAbsolutePath(path));
  for (;;) {
    try {
      await access(current, constants.W_OK);
      return;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        throw new Error("Target parent is not writable.");
      }
      current = parent;
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function copyFileIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  try {
    await access(source, constants.F_OK);
  } catch {
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export function resolveDataDirectory(options: {
  envOverride?: string;
  settingsPath?: string | null;
  defaultPath: string;
}): { path: string; isTestOverride: boolean } {
  if (options.envOverride && options.envOverride.trim()) {
    return {
      path: resolve(options.envOverride),
      isTestOverride: true,
    };
  }
  if (options.settingsPath && options.settingsPath.trim()) {
    return {
      path: resolve(options.settingsPath),
      isTestOverride: false,
    };
  }
  return { path: resolve(options.defaultPath), isTestOverride: false };
}

export function resolveBackupDestinationInput(
  destinationPath: unknown,
  testOverride?: string | null,
):
  | { ok: true; path: string }
  | { ok: false; code: "canceled"; message: string } {
  if (typeof destinationPath === "string" && destinationPath.trim()) {
    return { ok: true, path: destinationPath.trim() };
  }
  if (typeof testOverride === "string" && testOverride.trim()) {
    return { ok: true, path: testOverride.trim() };
  }
  return {
    ok: false,
    code: "canceled",
    message: "Backup destination selection was canceled.",
  };
}
