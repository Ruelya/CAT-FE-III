import { formatUiError } from "../lib/errors";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { SectionNav } from "../shell/SectionNav";
import type { SettingsSection } from "../state/app-state";
import { canRunUpdateCommand } from "../state/product-settings-view";
import type { ProductSettingsApi } from "../state/use-product-settings";

export interface ProductSettingsProps {
  settings: ProductSettingsApi;
  section: SettingsSection;
  disabled?: boolean;
  onBack: () => void;
  onSectionChange: (section: SettingsSection) => void;
}

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "locale", label: "Locale" },
  { id: "appearance", label: "Appearance" },
  { id: "data", label: "Data" },
  { id: "updates", label: "Updates" },
  { id: "ocr", label: "OCR" },
  { id: "tutorial", label: "Tutorial" },
];

export function ProductSettings({
  settings,
  section,
  disabled,
  onBack,
  onSectionChange,
}: ProductSettingsProps) {
  const { state } = settings;
  const busy = disabled === true || state.mutationPending;

  return (
    <section className="surface p4-surface" data-testid="product-settings">
      <div className="surface__masthead">
        <h1 className="surface__title">Settings</h1>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={onBack}
          data-testid="settings-back"
        >
          Back
        </button>
      </div>

      <SectionNav
        label="Settings sections"
        items={SECTIONS.map((s) => ({
          id: s.id,
          label: s.label,
          testId: `settings-tab-${s.id}`,
        }))}
        current={section}
        disabled={busy}
        onSelect={onSectionChange}
      />

      {state.error ? (
        <p className="status status--error" role="alert">
          {formatUiError(state.error)}
        </p>
      ) : null}

      {section === "locale" ? (
        <div className="p4-panel" data-testid="settings-locale">
          <label className="field">
            <span>Locale</span>
            <select
              value={state.localeDraft}
              disabled={busy}
              onChange={(e) =>
                settings.setLocaleDraft(
                  e.target.value as typeof state.localeDraft,
                )
              }
              data-testid="settings-locale-select"
            >
              <option value="system">System ({state.systemLocale})</option>
              <option value="en-US">English</option>
              <option value="zh-CN">Chinese</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void settings.commitLocale()}
            data-testid="settings-locale-save"
          >
            Save locale
          </button>
        </div>
      ) : null}

      {section === "appearance" ? (
        <div className="p4-panel" data-testid="settings-appearance">
          <label className="field">
            <span>Theme</span>
            <select
              value={state.appearanceDraft.theme}
              disabled={busy}
              onChange={(e) =>
                settings.setThemeDraft(
                  e.target.value === "dark" ? "dark" : "light",
                )
              }
              data-testid="settings-theme"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="field">
            <span>Accent</span>
            <div className="p4-toolbar">
              <input
                type="color"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(state.appearanceDraft.accentSeed)
                    ? state.appearanceDraft.accentSeed
                    : "#765847"
                }
                disabled={busy}
                onChange={(e) => settings.setAccentDraft(e.target.value)}
                data-testid="settings-accent-color"
              />
              <input
                value={state.appearanceDraft.accentSeed}
                disabled={busy}
                onChange={(e) => settings.setAccentDraft(e.target.value)}
                data-testid="settings-accent-hex"
              />
            </div>
          </label>
          {state.appearanceError ? (
            <p className="status status--error">{state.appearanceError}</p>
          ) : null}
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => settings.applyAppearanceDraft()}
              data-testid="settings-appearance-apply"
            >
              Apply
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => settings.resetAppearanceDefaults()}
              data-testid="settings-appearance-reset"
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}

      {section === "data" ? (
        <div className="p4-panel" data-testid="settings-data">
          {state.dataStatus ? (
            <div className="p4-form">
              <p className="status p4-wrap" data-testid="settings-data-path">
                {state.dataStatus.absolutePath || state.dataStatus.path}
              </p>
              <p className="status">
                free={state.dataStatus.freeBytesLabel} writable=
                {String(state.dataStatus.writable)} healthy=
                {String(state.dataStatus.healthy)}
              </p>
            </div>
          ) : (
            <p className="status">Loading data status</p>
          )}
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void settings.selectDataDirectory()}
              data-testid="settings-data-select"
            >
              Change directory
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void settings.createBackup()}
              data-testid="settings-backup"
            >
              Backup
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void settings.selectAndPreviewRestore()}
              data-testid="settings-restore-preview"
            >
              Restore
            </button>
          </div>
          {state.dataValidationMessage ? (
            <p className="status status--error">
              {state.dataValidationMessage}
            </p>
          ) : null}
          {state.backupResult ? (
            <p className="status">
              Backup {state.backupResult.ok ? "ok" : "failed"}
              {state.backupResult.message
                ? `: ${state.backupResult.message}`
                : ""}
            </p>
          ) : null}
          {state.dataPhase === "readyToConfirm" && state.selectedDataPath ? (
            <ConfirmDialog
              title="Migrate data directory"
              body={`Migrate workspace to ${state.selectedDataPath}`}
              confirmLabel="Migrate"
              pending={busy}
              onCancel={() => settings.cancelDataFlow()}
              onConfirm={() => void settings.confirmMigrate()}
              testId="settings-data-migrate-confirm"
            />
          ) : null}
          {state.restorePreview ? (
            <ConfirmDialog
              title="Restore workspace"
              body={`Restore ${state.restorePreview.fileCount} files (${state.restorePreview.totalBytes} bytes) from backup.`}
              confirmLabel="Restore"
              pending={busy}
              error={state.restoreError}
              onCancel={() => settings.cancelRestore()}
              onConfirm={() => void settings.confirmRestore()}
              testId="settings-restore-confirm"
            />
          ) : null}
          {state.restoreError && !state.restorePreview ? (
            <p className="status status--error">{state.restoreError}</p>
          ) : null}
        </div>
      ) : null}

      {section === "updates" ? (
        <div className="p4-panel" data-testid="settings-updates">
          {state.updateStatus ? (
            <>
              <p className="status" data-testid="settings-update-status">
                {state.updateStatus.status} · v
                {state.updateStatus.currentVersion}
                {state.updateStatus.availableVersion
                  ? ` → ${state.updateStatus.availableVersion}`
                  : ""}
              </p>
              <label className="field">
                <span>Mode</span>
                <select
                  value={state.updateStatus.mode}
                  disabled={
                    busy || !canRunUpdateCommand(state.updateStatus, "setMode")
                  }
                  onChange={(e) =>
                    void settings.runUpdateCommand("setMode", {
                      mode: e.target.value as
                        "automatic" | "manual" | "disabled",
                    })
                  }
                  data-testid="settings-update-mode"
                >
                  <option value="manual">Manual</option>
                  <option value="automatic">Automatic</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={
                    busy || !canRunUpdateCommand(state.updateStatus, "check")
                  }
                  onClick={() => void settings.runUpdateCommand("check")}
                  data-testid="settings-update-check"
                >
                  Check
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={
                    busy || !canRunUpdateCommand(state.updateStatus, "download")
                  }
                  onClick={() => void settings.runUpdateCommand("download")}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={
                    busy || !canRunUpdateCommand(state.updateStatus, "install")
                  }
                  onClick={() => void settings.runUpdateCommand("install")}
                >
                  Install
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={
                    busy || !canRunUpdateCommand(state.updateStatus, "defer")
                  }
                  onClick={() => void settings.runUpdateCommand("defer")}
                >
                  Defer
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={
                    busy || !canRunUpdateCommand(state.updateStatus, "rollback")
                  }
                  onClick={() => void settings.runUpdateCommand("rollback")}
                >
                  Rollback
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={
                    busy ||
                    !canRunUpdateCommand(state.updateStatus, "openInstaller")
                  }
                  onClick={() =>
                    void settings.runUpdateCommand("openInstaller")
                  }
                >
                  Open installer
                </button>
              </div>
            </>
          ) : (
            <p className="status">Loading update status</p>
          )}
        </div>
      ) : null}

      {section === "ocr" ? (
        <div className="p4-panel" data-testid="settings-ocr">
          {state.mineruStatus ? (
            <p className="status" data-testid="settings-ocr-status">
              {state.mineruStatus.available
                ? state.mineruStatus.present
                  ? `MinerU key stored (${state.mineruStatus.backend}). The secret is never shown here.`
                  : "No MinerU API key is stored. The engine keeps the key in the OS keyring, not in the project."
                : "MinerU credential storage is not available on this machine."}
            </p>
          ) : (
            <p className="status">Loading OCR settings</p>
          )}
          <label className="field">
            <span>MinerU API key</span>
            <input
              type="password"
              value={state.mineruSecretDraft}
              disabled={busy || state.mineruStatus?.available === false}
              onChange={(e) => settings.setMineruSecretDraft(e.target.value)}
              autoComplete="off"
              data-testid="settings-ocr-secret"
            />
          </label>
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || state.mineruStatus?.available === false}
              onClick={() => void settings.saveMineruCredential()}
              data-testid="settings-ocr-save"
            >
              Save key
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={
                busy ||
                state.mineruStatus?.available === false ||
                state.mineruStatus?.present !== true
              }
              onClick={() => void settings.deleteMineruCredential()}
              data-testid="settings-ocr-delete"
            >
              Delete key
            </button>
          </div>
        </div>
      ) : null}

      {section === "tutorial" ? (
        <div className="p4-panel" data-testid="settings-tutorial">
          {state.tutorial ? (
            <>
              <p className="status" data-testid="settings-tutorial-state">
                step={state.tutorial.step} skipped=
                {String(state.tutorial.skipped)} completed=
                {String(state.tutorial.completed)}
              </p>
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => void settings.resetTutorial()}
                  data-testid="settings-tutorial-reset"
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => void settings.skipTutorial()}
                  data-testid="settings-tutorial-skip"
                >
                  Skip
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => void settings.completeTutorial()}
                  data-testid="settings-tutorial-complete"
                >
                  Complete
                </button>
              </div>
            </>
          ) : (
            <p className="status">Loading tutorial</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
