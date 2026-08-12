import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AppLocale,
  DataDirectoryMigrationResult,
  DataDirectoryStatus,
  RestorePreviewSummary,
  ShellActionResult,
  TutorialState,
  UpdateMode,
  UpdateStatusSnapshot,
} from "../../shared/product-shell";
import { toUiError, type UiError } from "../lib/errors";
import { desktopApi } from "../lib/rpc";
import {
  applyAppearance,
  normalizeAccentSeed,
  readAppearancePreference,
  resetAppearance,
  writeAppearancePreference,
  type AppearanceTheme,
  type RendererAppearancePreferenceV1,
} from "./appearance";
import {
  canRunUpdateCommand,
  decodeRestorePreviewSummary,
  type DataMigrationPhase,
  type UpdateCommand,
} from "./product-settings-view";

export interface ProductSettingsGateway {
  generation: number;
  mutationsEnabled: boolean;
  active: boolean;
  section: string;
  /** Successful migration: rehydrate retained P4 return identity. */
  onMigrationCommitted?: () => void;
  /** Successful restore: cold-route from authoritative shell/Engine state. */
  onRestoreCommitted?: () => void;
}

export interface ProductSettingsState {
  loading: boolean;
  error: UiError | null;
  systemLocale: string;
  locale: AppLocale | null;
  localeDraft: AppLocale | "system";
  appearance: RendererAppearancePreferenceV1;
  appearanceDraft: RendererAppearancePreferenceV1;
  appearanceError: string | null;
  dataStatus: DataDirectoryStatus | null;
  dataPhase: DataMigrationPhase;
  selectedDataPath: string | null;
  dataValidationMessage: string | null;
  migrationResult: DataDirectoryMigrationResult | null;
  backupResult: ShellActionResult | null;
  restorePreview: RestorePreviewSummary | null;
  restoreError: string | null;
  updateStatus: UpdateStatusSnapshot | null;
  tutorial: TutorialState | null;
  mutationPending: boolean;
}

function initialState(): ProductSettingsState {
  const appearance = readAppearancePreference();
  return {
    loading: false,
    error: null,
    systemLocale: "en-US",
    locale: null,
    localeDraft: "system",
    appearance,
    appearanceDraft: { ...appearance },
    appearanceError: null,
    dataStatus: null,
    dataPhase: "idle",
    selectedDataPath: null,
    dataValidationMessage: null,
    migrationResult: null,
    backupResult: null,
    restorePreview: null,
    restoreError: null,
    updateStatus: null,
    tutorial: null,
    mutationPending: false,
  };
}

export interface ProductSettingsApi {
  state: ProductSettingsState;
  invalidate: () => void;
  reload: () => Promise<void>;
  setLocaleDraft: (v: AppLocale | "system") => void;
  commitLocale: () => Promise<void>;
  setThemeDraft: (theme: AppearanceTheme) => void;
  setAccentDraft: (seed: string) => void;
  applyAppearanceDraft: () => void;
  resetAppearanceDefaults: () => void;
  loadDataStatus: () => Promise<void>;
  selectDataDirectory: () => Promise<void>;
  confirmMigrate: () => Promise<void>;
  cancelDataFlow: () => void;
  createBackup: () => Promise<void>;
  selectAndPreviewRestore: () => Promise<void>;
  confirmRestore: () => Promise<void>;
  cancelRestore: () => void;
  loadUpdates: () => Promise<void>;
  runUpdateCommand: (
    command: UpdateCommand,
    opts?: { mode?: UpdateMode; deferUntilMs?: number },
  ) => Promise<void>;
  loadTutorial: () => Promise<void>;
  resetTutorial: () => Promise<void>;
  skipTutorial: () => Promise<void>;
  completeTutorial: () => Promise<void>;
}

