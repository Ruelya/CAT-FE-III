import { describe, expect, it } from "vitest";

import type { UpdateStatusSnapshot } from "../../shared/product-shell";
import {
  allowedUpdateCommands,
  canRunUpdateCommand,
  decodeRestorePreviewSummary,
} from "./product-settings-view";

function snap(
  overrides: Partial<UpdateStatusSnapshot> = {},
): UpdateStatusSnapshot {
  return {
    status: "idle",
    mode: "manual",
    currentVersion: "0.1.0",
    availableVersion: null,
    feedUrl: null,
    deferredUntilMs: null,
    lastCheckedAtMs: null,
    lastError: null,
    downloadPercent: null,
    requiresBackup: false,
    unsigned: false,
    feedKind: "none",
    installLedger: {
      feedKind: "none",
      backupCreatedAtMs: null,
      backupPath: null,
      installStartedAtMs: null,
      installFinishedAtMs: null,
      healthCheckedAtMs: null,
      rollbackRequired: false,
      packagePath: null,
      packageIdentity: null,
      installInvocationAccepted: false,
      claimedInstalled: false,
      pendingRestart: false,
      targetVersion: null,
      previousVersion: null,
      stagedPath: null,
      lastRecoveryAction: null,
      lastRecoveryAtMs: null,
      lastRecoveryOutcome: null,
      recoveryHistoryRecorded: false,
    },
    canRollback: false,
    canOpenInstaller: false,
    recoveryBusy: false,
    ...overrides,
  };
}

describe("product-settings-view", () => {
  it("gates update commands from snapshot", () => {
    expect(canRunUpdateCommand(snap(), "check")).toBe(true);
    expect(canRunUpdateCommand(snap({ status: "available" }), "download")).toBe(
      true,
    );
    expect(canRunUpdateCommand(snap({ status: "ready" }), "install")).toBe(
      true,
    );
    expect(canRunUpdateCommand(snap({ status: "installing" }), "install")).toBe(
      false,
    );
    expect(
      allowedUpdateCommands(snap({ canRollback: true, status: "failed" })).has(
        "rollback",
      ),
    ).toBe(true);
  });

  it("decodes restore preview strictly", () => {
    const good = decodeRestorePreviewSummary({
      path: "/backup.zip",
      formatVersion: 1,
      schemaVersion: 2,
      engineVersion: "0.1.0",
      createdAtMs: 1,
      fileCount: 3,
      totalBytes: 100,
      hashesOk: true,
      compatible: true,
      freeBytes: 1000,
      freeBytesLabel: "1 KB",
      confirmationToken: "tok-1",
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.preview.confirmationToken).toBe("tok-1");
    }
    expect(decodeRestorePreviewSummary(null).ok).toBe(false);
    expect(
      decodeRestorePreviewSummary({
        path: "/x",
        confirmationToken: "t",
        hashesOk: false,
        compatible: true,
        formatVersion: 1,
        schemaVersion: 1,
        engineVersion: "1",
        createdAtMs: 1,
        fileCount: 1,
        totalBytes: 1,
      }).ok,
    ).toBe(false);
  });
});
