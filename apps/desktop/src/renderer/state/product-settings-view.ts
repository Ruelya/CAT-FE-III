import type {
  RestorePreviewSummary,
  UpdateServiceStatus,
  UpdateStatusSnapshot,
} from "../../shared/product-shell";

export type UpdateCommand =
  | "setMode"
  | "check"
  | "defer"
  | "download"
  | "install"
  | "rollback"
  | "openInstaller";

export function allowedUpdateCommands(
  snapshot: UpdateStatusSnapshot,
): ReadonlySet<UpdateCommand> {
  const allowed = new Set<UpdateCommand>();
  const busy =
    snapshot.recoveryBusy ||
    snapshot.status === "installing" ||
    snapshot.status === "downloading" ||
    snapshot.status === "checking";

  if (!busy && snapshot.status !== "installing") {
    allowed.add("setMode");
  }

  const checkable: UpdateServiceStatus[] = [
    "idle",
    "failed",
    "available",
    "deferred",
    "ready",
    "disabled",
  ];
  if (!busy && checkable.includes(snapshot.status) && snapshot.mode !== "disabled") {
    allowed.add("check");
  }

  if (
    !busy &&
    (snapshot.status === "available" || snapshot.status === "ready") &&
    typeof snapshot.deferredUntilMs === "number"
      ? true
      : snapshot.status === "available" || snapshot.status === "ready"
  ) {
    if (snapshot.status === "available" || snapshot.status === "ready") {
      allowed.add("defer");
    }
  }

  if (!busy && snapshot.status === "available") {
    allowed.add("download");
  }
  if (
    !busy &&
    snapshot.status === "ready" &&
    !snapshot.recoveryBusy
  ) {
    allowed.add("install");
  }
  if (snapshot.canRollback && !snapshot.recoveryBusy) {
    allowed.add("rollback");
  }
  if (snapshot.canOpenInstaller && !snapshot.recoveryBusy) {
    allowed.add("openInstaller");
  }
  return allowed;
}

export function canRunUpdateCommand(
  snapshot: UpdateStatusSnapshot,
  command: UpdateCommand,
): boolean {
  return allowedUpdateCommands(snapshot).has(command);
}

export function decodeRestorePreviewSummary(
  data: unknown,
):
  | { ok: true; preview: RestorePreviewSummary }
  | { ok: false; error: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "Restore preview is missing" };
  }
  const r = data as Record<string, unknown>;
  const path = r.path;
  const confirmationToken = r.confirmationToken;
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, error: "Restore path is invalid" };
  }
  if (typeof confirmationToken !== "string" || confirmationToken.length === 0) {
    return { ok: false, error: "Restore confirmation token is invalid" };
  }
  const formatVersion = r.formatVersion;
  const schemaVersion = r.schemaVersion;
  const engineVersion = r.engineVersion;
  const createdAtMs = r.createdAtMs;
  const fileCount = r.fileCount;
  const totalBytes = r.totalBytes;
  const hashesOk = r.hashesOk;
  const compatible = r.compatible;
  if (
    typeof formatVersion !== "number" ||
    typeof schemaVersion !== "number" ||
    typeof engineVersion !== "string" ||
    typeof createdAtMs !== "number" ||
    typeof fileCount !== "number" ||
    typeof totalBytes !== "number" ||
    typeof hashesOk !== "boolean" ||
    typeof compatible !== "boolean"
  ) {
    return { ok: false, error: "Restore preview fields are incomplete" };
  }
  const freeBytes =
    r.freeBytes === null || r.freeBytes === undefined
      ? null
      : typeof r.freeBytes === "number"
        ? r.freeBytes
        : null;
  const freeBytesLabel =
    typeof r.freeBytesLabel === "string" ? r.freeBytesLabel : "";
  if (!hashesOk) {
    return { ok: false, error: "Backup hashes failed verification" };
  }
  if (!compatible) {
    return { ok: false, error: "Backup is incompatible with this Engine" };
  }
  return {
    ok: true,
    preview: {
      path,
      formatVersion,
      schemaVersion,
      engineVersion,
      createdAtMs,
      fileCount,
      totalBytes,
      hashesOk,
      compatible,
      freeBytes,
      freeBytesLabel,
      confirmationToken,
    },
  };
}

export type DataMigrationPhase =
  | "idle"
  | "selecting"
  | "validating"
  | "readyToConfirm"
  | "migrating"
  | "committed"
  | "error";
