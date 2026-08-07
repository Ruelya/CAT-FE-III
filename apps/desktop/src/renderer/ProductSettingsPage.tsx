import { useCallback, useEffect, useState } from "react";
import type { AiProviderProfile, Project } from "@translunar/contracts";

import {
  percentToUiScale,
  setDensityPreference,
  setUiScale,
  uiScaleToPercent,
  type DensityPreference,
} from "./components/system/appearance-controller";
import {
  SETTINGS_NAV,
  normalizeSettingsSection,
  type SettingsSectionId,
} from "./components/system/settings-presenters";
import {
  setThemePreference,
  type ThemePreference,
} from "./components/system/theme-controller";
import { useLocale } from "./i18n/LocaleProvider";
import { localizeShellError } from "./shell-error";
import type {
  DataDirectoryStatus,
  ProductShellSettings,
  RestorePreviewSummary,
  UpdateMode,
  UpdateStatusSnapshot,
} from "../shared/product-shell";
import type { MessageKey } from "./i18n/messages";

interface ProductSettingsPageProps {
  project?: Project | null;
  section?: SettingsSectionId | string | null;
  onSectionChange?: (section: SettingsSectionId) => void;
  onClose: () => void;
  onOpenExample: () => void;
  onRestartTutorial: () => void;
  onWorkspaceReloaded?: () => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  density: DensityPreference;
  onDensityChange: (density: DensityPreference) => void;
  uiScale: number;
  onUiScaleChange: (scale: number) => void;
}

