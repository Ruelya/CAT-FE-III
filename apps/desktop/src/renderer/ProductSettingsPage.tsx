import { useCallback, useEffect, useRef, useState } from "react";
import type { AiProviderProfile, Project } from "@translunar/contracts";

import { useLocale } from "./i18n/LocaleProvider";
import { localizeShellError } from "./shell-error";
import { useFocusTrap } from "./useFocusTrap";
import type {
  DataDirectoryStatus,
  ProductShellSettings,
  RestorePreviewSummary,
  UpdateMode,
  UpdateStatusSnapshot,
} from "../shared/product-shell";

interface ProductSettingsPageProps {
  project?: Project | null;
  onClose: () => void;
  onOpenExample: () => void;
  onRestartTutorial: () => void;
  onWorkspaceReloaded?: () => void;
}

export function ProductSettingsPage({
  project,
  onClose,
  onOpenExample,
  onRestartTutorial,
  onWorkspaceReloaded,
}: ProductSettingsPageProps) {
  const { t, locale, setLocale, locales, formatBytes, formatDate } =
    useLocale();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState<ProductShellSettings | null>(null);
  const [dataDir, setDataDir] = useState<DataDirectoryStatus | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusSnapshot | null>(
    null,
  );
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] =
    useState<RestorePreviewSummary | null>(null);
  const restorePreviewRef = useRef<RestorePreviewSummary | null>(null);
  restorePreviewRef.current = restorePreview;

  const handleEscape = useCallback(() => {
    if (restorePreviewRef.current) {
      setRestorePreview(null);
      return;
    }
    onClose();
  }, [onClose]);

  useFocusTrap(dialogRef, {
    active: true,
    onEscape: handleEscape,
  });

  const refresh = useCallback(async () => {
    const [nextSettings, nextData, nextUpdate] = await Promise.all([
      window.translunar.getShellSettings(),
      window.translunar.getDataDirectoryStatus(),
      window.translunar.getUpdateStatus(),
    ]);
    setSettings(nextSettings);
    setDataDir(nextData);
    setUpdateStatus(nextUpdate);
    if (project) {
      setAllowlist([...(project.configuration.engineAllowlist ?? [])]);
      try {
        const page = await window.translunar.invoke("ai.provider.list", {
          offset: 0,
          limit: 100,
        });
        setProfiles(page.items);
      } catch {
        setProfiles([]);
      }
    }
  }, [project]);

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t("error.generic"));
    });
  }, [refresh, t]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const saveAllowlist = async () => {
    if (!project) return;
    await run(async () => {
      await window.translunar.invoke("project.update", {
        projectId: project.id,
        name: project.name,
        sourceLocale: project.sourceLocale,
        targetLocale: project.targetLocale,
        domain: project.domain,
        configuration: {
          ...project.configuration,
          engineAllowlist: allowlist,
        },
        expectedRevision: project.revision,
        actor: "desktop-settings",
      });
      setNotice(t("status.ready"));
      onWorkspaceReloaded?.();
    });
  };

  const beginRestorePreview = async () => {
    await run(async () => {
      const source = await window.translunar.selectRestoreSource();
      if (!source) return;
      const preview = await window.translunar.previewRestore(source);
      if (!preview.ok) {
        throw new Error(localizeShellError(preview, t, "error.restoreFailed"));
      }
      const summary = toRestorePreviewSummary(
        preview.data,
        source,
        formatBytes,
      );
      if (!summary) {
        throw new Error(localizeShellError(preview, t, "error.restoreFailed"));
      }
      setRestorePreview(summary);
    });
  };

  const confirmRestore = async () => {
    if (!restorePreview) return;
    if (!restorePreview.confirmationToken) {
      setError(t("error.restoreFailed"));
      return;
    }
    const sourcePath = restorePreview.path;
    const confirmationToken = restorePreview.confirmationToken;
    await run(async () => {
      const restored = await window.translunar.restoreWorkspaceBackup({
        path: sourcePath,
        confirmationToken,
      });
      if (!restored.ok) {
        // Token is single-use / invalidated on failure; clear preview.
        setRestorePreview(null);
        throw new Error(localizeShellError(restored, t, "error.restoreFailed"));
      }
      setRestorePreview(null);
      setNotice(t("restore.success"));
      onWorkspaceReloaded?.();
    });
  };

  return (
    <div className="settings-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-settings-title"
      >
        <div className="settings-header">
          <div>
            <p className="surface-kicker">{t("app.name")}</p>
            <h1 id="product-settings-title">{t("settings.title")}</h1>
          </div>
          <button
            type="button"
            className="button ghost"
            aria-label={t("aria.closeDialog")}
            onClick={onClose}
          >
            {t("settings.close")}
          </button>
        </div>

        {error ? (
          <p className="surface-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="surface-success" role="status">
            {notice}
          </p>
        ) : null}

        {restorePreview ? (
          <section
            className="settings-card restore-preview-card"
            aria-labelledby="restore-preview-title"
          >
            <h2 id="restore-preview-title">{t("restore.previewTitle")}</h2>
            <p>{t("restore.preview")}</p>
            <dl className="settings-meta">
              <div>
                <dt>
                  {t("restore.sourcePath", { path: restorePreview.path })}
                </dt>
                <dd>{restorePreview.path}</dd>
              </div>
              <div>
                <dt>
                  {t("restore.schema", {
                    version: restorePreview.schemaVersion,
                  })}
                </dt>
                <dd>
                  {t("restore.files", { count: restorePreview.fileCount })}
                </dd>
              </div>
              <div>
                <dt>
                  {t("restore.size", {
                    size: formatBytes(restorePreview.totalBytes),
                  })}
                </dt>
                <dd>
                  {t("restore.hashStatus", {
                    status: restorePreview.hashesOk
                      ? t("status.healthy")
                      : t("status.unhealthy"),
                  })}
                </dd>
              </div>
              <div>
                <dt>
                  {t("restore.compatible", {
                    status: restorePreview.compatible
                      ? t("status.healthy")
                      : t("status.unhealthy"),
                  })}
                </dt>
                <dd>
                  {t("restore.freeSpace", {
                    size:
                      restorePreview.freeBytes == null
                        ? restorePreview.freeBytesLabel
                        : formatBytes(restorePreview.freeBytes),
                  })}
                </dd>
              </div>
              <div>
                <dt>
                  {t("format.checkedAt", {
                    value: restorePreview.createdAtMs
                      ? formatDate(restorePreview.createdAtMs)
                      : "—",
                  })}
                </dt>
                <dd>{restorePreview.engineVersion || "—"}</dd>
              </div>
            </dl>
            <p className="settings-hint">{t("restore.noClobber")}</p>
            <div className="settings-actions">
              <button
                type="button"
                className="button ghost"
                disabled={busy}
                onClick={() => setRestorePreview(null)}
              >
                {t("action.cancelRestore")}
              </button>
              <button
                type="button"
                className="button primary"
                disabled={
                  busy ||
                  !restorePreview.compatible ||
                  !restorePreview.hashesOk ||
                  !restorePreview.confirmationToken
                }
                onClick={() => void confirmRestore()}
              >
                {t("action.confirmRestore")}
              </button>
            </div>
          </section>
        ) : null}

        <div className="settings-grid">
          <section className="settings-card" aria-labelledby="locale-title">
            <h2 id="locale-title">{t("settings.locale")}</h2>
            <p>{t("settings.localeHelp")}</p>
            <label>
              <span className="sr-only">{t("aria.localeSelector")}</span>
              <select
                value={locale}
                aria-label={t("aria.localeSelector")}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value as "en-US" | "zh-CN";
                  void setLocale(next);
                }}
              >
                {locales.map((item) => (
                  <option key={item} value={item}>
                    {item === "zh-CN"
                      ? t("settings.localeName.zhCN")
                      : t("settings.localeName.enUS")}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="settings-card" aria-labelledby="data-dir-title">
            <h2 id="data-dir-title">{t("settings.dataDirectory")}</h2>
            <p>{t("settings.dataDirectoryHelp")}</p>
            <dl className="settings-meta">
              <div>
                <dt>{t("settings.currentPath")}</dt>
                <dd aria-label={t("aria.dataDirectoryPath")}>
                  {dataDir?.absolutePath ?? t("status.loading")}
                </dd>
              </div>
              <div>
                <dt>{t("settings.freeSpace")}</dt>
                <dd>
                  {dataDir?.freeBytes == null
                    ? "—"
                    : formatBytes(dataDir.freeBytes)}
                </dd>
              </div>
              <div>
                <dt>{t("status.healthy")}</dt>
                <dd>
                  {dataDir?.healthy == null
                    ? "—"
                    : dataDir.healthy
                      ? t("status.healthy")
                      : t("status.unhealthy")}
                </dd>
              </div>
            </dl>
            <div className="settings-actions">
              <button
                type="button"
                className="button"
                disabled={busy || dataDir?.isTestOverride}
                onClick={() =>
                  void run(async () => {
                    const path = await window.translunar.selectDataDirectory();
                    if (!path) return;
                    const validation =
                      await window.translunar.validateDataDirectory(path);
                    if (!validation.ok) {
                      throw new Error(
                        localizeShellError(
                          validation,
                          t,
                          "error.dataDirectoryInvalid",
                        ),
                      );
                    }
                    const migrated =
                      await window.translunar.migrateDataDirectory(path);
                    if (!migrated.ok) {
                      throw new Error(
                        localizeShellError(
                          migrated,
                          t,
                          "error.dataDirectoryMigrateFailed",
                        ),
                      );
                    }
                    setNotice(t("status.ready"));
                    onWorkspaceReloaded?.();
                  })
                }
              >
                {t("action.migrateDataDirectory")}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const destination =
                      await window.translunar.selectBackupDestination();
                    if (!destination) return;
                    const result =
                      await window.translunar.createWorkspaceBackup(
                        destination,
                      );
                    if (!result.ok) {
                      throw new Error(
                        localizeShellError(result, t, "error.backupFailed"),
                      );
                    }
                    setNotice(
                      t("backup.success", {
                        path: String(result.message ?? destination ?? ""),
                      }),
                    );
                  })
                }
              >
                {t("action.backup")}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void beginRestorePreview()}
              >
                {t("action.restore")}
              </button>
            </div>
            <div aria-label={t("aria.backupHistory")}>
              <h3>{t("settings.backupHistory")}</h3>
              {settings && settings.backupHistory.length > 0 ? (
                <ul className="settings-list">
                  {settings.backupHistory.map((item) => (
                    <li key={item.id}>
                      <strong>{formatDate(item.createdAtMs)}</strong>
                      <span>{item.destinationPath}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t("settings.noBackups")}</p>
              )}
            </div>
          </section>

          <section className="settings-card" aria-labelledby="updates-title">
            <h2 id="updates-title">{t("settings.updates")}</h2>
            <label>
              {t("settings.updateMode")}
              <select
                value={updateStatus?.mode ?? "manual"}
                disabled={busy}
                onChange={(event) => {
                  const mode = event.target.value as UpdateMode;
                  void run(async () => {
                    await window.translunar.setUpdateMode(mode);
                  });
                }}
              >
                <option value="automatic">
                  {t("settings.updateMode.automatic")}
                </option>
                <option value="manual">
                  {t("settings.updateMode.manual")}
                </option>
                <option value="disabled">
                  {t("settings.updateMode.disabled")}
                </option>
              </select>
            </label>
            <p role="status">
              {updateStatus
                ? updateStatusLabel(t, updateStatus)
                : t("status.loading")}
            </p>
            {updateStatus?.installLedger.lastRecoveryOutcome === "succeeded" &&
            updateStatus.installLedger.lastRecoveryAction === "rollback" ? (
              <p role="status">{t("update.rollbackSucceeded")}</p>
            ) : null}
            {updateStatus?.installLedger.lastRecoveryOutcome === "succeeded" &&
            updateStatus.installLedger.lastRecoveryAction ===
              "open_installer" ? (
              <p role="status">{t("update.manualInstallerOpened")}</p>
            ) : null}
            <div className="settings-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.translunar.checkForUpdates();
                  })
                }
              >
                {t("action.checkUpdates")}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy || updateStatus?.status !== "available"}
                onClick={() =>
                  void run(async () => {
                    await window.translunar.downloadUpdate();
                  })
                }
              >
                {t("update.downloading", { percent: 0 })}
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || updateStatus?.status !== "ready"}
                onClick={() =>
                  void run(async () => {
                    await window.translunar.installUpdate();
                  })
                }
              >
                {t("action.installUpdate")}
              </button>
              <button
                type="button"
                className="button ghost"
                disabled={busy || updateStatus?.status !== "available"}
                onClick={() =>
                  void run(async () => {
                    await window.translunar.deferUpdate(
                      Date.now() + 24 * 60 * 60 * 1000,
                    );
                  })
                }
              >
                {t("action.deferUpdate")}
              </button>
              <button
                type="button"
                className="button"
                disabled={
                  busy ||
                  !updateStatus?.canRollback ||
                  Boolean(updateStatus?.recoveryBusy)
                }
                aria-label={t("action.rollbackUpdate")}
                onClick={() =>
                  void run(async () => {
                    await window.translunar.rollbackUpdate();
                  })
                }
              >
                {t("action.rollbackUpdate")}
              </button>
              <button
                type="button"
                className="button"
                disabled={
                  busy ||
                  !updateStatus?.canOpenInstaller ||
                  Boolean(updateStatus?.recoveryBusy)
                }
                aria-label={t("action.openInstaller")}
                onClick={() =>
                  void run(async () => {
                    await window.translunar.openUpdateInstaller();
                  })
                }
              >
                {t("action.openInstaller")}
              </button>
            </div>
          </section>

          {project ? (
            <section
              className="settings-card"
              aria-labelledby="allowlist-title"
            >
              <h2 id="allowlist-title">{t("settings.allowlist")}</h2>
              <p>{t("settings.allowlistHelp")}</p>
              <p className="settings-hint">{t("settings.allowlistEmpty")}</p>
              <ul className="settings-checklist">
                {profiles.map((profile) => {
                  const checked = allowlist.includes(profile.id);
                  return (
                    <li key={profile.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy || !profile.enabled}
                          onChange={(event) => {
                            setAllowlist((current) =>
                              event.target.checked
                                ? [...new Set([...current, profile.id])]
                                : current.filter((id) => id !== profile.id),
                            );
                          }}
                        />
                        <span>
                          {profile.name}
                          {!profile.enabled
                            ? ` ${t("settings.profileDisabled")}`
                            : ""}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void saveAllowlist()}
              >
                {t("status.saving")}
              </button>
            </section>
          ) : null}

          <section className="settings-card" aria-labelledby="help-title">
            <h2 id="help-title">{t("tutorial.welcomeTitle")}</h2>
            <div className="settings-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={onRestartTutorial}
              >
                {t("action.restartTutorial")}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={onOpenExample}
              >
                {t("action.openExample")}
              </button>
            </div>
            <p>{t("backup.reminder")}</p>
          </section>
        </div>
      </section>
    </div>
  );
}

function toRestorePreviewSummary(
  data: unknown,
  fallbackPath: string,
  formatBytes: (bytes: number) => string,
): RestorePreviewSummary | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  // Main-process RestorePreviewSummary only — never invent tokens or flags.
  if (
    typeof record.path === "string" &&
    typeof record.schemaVersion === "number" &&
    typeof record.fileCount === "number" &&
    typeof record.totalBytes === "number" &&
    typeof record.confirmationToken === "string" &&
    record.confirmationToken.length > 0 &&
    typeof record.hashesOk === "boolean" &&
    typeof record.compatible === "boolean"
  ) {
    return {
      path: record.path || fallbackPath,
      formatVersion: Number(record.formatVersion ?? 1),
      schemaVersion: record.schemaVersion,
      engineVersion:
        typeof record.engineVersion === "string" ? record.engineVersion : "",
      createdAtMs: Number(record.createdAtMs ?? 0),
      fileCount: record.fileCount,
      totalBytes: record.totalBytes,
      hashesOk: record.hashesOk,
      compatible: record.compatible,
      freeBytes: typeof record.freeBytes === "number" ? record.freeBytes : null,
      freeBytesLabel:
        typeof record.freeBytesLabel === "string"
          ? record.freeBytesLabel
          : typeof record.freeBytes === "number"
            ? formatBytes(record.freeBytes)
            : "—",
      confirmationToken: record.confirmationToken,
    };
  }

  return null;
}