export function useProductSettings(
  gateway: ProductSettingsGateway,
): ProductSettingsApi {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const genRef = useRef(gateway.generation);
  const opRef = useRef(0);
  const mutRef = useRef(0);
  const mutPendingRef = useRef(0);

  const invalidate = useCallback(() => {
    genRef.current = gatewayRef.current.generation;
    opRef.current += 1;
    mutRef.current += 1;
    mutPendingRef.current = 0;
    setState((s) => (s.mutationPending ? { ...s, mutationPending: false } : s));
  }, []);

  useEffect(() => {
    if (gateway.generation !== genRef.current) invalidate();
  }, [gateway.generation, invalidate]);

  const isCurrent = useCallback((op: number) => {
    return (
      gatewayRef.current.active &&
      gatewayRef.current.generation === genRef.current &&
      opRef.current === op
    );
  }, []);

  const isMutCurrent = useCallback((mut: number) => {
    return (
      gatewayRef.current.active &&
      gatewayRef.current.generation === genRef.current &&
      mutRef.current === mut
    );
  }, []);

  const beginMut = useCallback((): number | null => {
    if (!gatewayRef.current.mutationsEnabled) return null;
    if (mutPendingRef.current > 0) return null;
    const mut = ++mutRef.current;
    mutPendingRef.current = mut;
    return mut;
  }, []);

  const endMut = useCallback((mut: number) => {
    if (mutPendingRef.current === mut) mutPendingRef.current = 0;
  }, []);

  const reload = useCallback(async () => {
    const op = ++opRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [systemLocale, settings] = await Promise.all([
        desktopApi().getSystemLocale(),
        desktopApi().getShellSettings(),
      ]);
      if (!isCurrent(op)) return;
      setState((s) => ({
        ...s,
        loading: false,
        systemLocale,
        locale: settings.locale,
        localeDraft: settings.locale ?? "system",
        tutorial: settings.tutorial,
      }));
      document.documentElement.lang =
        settings.locale ?? systemLocale.split("-")[0] ?? "en";
    } catch (error) {
      if (!isCurrent(op)) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: toUiError(error),
      }));
    }
  }, [isCurrent]);

  const commitLocale = useCallback(async () => {
    const mut = beginMut();
    if (mut === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      const locale =
        stateRef.current.localeDraft === "system"
          ? null
          : stateRef.current.localeDraft;
      const settings = await desktopApi().updateShellSettings({ locale });
      endMut(mut);
      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        locale: settings.locale,
        localeDraft: settings.locale ?? "system",
        tutorial: settings.tutorial,
      }));
      document.documentElement.lang =
        settings.locale ?? stateRef.current.systemLocale.split("-")[0] ?? "en";
    } catch (error) {
      endMut(mut);
      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, isMutCurrent]);

  const setThemeDraft = useCallback((theme: AppearanceTheme) => {
    setState((s) => ({
      ...s,
      appearanceDraft: { ...s.appearanceDraft, theme },
    }));
  }, []);

  const setAccentDraft = useCallback((seed: string) => {
    setState((s) => ({
      ...s,
      appearanceDraft: { ...s.appearanceDraft, accentSeed: seed },
    }));
  }, []);

  const applyAppearanceDraft = useCallback(() => {
    const draft = stateRef.current.appearanceDraft;
    const seed = normalizeAccentSeed(draft.accentSeed);
    if (!seed) {
      setState((s) => ({
        ...s,
        appearanceError: "Accent must be #RRGGBB",
      }));
      return;
    }
    const preference: RendererAppearancePreferenceV1 = {
      version: 1,
      theme: draft.theme === "dark" ? "dark" : "light",
      accentSeed: seed,
    };
    applyAppearance(preference);
    const written = writeAppearancePreference(preference);
    setState((s) => ({
      ...s,
      appearance: preference,
      appearanceDraft: preference,
      appearanceError: written.ok ? null : written.error,
    }));
  }, []);

  const resetAppearanceDefaults = useCallback(() => {
    const preference = resetAppearance();
    applyAppearance(preference);
    setState((s) => ({
      ...s,
      appearance: preference,
      appearanceDraft: { ...preference },
      appearanceError: null,
    }));
  }, []);

  const loadDataStatus = useCallback(async () => {
    const op = ++opRef.current;
    try {
      const status = await desktopApi().getDataDirectoryStatus();
      if (!isCurrent(op)) return;
      setState((s) => ({ ...s, dataStatus: status }));
    } catch (error) {
      if (!isCurrent(op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [isCurrent]);

  const selectDataDirectory = useCallback(async () => {
    const op = ++opRef.current;
    setState((s) => ({ ...s, dataPhase: "selecting", error: null }));
    const path = await desktopApi().selectDataDirectory();
    if (!isCurrent(op)) return;
    if (!path) {
      setState((s) => ({ ...s, dataPhase: "idle" }));
      return;
    }
    setState((s) => ({
      ...s,
      dataPhase: "validating",
      selectedDataPath: path,
    }));
    try {
      const validation = await desktopApi().validateDataDirectory(path);
      if (!isCurrent(op)) return;
      if (!validation.ok) {
        setState((s) => ({
          ...s,
          dataPhase: "error",
          dataValidationMessage:
            validation.message ?? validation.code ?? "Invalid",
        }));
        return;
      }
      setState((s) => ({
        ...s,
        dataPhase: "readyToConfirm",
        dataValidationMessage: null,
      }));
    } catch (error) {
      if (!isCurrent(op)) return;
      setState((s) => ({
        ...s,
        dataPhase: "error",
        error: toUiError(error),
      }));
    }
  }, [isCurrent]);

  const confirmMigrate = useCallback(async () => {
    const path = stateRef.current.selectedDataPath;
    if (!path || stateRef.current.dataPhase !== "readyToConfirm") return;
    const mut = beginMut();
    if (mut === null) return;
    setState((s) => ({
      ...s,
      dataPhase: "migrating",
      mutationPending: true,
      error: null,
    }));
    try {
      const result = await desktopApi().migrateDataDirectory(path);
      endMut(mut);

      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        migrationResult: result,
        dataPhase: result.ok ? "committed" : "error",
        dataStatus: s.dataStatus
          ? {
              ...s.dataStatus,
              path: result.activePath,
              absolutePath: result.activePath,
            }
          : s.dataStatus,
      }));
      if (result.ok) {
        gatewayRef.current.onMigrationCommitted?.();
      }
    } catch (error) {
      endMut(mut);

      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        dataPhase: "error",
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, isMutCurrent]);

  const cancelDataFlow = useCallback(() => {
    setState((s) => ({
      ...s,
      dataPhase: "idle",
      selectedDataPath: null,
      dataValidationMessage: null,
    }));
  }, []);

  const createBackup = useCallback(async () => {
    const mut = beginMut();
    if (mut === null) return;
    try {
      const dest =
        await desktopApi().selectBackupDestination("workspace-backup");
      if (!isMutCurrent(mut)) {
        endMut(mut);
        return;
      }
      if (!dest) {
        endMut(mut);
        return;
      }
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      const result = await desktopApi().createWorkspaceBackup(dest);
      endMut(mut);
      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        backupResult: result,
      }));
    } catch (error) {
      endMut(mut);
      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, isMutCurrent]);

  const selectAndPreviewRestore = useCallback(async () => {
    const mut = beginMut();
    if (mut === null) return;
    try {
      const path = await desktopApi().selectRestoreSource();
      if (!isMutCurrent(mut)) {
        endMut(mut);
        return;
      }
      if (!path) {
        endMut(mut);
        return;
      }
      setState((s) => ({
        ...s,
        mutationPending: true,
        restoreError: null,
        restorePreview: null,
      }));
      const result = await desktopApi().previewRestore(path);
      if (!isMutCurrent(mut)) {
        endMut(mut);
        return;
      }
      if (!result.ok) {
        endMut(mut);
        setState((s) => ({
          ...s,
          mutationPending: false,
          restoreError: result.message ?? result.code ?? "Preview failed",
        }));
        return;
      }
      const decoded = decodeRestorePreviewSummary(result.data);
      endMut(mut);
      if (!isMutCurrent(mut)) return;
      if (!decoded.ok) {
        setState((s) => ({
          ...s,
          mutationPending: false,
          restoreError: decoded.error,
        }));
        return;
      }
      setState((s) => ({
        ...s,
        mutationPending: false,
        restorePreview: decoded.preview,
      }));
    } catch (error) {
      endMut(mut);
      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, isMutCurrent]);

  const confirmRestore = useCallback(async () => {
    const preview = stateRef.current.restorePreview;
    if (!preview) return;
    const mut = beginMut();
    if (mut === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      const result = await desktopApi().restoreWorkspaceBackup({
        path: preview.path,
        confirmationToken: preview.confirmationToken,
      });
      endMut(mut);

      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        migrationResult: result,
        restorePreview: result.ok ? null : s.restorePreview,
        restoreError: result.ok
          ? null
          : (result.message ?? result.code ?? "Restore failed"),
      }));
      if (result.ok) {
        gatewayRef.current.onRestoreCommitted?.();
      }
    } catch (error) {
      endMut(mut);

      if (!isMutCurrent(mut)) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, isMutCurrent]);

  const cancelRestore = useCallback(() => {
    setState((s) => ({
      ...s,
      restorePreview: null,
      restoreError: null,
    }));
  }, []);

  const loadUpdates = useCallback(async () => {
    const op = ++opRef.current;
    try {
      const status = await desktopApi().getUpdateStatus();
      if (!isCurrent(op)) return;
      setState((s) => ({ ...s, updateStatus: status }));
    } catch (error) {
      if (!isCurrent(op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [isCurrent]);

  const runUpdateCommand = useCallback(
    async (
      command: UpdateCommand,
      opts?: { mode?: UpdateMode; deferUntilMs?: number },
    ) => {
      const snapshot = stateRef.current.updateStatus;
      if (!snapshot) return;
      if (!canRunUpdateCommand(snapshot, command)) return;
      const mut = beginMut();
      if (mut === null) return;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        let next: UpdateStatusSnapshot;
        switch (command) {
          case "setMode":
            next = await desktopApi().setUpdateMode(
              opts?.mode ?? snapshot.mode,
            );
            break;
          case "check":
            next = await desktopApi().checkForUpdates();
            break;
          case "defer":
            next = await desktopApi().deferUpdate(
              opts?.deferUntilMs ?? Date.now() + 24 * 60 * 60 * 1000,
            );
            break;
          case "download":
            next = await desktopApi().downloadUpdate();
            break;
          case "install":
            next = await desktopApi().installUpdate();
            break;
          case "rollback":
            next = await desktopApi().rollbackUpdate();
            break;
          case "openInstaller":
            next = await desktopApi().openUpdateInstaller();
            break;
          default:
            endMut(mut);
            if (isMutCurrent(mut)) {
              setState((s) => ({ ...s, mutationPending: false }));
            }
            return;
        }
        endMut(mut);
        if (!isMutCurrent(mut)) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          updateStatus: next,
        }));
      } catch (error) {
        endMut(mut);

        if (!isMutCurrent(mut)) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
      }
    },
    [beginMut, endMut, isMutCurrent],
  );

  const loadTutorial = useCallback(async () => {
    const op = ++opRef.current;
    try {
      const tutorial = await desktopApi().getTutorialState();
      if (!isCurrent(op)) return;
      setState((s) => ({ ...s, tutorial }));
    } catch (error) {
      if (!isCurrent(op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [isCurrent]);

  const patchTutorial = useCallback(
    async (patch: Partial<TutorialState>) => {
      const mut = beginMut();
      if (mut === null) return;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        const tutorial = await desktopApi().updateTutorialState(patch);
        endMut(mut);

        if (!isMutCurrent(mut)) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          tutorial,
        }));
      } catch (error) {
        endMut(mut);

        if (!isMutCurrent(mut)) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
      }
    },
    [beginMut, endMut, isMutCurrent],
  );

  useEffect(() => {
    if (!gateway.active) return;
    void reload();
    if (gateway.section === "data") void loadDataStatus();
    if (gateway.section === "updates") void loadUpdates();
    if (gateway.section === "tutorial") void loadTutorial();
    if (gateway.section === "appearance") {
      const appearance = readAppearancePreference();
      setState((s) => ({
        ...s,
        appearance,
        appearanceDraft: { ...appearance },
      }));
    }
  }, [
    gateway.active,
    gateway.section,
    gateway.generation,
    reload,
    loadDataStatus,
    loadUpdates,
    loadTutorial,
  ]);

  return {
    state,
    invalidate,
    reload,
    setLocaleDraft: (v) => setState((s) => ({ ...s, localeDraft: v })),
    commitLocale,
    setThemeDraft,
    setAccentDraft,
    applyAppearanceDraft,
    resetAppearanceDefaults,
    loadDataStatus,
    selectDataDirectory,
    confirmMigrate,
    cancelDataFlow,
    createBackup,
    selectAndPreviewRestore,
    confirmRestore,
    cancelRestore,
    loadUpdates,
    runUpdateCommand,
    loadTutorial,
    resetTutorial: () =>
      patchTutorial({
        version: 1,
        step: "welcome",
        skipped: false,
        completed: false,
      }),
    skipTutorial: () => patchTutorial({ skipped: true }),
    completeTutorial: () =>
      patchTutorial({ completed: true, step: "complete" }),
  };
}