export function ProductSettingsPage({
  project,
  section: sectionProp,
  onSectionChange,
  onClose,
  onOpenExample,
  onRestartTutorial,
  onWorkspaceReloaded,
  themePreference,
  onThemePreferenceChange,
  density,
  onDensityChange,
  uiScale,
  onUiScaleChange,
}: ProductSettingsPageProps) {
  const { t, locale, setLocale, locales, formatBytes, formatDate } =
    useLocale();
  const [section, setSection] = useState<SettingsSectionId>(() =>
    normalizeSettingsSection(sectionProp),
  );
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

  useEffect(() => {
    if (sectionProp != null) {
      setSection(normalizeSettingsSection(sectionProp));
    }
  }, [sectionProp]);

  const selectSection = (id: SettingsSectionId) => {
    setSection(id);
    onSectionChange?.(id);
  };

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (restorePreview) {
          setRestorePreview(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, restorePreview]);

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
        setRestorePreview(null);
        throw new Error(localizeShellError(restored, t, "error.restoreFailed"));
      }
      setRestorePreview(null);
      setNotice(t("restore.success"));
      onWorkspaceReloaded?.();
    });
  };

  const scalePercent = uiScaleToPercent(uiScale);

  return (
    <div
      className="settings-surface"
      role="region"
      aria-labelledby="product-settings-title"
    >
      <nav className="settings-surface__nav" aria-label={t("settings.navAria")}>
        {SETTINGS_NAV.map((group) => (
          <div key={group.id} className="settings-surface__nav-group">
            <div className="settings-surface__nav-label">
              {t(group.labelKey as MessageKey)}
            </div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="settings-surface__nav-item"
                data-current={section === item.id ? "" : undefined}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => selectSection(item.id)}
              >
                {t(item.labelKey as MessageKey)}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="settings-surface__main">
        <header className="settings-surface__header">
          <div>
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
        </header>

        {error ? (
          <p className="settings-surface__error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="settings-surface__success" role="status">
            {notice}
          </p>
        ) : null}

        {restorePreview ? (
          <section
            className="settings-surface__card restore-preview-card"
            aria-labelledby="restore-preview-title"
          >
            <h2 id="restore-preview-title">{t("restore.previewTitle")}</h2>
            <p>{t("restore.preview")}</p>
            <dl className="settings-surface__meta">
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
            <p className="settings-surface__hint">{t("restore.noClobber")}</p>
            <div className="settings-surface__actions">
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

        <div className="settings-surface__panel">
          {section === "appearance" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="appearance-title"
            >
              <h2 id="appearance-title">{t("settings.section.appearance")}</h2>

              <div className="settings-surface__field">
                <span className="settings-surface__field-label">
                  {t("settings.appearance.theme")}
                </span>
                <p className="settings-surface__help">
                  {t("settings.appearance.themeHelp")}
                </p>
                <div
                  className="settings-surface__segmented"
                  role="radiogroup"
                  aria-label={t("settings.appearance.theme")}
                >
                  {(
                    [
                      ["light", "settings.appearance.themeLight"],
                      ["dark", "settings.appearance.themeDark"],
                      ["system", "settings.appearance.themeSystem"],
                    ] as const
                  ).map(([value, key]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={themePreference === value}
                      data-current={themePreference === value ? "" : undefined}
                      onClick={() => {
                        onThemePreferenceChange(value);
                        setThemePreference(value);
                      }}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-surface__field">
                <span className="settings-surface__field-label">
                  {t("settings.appearance.density")}
                </span>
                <p className="settings-surface__help">
                  {t("settings.appearance.densityHelp")}
                </p>
                <div
                  className="settings-surface__segmented"
                  role="radiogroup"
                  aria-label={t("settings.appearance.density")}
                >
                  {(
                    [
                      ["compact", "settings.appearance.densityCompact"],
                      ["standard", "settings.appearance.densityStandard"],
                      ["comfortable", "settings.appearance.densityComfortable"],
                    ] as const
                  ).map(([value, key]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={density === value}
                      data-current={density === value ? "" : undefined}
                      onClick={() => {
                        onDensityChange(value);
                        setDensityPreference(value);
                      }}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-surface__field">
                <span className="settings-surface__field-label">
                  {t("settings.appearance.uiScale")}
                </span>
                <p className="settings-surface__help">
                  {t("settings.appearance.uiScaleHelp")}
                </p>
                <div className="settings-surface__scale">
                  <input
                    type="range"
                    min={80}
                    max={160}
                    step={5}
                    value={scalePercent}
                    aria-valuemin={80}
                    aria-valuemax={160}
                    aria-valuenow={scalePercent}
                    aria-label={t("settings.appearance.uiScale")}
                    onChange={(event) => {
                      const next = percentToUiScale(
                        Number(event.currentTarget.value),
                      );
                      onUiScaleChange(next);
                      setUiScale(next);
                    }}
                  />
                  <output htmlFor="">{scalePercent}%</output>
                </div>
              </div>

              <div className="settings-surface__field">
                <span className="settings-surface__field-label">
                  {t("settings.appearance.preview")}
                </span>
                <p className="settings-surface__help">
                  {t("settings.appearance.previewHelp")}
                </p>
                <div className="settings-preview-row" aria-hidden="true">
                  <div className="settings-preview-row__cell">
                    {t("settings.appearance.previewSource")}
                  </div>
                  <div className="settings-preview-row__cell">
                    {t("settings.appearance.previewTarget")}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {section === "locale" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="locale-title"
            >
              <h2 id="locale-title">{t("settings.locale")}</h2>
              <p className="settings-surface__help">{t("settings.localeHelp")}</p>
              <label className="settings-surface__field">
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
          ) : null}

          {section === "shortcuts" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="shortcuts-title"
            >
              <h2 id="shortcuts-title">{t("settings.section.shortcuts")}</h2>
              <p className="settings-surface__help">
                {t("settings.shortcuts.residual")}
              </p>
              <ul className="settings-surface__list">
                <li>
                  <strong>Ctrl+K</strong> — {t("settings.shortcuts.cmdk")}
                </li>
                <li>
                  <strong>Ctrl+Alt+,</strong> — {t("settings.shortcuts.settings")}
                </li>
                <li>
                  <strong>Ctrl+\</strong> — {t("settings.shortcuts.spine")}
                </li>
                <li>
                  <strong>Ctrl+1…6</strong> — {t("settings.shortcuts.surfaces")}
                </li>
              </ul>
            </section>
          ) : null}

          {section === "data" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="data-dir-title"
            >
              <h2 id="data-dir-title">{t("settings.dataDirectory")}</h2>
              <p className="settings-surface__help">
                {t("settings.dataDirectoryHelp")}
              </p>
              <dl className="settings-surface__meta">
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
              <div className="settings-surface__actions">
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
              </div>
            </section>
          ) : null}

          {section === "backup" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="backup-title"
            >
              <h2 id="backup-title">{t("settings.section.backup")}</h2>
              <div className="settings-surface__actions">
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
                  <ul className="settings-surface__list">
                    {settings.backupHistory.map((item) => (
                      <li key={item.id}>
                        <strong>{formatDate(item.createdAtMs)}</strong>
                        <span>{item.destinationPath}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="settings-surface__hint">
                    {t("settings.noBackups")}
                  </p>
                )}
              </div>
              <p className="settings-surface__hint">{t("backup.reminder")}</p>
            </section>
          ) : null}

          {section === "updates" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="updates-title"
            >
              <h2 id="updates-title">{t("settings.updates")}</h2>
              <label className="settings-surface__field">
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
              {updateStatus?.installLedger.lastRecoveryOutcome ===
                "succeeded" &&
              updateStatus.installLedger.lastRecoveryAction === "rollback" ? (
                <p role="status">{t("update.rollbackSucceeded")}</p>
              ) : null}
              {updateStatus?.installLedger.lastRecoveryOutcome ===
                "succeeded" &&
              updateStatus.installLedger.lastRecoveryAction ===
                "open_installer" ? (
                <p role="status">{t("update.manualInstallerOpened")}</p>
              ) : null}
              <div className="settings-surface__actions">
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
          ) : null}

          {section === "engines" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="allowlist-title"
            >
              <h2 id="allowlist-title">{t("settings.allowlist")}</h2>
              {project ? (
                <>
                  <p className="settings-surface__help">
                    {t("settings.allowlistHelp")}
                  </p>
                  <p className="settings-surface__hint">
                    {t("settings.allowlistEmpty")}
                  </p>
                  <ul className="settings-surface__checklist">
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
                </>
              ) : (
                <p className="settings-surface__hint">
                  {t("settings.engines.noProject")}
                </p>
              )}
            </section>
          ) : null}

          {section === "tutorial" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="help-title"
            >
              <h2 id="help-title">{t("settings.section.tutorial")}</h2>
              <div className="settings-surface__actions">
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
            </section>
          ) : null}

          {section === "about" ? (
            <section
              className="settings-surface__card"
              aria-labelledby="about-title"
            >
              <h2 id="about-title">{t("settings.section.about")}</h2>
              <p className="settings-surface__help">{t("settings.about.body")}</p>
              <p>
                <strong>{t("app.name")}</strong>
              </p>
            </section>
          ) : null}
        </div>
      </div>
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