function updateStatusLabel(
  t: (
    key: Parameters<ReturnType<typeof useLocale>["t"]>[0],
    vars?: Record<string, string | number>,
  ) => string,
  status: UpdateStatusSnapshot,
): string {
  switch (status.status) {
    case "checking":
      return t("update.checking");
    case "idle":
      if (status.feedKind === "none") {
        return t("update.notConfigured");
      }
      return t("update.upToDate", { version: status.currentVersion });
    case "available":
      return t("update.available", {
        version: status.availableVersion ?? "",
      });
    case "downloading":
      return t("update.downloading", {
        percent: status.downloadPercent ?? 0,
      });
    case "ready":
      return t("update.ready");
    case "installing":
      return t("update.preBackup");
    case "pending-restart":
      return t("update.pendingRestart", {
        version:
          status.installLedger.targetVersion ?? status.availableVersion ?? "",
      });
    case "deferred":
      return t("update.deferred", {
        when: status.deferredUntilMs
          ? new Date(status.deferredUntilMs).toLocaleString()
          : "",
      });
    case "disabled":
      return t("update.disabled");
    case "failed":
      return t("update.failed", {
        detail: status.lastError ?? "",
      });
    case "rollback-required":
      return t("update.recoveryRequired", {
        detail: status.lastError ?? "",
      });
    default:
      return t("update.upToDate", { version: status.currentVersion });
  }
}
