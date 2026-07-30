import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import {
  ENGINE_METHODS,
  type EngineMethod,
  type EngineParams,
  type PluginSummary,
} from "@translunar/contracts";

import {
  DataDirectoryManager,
  resolveBackupDestinationInput,
  resolveDataDirectory,
} from "./data-directory-manager.js";
import { persistRestoreActiveDataDirectory } from "./active-data-directory-persistence.js";
import { DraftJournal } from "./draft-journal.js";
import { materializeExampleProject } from "./example-assets.js";
import { EngineClient, EngineProcessError } from "./engine-client.js";
import {
  ShellSettingsStore,
  parseShellLocalePreferencePatch,
  shellSettingsPath,
} from "./shell-settings.js";
import {
  createDefaultUpdateManager,
  type UpdateManager,
} from "./update-manager.js";
import type { DesktopEngineInvokeResponse } from "../shared/desktop-api.js";
import { dialogFilterName, dialogTitle } from "../shared/dialog-messages.js";
import type {
  ProductShellSettings,
  TutorialState,
} from "../shared/product-shell.js";
import { defaultTutorialState } from "../shared/product-shell.js";
import {
  releaseSmokeReadinessRequested,
  writeReleaseSmokeReadiness,
} from "./release-smoke-readiness.js";
import {
  PLUGIN_ASSET_SCHEME,
  PluginAssetSessionRegistry,
} from "./plugin-asset-sessions.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: PLUGIN_ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: false,
      corsEnabled: true,
    },
  },
]);

const IPC_CHANNELS = {
  invoke: "translunar:engine:invoke",
  selectSource: "translunar:dialog:source-docx",
  selectSources: "translunar:dialog:source-documents",
  selectSourceFolder: "translunar:dialog:source-folder",
  selectProjectArchive: "translunar:dialog:project-archive",
  selectProjectArchiveDestination:
    "translunar:dialog:project-archive-destination",
  selectExport: "translunar:dialog:export-docx",
  selectInteropInput: "translunar:dialog:interop-input",
  selectTaskPackageInput: "translunar:dialog:task-package-input",
  selectCorpusInput: "translunar:dialog:corpus-input",
  selectPluginPackage: "translunar:dialog:plugin-package",
  issuePluginPanelSession: "translunar:plugin:panel:issue",
  revokePluginPanelSession: "translunar:plugin:panel:revoke",
  pluginPanelRevoked: "translunar:plugin:panel:revoked",
  restartEngine: "translunar:engine:restart",
  setAiCredential: "translunar:ai:credential:set",
  editorCommand: "translunar:editor:command",
  getSystemLocale: "translunar:shell:system-locale",
  getShellSettings: "translunar:shell:settings:get",
  updateShellSettings: "translunar:shell:settings:update",
  getDataDirectoryStatus: "translunar:shell:data-dir:status",
  selectDataDirectory: "translunar:shell:data-dir:select",
  validateDataDirectory: "translunar:shell:data-dir:validate",
  migrateDataDirectory: "translunar:shell:data-dir:migrate",
  selectBackupDestination: "translunar:shell:backup:select-destination",
  createWorkspaceBackup: "translunar:shell:backup:create",
  selectRestoreSource: "translunar:shell:restore:select",
  previewRestore: "translunar:shell:restore:preview",
  restoreWorkspaceBackup: "translunar:shell:restore:apply",
  getDraftJournal: "translunar:shell:draft:list",
  writeDraftJournal: "translunar:shell:draft:write",
  clearDraftJournal: "translunar:shell:draft:clear",
  getUpdateStatus: "translunar:shell:update:status",
  setUpdateMode: "translunar:shell:update:mode",
  checkForUpdates: "translunar:shell:update:check",
  deferUpdate: "translunar:shell:update:defer",
  downloadUpdate: "translunar:shell:update:download",
  installUpdate: "translunar:shell:update:install",
  rollbackUpdate: "translunar:shell:update:rollback",
  openUpdateInstaller: "translunar:shell:update:open-installer",
  getTutorialState: "translunar:shell:tutorial:get",
  updateTutorialState: "translunar:shell:tutorial:update",
  openExampleProject: "translunar:shell:example:open",
  engineStatus: "translunar:engine:status",
  engineReconnected: "translunar:engine:reconnected",
} as const;

let mainWindow: BrowserWindow | null = null;
let engine: EngineClient | null = null;
let shellSettings: ShellSettingsStore | null = null;
let dataDirectoryManager: DataDirectoryManager | null = null;
let draftJournal: DraftJournal | null = null;
let updateManager: UpdateManager | null = null;
let engineExecutable = "";
const allowedMethods = new Set<string>(ENGINE_METHODS);
const pluginAssetSessions = new PluginAssetSessionRegistry();

let engineStoppedForQuit = false;

const testUserDataPath =
  process.env.TRANSLUNAR_TEST_USER_DATA ?? process.env.ELECTRON_USER_DATA;
if (testUserDataPath) {
  app.setPath("userData", resolve(testUserDataPath));
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start Translunar Desktop.", error);
  app.exit(1);
});

async function bootstrap(): Promise<void> {
  await app.whenReady();
  protocol.handle(PLUGIN_ASSET_SCHEME, (request) =>
    pluginAssetSessions.handle(request),
  );
  shellSettings = new ShellSettingsStore(
    shellSettingsPath(app.getPath("userData")),
  );
  const settings = await shellSettings.load();
  engineExecutable = await resolveEngineExecutable();
  const resolvedDataDir = resolveInitialDataDirectory(settings);
  const bundledPluginRoot = await resolveBundledPluginRoot();
  engine = new EngineClient(engineExecutable, resolvedDataDir.path, {
    bundledPluginRoot,
    onUnexpectedExit: ({ attempt, stderrTail }) => {
      pluginAssetSessions.revokeAll();
      mainWindow?.webContents.send(IPC_CHANNELS.pluginPanelRevoked, null);
      mainWindow?.webContents.send(IPC_CHANNELS.engineStatus, {
        type: "reconnecting",
        attempt,
        message: stderrTail,
      });
    },
    onReconnected: ({ attempt }) => {
      pluginAssetSessions.revokeAll();
      mainWindow?.webContents.send(IPC_CHANNELS.pluginPanelRevoked, null);
      mainWindow?.webContents.send(IPC_CHANNELS.engineReconnected);
      mainWindow?.webContents.send(IPC_CHANNELS.engineStatus, {
        type: "reconnected",
        attempt,
      });
    },
    onRestartFailed: ({ attempts, error }) => {
      mainWindow?.webContents.send(IPC_CHANNELS.engineStatus, {
        type: "failed",
        attempt: attempts,
        message: error.message,
      });
    },
  });
  await engine.start();
  // Opt-in main-process-only crash seam for Electron E2E. Never installed for
  // default launches; no IPC, preload, or renderer API is exposed.
  if (process.env.TRANSLUNAR_E2E_ENGINE_CRASH_SEAM === "1") {
    (
      globalThis as typeof globalThis & {
        __translunarE2E?: {
          forceKillEngine: () => boolean;
          getEnginePid: () => number | null;
        };
      }
    ).__translunarE2E = {
      forceKillEngine: () => engine?.forceKillChildForTest() ?? false,
      getEnginePid: () => engine?.getLiveChildPidForTest() ?? null,
    };
  }
  if (releaseSmokeReadinessRequested(process.env)) {
    const health = await engine.call("data.checkHealth", {});
    await writeReleaseSmokeReadiness(process.env, {
      appVersion: app.getVersion(),
      health,
    });
  }
  draftJournal = new DraftJournal(resolvedDataDir.path);
  dataDirectoryManager = new DataDirectoryManager(
    resolvedDataDir.path,
    {
      stop: () => requireEngine().stop(),
      startWithDataDirectory: (path) =>
        requireEngine().startWithDataDirectory(path),
      checkHealth: async () => {
        const report = await requireEngine().call("data.checkHealth", {});
        return {
          healthy: report.healthy,
          schemaVersion: report.schemaVersion,
        };
      },
      createBackup: async (destinationPath) => {
        const result = await requireEngine().call("data.createBackup", {
          destinationPath,
        });
        return result;
      },
      getDataDirectory: () => requireEngine().dataDirectory,
      setDataDirectory: (path) => {
        requireEngine().setDataDirectory(path);
        draftJournal = new DraftJournal(path);
      },
    },
    { isTestOverride: resolvedDataDir.isTestOverride },
  );
  if (!resolvedDataDir.isTestOverride) {
    await shellSettings.update({
      dataDirectoryPath: resolvedDataDir.path,
    });
  }
  updateManager = createDefaultUpdateManager({
    mode: settings.updateMode,
    deferredUntilMs: settings.deferredUntilMs,
    installLedger: settings.installLedger,
    stageRoot: join(app.getPath("userData"), "update-staging"),
    hooks: {
      createBackup: async () => {
        const destination = join(
          app.getPath("userData"),
          "pre-update-backups",
          `workspace-${Date.now()}`,
        );
        const created =
          await requireDataDirectoryManager().createBackup(destination);
        return { path: created.destinationPath };
      },
      validateBackup: async (backupPath) => {
        const validation =
          await requireDataDirectoryManager().validateBackup(backupPath);
        return {
          ok: validation.ok,
          ...(validation.message === undefined
            ? {}
            : { message: validation.message }),
        };
      },
      hasUnsavedDrafts: async () => {
        const snapshot = await requireDraftJournal().list();
        return snapshot.records.length > 0;
      },
      pathExists: async (targetPath) => {
        try {
          await access(targetPath);
          return true;
        } catch {
          return false;
        }
      },
      restoreFromBackup: async (backupPath) => {
        const manager = requireDataDirectoryManager();
        const result = await manager.restoreFromBackup(backupPath);
        await persistRestoreActiveDataDirectory(
          manager,
          result,
          requireShellSettings(),
        );
        return { ok: result.ok, message: result.message };
      },
      openPath: async (targetPath) => shell.openPath(targetPath),
      healthCheck: async () => {
        try {
          const report = await requireEngine().call("data.checkHealth", {});
          return Boolean(
            report &&
            typeof report === "object" &&
            "healthy" in report &&
            (report as { healthy: boolean }).healthy,
          );
        } catch {
          return false;
        }
      },
      persistLedger: async (ledger) => {
        await requireShellSettings().update({ installLedger: ledger });
      },
      onInstalled: async ({ version, ledger }) => {
        await requireShellSettings().pushUpdate({
          id: `update-${Date.now()}`,
          version,
          status: "installed",
          atMs: Date.now(),
          ...(ledger.previousVersion
            ? { detail: `Upgraded from ${ledger.previousVersion}` }
            : {}),
        });
      },
      onRecovery: async ({ action, outcome, version, detail }) => {
        if (action === "rollback" && outcome === "succeeded") {
          await requireShellSettings().pushUpdate({
            id: `update-rollback-${Date.now()}`,
            version,
            status: "rolled_back",
            atMs: Date.now(),
            ...(detail ? { detail } : {}),
          });
          return;
        }
        if (action === "open_installer" && outcome === "succeeded") {
          await requireShellSettings().pushUpdate({
            id: `update-manual-recovery-${Date.now()}`,
            version,
            status: "manual_recovery",
            atMs: Date.now(),
            detail: "Opened the downloaded installer for manual recovery.",
          });
          return;
        }
        if (outcome === "failed") {
          await requireShellSettings().pushUpdate({
            id: `update-recovery-failed-${Date.now()}`,
            version,
            status: "failed",
            atMs: Date.now(),
            ...(detail ? { detail } : {}),
          });
        }
      },
    },
  });
  if (settings.installLedger?.pendingRestart) {
    await updateManager.reconcilePendingInstall();
  }
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (!engine || engineStoppedForQuit) return;
    event.preventDefault();
    engineStoppedForQuit = true;
    void engine.stop().finally(() => app.quit());
  });

  if (settings.updateMode === "automatic") {
    void updateManager.check().catch(() => undefined);
  }
}

function resolveInitialDataDirectory(settings: ProductShellSettings): {
  path: string;
  isTestOverride: boolean;
} {
  const envOverride = process.env.TRANSLUNAR_DATA_DIR;
  return resolveDataDirectory({
    ...(envOverride === undefined ? {} : { envOverride }),
    settingsPath: settings.dataDirectoryPath,
    defaultPath: join(app.getPath("userData"), "engine"),
  });
}

function createWindow(): void {
  const preload = join(
    app.getAppPath(),
    "dist",
    "electron",
    "preload",
    "index.cjs",
  );
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1180,
    minHeight: 700,
    show: false,
    backgroundColor: "#f1e7d6",
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const windowWebContentsId = mainWindow.webContents.id;
  const revokeWindowPluginSessions = (): void => {
    pluginAssetSessions.revokeOwner(windowWebContentsId);
  };
  mainWindow.on("closed", () => {
    revokeWindowPluginSessions();
    mainWindow = null;
  });
  mainWindow.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) revokeWindowPluginSessions();
    },
  );
  mainWindow.webContents.on("render-process-gone", () => {
    revokeWindowPluginSessions();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.isComposing) return;
    const modifier = input.control || input.meta;
    const command =
      modifier && input.key.toLocaleLowerCase() === "k"
        ? "editor.palette"
        : modifier && input.key.toLocaleLowerCase() === "f"
          ? "editor.findReplace"
          : null;
    if (!command) return;
    event.preventDefault();
    mainWindow?.webContents.send(IPC_CHANNELS.editorCommand, command);
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && new URL(url).origin !== new URL(current).origin)
      event.preventDefault();
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(
      join(app.getAppPath(), "dist", "renderer", "index.html"),
    );
  }
}

function registerIpc(): void {
  const testEngineDelayMs = Number(
    process.env.TRANSLUNAR_TEST_ENGINE_DELAY_MS ?? "0",
  );
  const testEngineDelayMethods = new Set(
    (process.env.TRANSLUNAR_TEST_ENGINE_DELAY_METHODS ?? "")
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean),
  );
  let remainingTestEngineDelays = Number(
    process.env.TRANSLUNAR_TEST_ENGINE_DELAY_LIMIT ?? "0",
  );
  ipcMain.handle(
    IPC_CHANNELS.invoke,
    async (event: IpcMainInvokeEvent, method: unknown, params: unknown) => {
      assertTrustedSender(event);
      if (!isEngineMethod(method))
        throw new Error("Unsupported engine method.");
      const activeEngine = requireEngine();
      try {
        if (
          Number.isFinite(testEngineDelayMs) &&
          testEngineDelayMs > 0 &&
          remainingTestEngineDelays > 0 &&
          testEngineDelayMethods.has(method)
        ) {
          remainingTestEngineDelays -= 1;
          await new Promise<void>((resolveDelay) => {
            setTimeout(resolveDelay, Math.min(testEngineDelayMs, 10_000));
          });
        }
        const result = await activeEngine.call(
          method,
          params as EngineParams<typeof method>,
        );
        invalidatePluginSessionsAfterMutation(method, params);
        return { ok: true, result } satisfies DesktopEngineInvokeResponse;
      } catch (error) {
        if (!(error instanceof EngineProcessError)) throw error;
        if (error.code === "plugin_sandbox_failed") {
          pluginAssetSessions.revokeAll();
          mainWindow?.webContents.send(IPC_CHANNELS.pluginPanelRevoked, null);
        }
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.data === undefined ? {} : { data: error.data }),
          },
        } satisfies DesktopEngineInvokeResponse;
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.selectSource, async (event) => {
    assertTrustedSender(event);
    const testSource =
      process.env.TRANSLUNAR_TEST_SOURCE ??
      process.env.TRANSLUNAR_TEST_SOURCE_DOCX;
    if (testSource) {
      return testSource;
    }
    const owner = requireWindow();
    const locale = await currentDialogLocale();
    const result = await dialog.showOpenDialog(owner, {
      title: dialogTitle(locale, "dialog.selectSource"),
      properties: ["openFile"],
      filters: [supportedDocumentFilter(locale)],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC_CHANNELS.selectSources, async (event) => {
    assertTrustedSender(event);
    const testSources = process.env.TRANSLUNAR_TEST_SOURCE_FILES;
    if (testSources) {
      return testSources
        .split(process.platform === "win32" ? ";" : ":")
        .filter(Boolean);
    }
    const locale = await currentDialogLocale();
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: dialogTitle(locale, "dialog.selectSources"),
      properties: ["openFile", "multiSelections"],
      filters: [supportedDocumentFilter(locale)],
    });
    return result.canceled ? [] : result.filePaths.slice(0, 500);
  });
  ipcMain.handle(IPC_CHANNELS.selectSourceFolder, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_SOURCE_FOLDER) {
      return process.env.TRANSLUNAR_TEST_SOURCE_FOLDER;
    }
    const locale = await currentDialogLocale();
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: dialogTitle(locale, "dialog.selectSourceFolder"),
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC_CHANNELS.selectProjectArchive, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_PROJECT_ARCHIVE) {
      return process.env.TRANSLUNAR_TEST_PROJECT_ARCHIVE;
    }
    const locale = await currentDialogLocale();
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: dialogTitle(locale, "dialog.selectProjectArchive"),
      properties: ["openFile"],
      filters: [
        {
          name: dialogFilterName(locale, "filter.projectArchives"),
          extensions: ["tlcat", "zip"],
        },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(
    IPC_CHANNELS.selectProjectArchiveDestination,
    async (event, suggestedName: unknown) => {
      assertTrustedSender(event);
      const safeName =
        typeof suggestedName === "string" && suggestedName.trim()
          ? suggestedName.replaceAll(/[\\/:*?"<>|]/gu, "-")
          : "project.tlcat";
      if (process.env.TRANSLUNAR_TEST_PROJECT_ARCHIVE_DESTINATION) {
        return process.env.TRANSLUNAR_TEST_PROJECT_ARCHIVE_DESTINATION;
      }
      const locale = await currentDialogLocale();
      const result = await dialog.showSaveDialog(requireWindow(), {
        title: dialogTitle(locale, "dialog.selectProjectArchiveDestination"),
        defaultPath: join(app.getPath("documents"), safeName),
        filters: [
          {
            name: dialogFilterName(locale, "filter.projectArchives"),
            extensions: ["tlcat"],
          },
        ],
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.selectExport,
    async (event, suggestedName: unknown) => {
      assertTrustedSender(event);
      const safeName =
        typeof suggestedName === "string" && suggestedName.trim()
          ? suggestedName.replaceAll(/[\\/:*?"<>|]/gu, "-")
          : "translation.docx";
      if (
        process.env.TRANSLUNAR_TEST_EXPORT_DIRECTORY &&
        safeName.startsWith("qa-")
      ) {
        return join(process.env.TRANSLUNAR_TEST_EXPORT_DIRECTORY, safeName);
      }
      if (
        process.env.TRANSLUNAR_TEST_CURATION_EXPORT &&
        safeName.startsWith("curation-")
      ) {
        return process.env.TRANSLUNAR_TEST_CURATION_EXPORT;
      }
      if (
        safeName.toLocaleLowerCase().endsWith(".tltask") &&
        process.env.TRANSLUNAR_TEST_TASK_PACKAGE_DESTINATION
      ) {
        return process.env.TRANSLUNAR_TEST_TASK_PACKAGE_DESTINATION;
      }
      if (process.env.TRANSLUNAR_TEST_EXPORT_DOCX) {
        return process.env.TRANSLUNAR_TEST_EXPORT_DOCX;
      }
      const locale = await currentDialogLocale();
      const extension = safeName.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
      const filters =
        extension === "html"
          ? [
              {
                name: dialogFilterName(locale, "filter.htmlReports"),
                extensions: ["html"],
              },
            ]
          : extension === "xlsx"
            ? [
                {
                  name: dialogFilterName(locale, "filter.excelWorkbooks"),
                  extensions: ["xlsx"],
                },
              ]
            : extension === "tltask"
              ? [
                  {
                    name: dialogFilterName(locale, "filter.taskPackages"),
                    extensions: ["tltask"],
                  },
                ]
              : [
                  {
                    name: dialogFilterName(locale, "filter.sourceFormat"),
                    extensions: [extension ?? "docx"],
                  },
                ];
      const result = await dialog.showSaveDialog(requireWindow(), {
        title: dialogTitle(
          locale,
          extension === "tltask"
            ? "dialog.selectExportTaskPackage"
            : "dialog.selectExport",
        ),
        defaultPath: join(app.getPath("documents"), safeName),
        filters,
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.selectInteropInput,
    async (event, kind: unknown) => {
      assertTrustedSender(event);
      if (kind !== "review" && kind !== "table") {
        throw new Error("Invalid interop input type.");
      }
      const testPath =
        kind === "review"
          ? process.env.TRANSLUNAR_TEST_INTEROP_REVIEW
          : process.env.TRANSLUNAR_TEST_INTEROP_TABLE;
      if (testPath) return testPath;
      const locale = await currentDialogLocale();
      const result = await dialog.showOpenDialog(requireWindow(), {
        title: dialogTitle(
          locale,
          kind === "review"
            ? "dialog.selectInteropReview"
            : "dialog.selectInteropTable",
        ),
        properties: ["openFile"],
        filters:
          kind === "review"
            ? [
                {
                  name: dialogFilterName(locale, "filter.reviewDocx"),
                  extensions: ["docx"],
                },
              ]
            : [
                {
                  name: dialogFilterName(locale, "filter.bilingualTables"),
                  extensions: ["docx", "xlsx"],
                },
              ],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  );
  ipcMain.handle(IPC_CHANNELS.selectTaskPackageInput, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_TASK_PACKAGE_INPUT) {
      return process.env.TRANSLUNAR_TEST_TASK_PACKAGE_INPUT;
    }
    const locale = await currentDialogLocale();
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: dialogTitle(locale, "dialog.selectTaskPackageInput"),
      properties: ["openFile"],
      filters: [
        {
          name: dialogFilterName(locale, "filter.taskPackages"),
          extensions: ["tltask"],
        },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC_CHANNELS.selectCorpusInput, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_CORPUS_INPUT) {
      return process.env.TRANSLUNAR_TEST_CORPUS_INPUT;
    }
    const locale = await currentDialogLocale();
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: dialogTitle(locale, "dialog.selectCorpusInput"),
      properties: ["openFile"],
      filters: [supportedDocumentFilter(locale)],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC_CHANNELS.selectPluginPackage, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_PLUGIN_SOURCE) {
      return process.env.TRANSLUNAR_TEST_PLUGIN_SOURCE;
    }
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: dialogTitle(
        await currentDialogLocale(),
        "dialog.selectPluginPackage",
      ),
      properties: ["openFile", "openDirectory"],
      filters: [
        { name: "Plugin package", extensions: ["tlplugin"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(
    IPC_CHANNELS.issuePluginPanelSession,
    async (event, input: unknown) => {
      assertTrustedSender(event);
      const request = parsePluginPanelSessionRequest(input);
      const activeEngine = requireEngine();
      const [plugin, inventory] = await Promise.all([
        activeEngine.call("plugin.get", { pluginId: request.pluginId }),
        activeEngine.call("plugin.uiPanel.list", {}),
      ]);
      const panel = inventory.items.find(
        (item) =>
          item.owner.pluginId === request.pluginId &&
          item.owner.contributionId === request.contributionId &&
          item.owner.activationRevision === request.revision &&
          item.state === "active",
      );
      if (!panel || !matchesPluginPanelRequest(plugin, request)) {
        throw new Error(
          "Plugin panel is not available for this active revision.",
        );
      }
      const activeVersionId = plugin.activeVersionId;
      if (!activeVersionId || activeVersionId !== panel.owner.versionId) {
        throw new Error(
          "Plugin panel is not available for this active revision.",
        );
      }
      if (panel.descriptor.bridgeVersion !== 1) {
        throw new Error("Plugin panel contribution is not available.");
      }
      const issued = await pluginAssetSessions.issue({
        ownerWebContentsId: event.sender.id,
        pluginId: plugin.id,
        versionId: panel.owner.versionId,
        revision: panel.owner.activationRevision,
        contributionId: panel.owner.contributionId,
        bridgeVersion: 1,
        packageRoot: plugin.packagePath,
        surface: panel.descriptor.surface,
      });
      try {
        const current = await activeEngine.call("plugin.uiPanel.list", {});
        if (
          !current.items.some(
            (item) =>
              item.owner.pluginId === panel.owner.pluginId &&
              item.owner.versionId === panel.owner.versionId &&
              item.owner.activationRevision ===
                panel.owner.activationRevision &&
              item.owner.contributionId === panel.owner.contributionId &&
              item.state === "active",
          )
        ) {
          throw new Error("stale plugin panel request");
        }
        return issued;
      } catch {
        pluginAssetSessions.revoke(issued.sessionId, event.sender.id);
        throw new Error(
          "Plugin panel is not available for this active revision.",
        );
      }
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.revokePluginPanelSession,
    (event, sessionId: unknown) => {
      assertTrustedSender(event);
      if (typeof sessionId !== "string" || !/^[a-f0-9]{64}$/u.test(sessionId)) {
        return false;
      }
      return pluginAssetSessions.revoke(sessionId, event.sender.id);
    },
  );
  ipcMain.handle(IPC_CHANNELS.restartEngine, async (event) => {
    assertTrustedSender(event);
    pluginAssetSessions.revokeAll();
    mainWindow?.webContents.send(IPC_CHANNELS.pluginPanelRevoked, null);
    await requireEngine().restart();
  });
  ipcMain.handle(
    IPC_CHANNELS.setAiCredential,
    async (event, profileId: unknown, secret: unknown) => {
      assertTrustedSender(event);
      if (
        typeof profileId !== "string" ||
        !profileId.trim() ||
        typeof secret !== "string" ||
        !secret ||
        secret.length > 16_384
      ) {
        throw new Error("Invalid AI credential request.");
      }
      return requireEngine().callInternal("ai.credential.set", {
        profileId,
        secret,
      });
    },
  );

  // --- Product shell IPC ---
  ipcMain.handle(IPC_CHANNELS.getSystemLocale, (event) => {
    assertTrustedSender(event);
    return app.getLocale();
  });
  ipcMain.handle(IPC_CHANNELS.getShellSettings, async (event) => {
    assertTrustedSender(event);
    return requireShellSettings().load();
  });
  ipcMain.handle(
    IPC_CHANNELS.updateShellSettings,
    async (event, patch: unknown) => {
      assertTrustedSender(event);
      const localePatch = parseShellLocalePreferencePatch(patch);
      return requireShellSettings().update(localePatch);
    },
  );
  ipcMain.handle(IPC_CHANNELS.getDataDirectoryStatus, async (event) => {
    assertTrustedSender(event);
    return requireDataDirectoryManager().status();
  });
  ipcMain.handle(IPC_CHANNELS.selectDataDirectory, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_DATA_DIRECTORY) {
      return process.env.TRANSLUNAR_TEST_DATA_DIRECTORY;
    }
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: dialogTitle(
        await currentDialogLocale(),
        "dialog.selectDataDirectory",
      ),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(
    IPC_CHANNELS.validateDataDirectory,
    async (event, path: unknown) => {
      assertTrustedSender(event);
      if (typeof path !== "string") throw new Error("Invalid path.");
      return requireDataDirectoryManager().validateTarget(path);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.migrateDataDirectory,
    async (event, path: unknown) => {
      assertTrustedSender(event);
      if (typeof path !== "string") throw new Error("Invalid path.");
      const manager = requireDataDirectoryManager();
      const result = await manager.migrate(path);
      if (result.ok && !manager.isTestOverride) {
        await requireShellSettings().update({
          dataDirectoryPath: result.activePath,
        });
      }
      return result;
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.selectBackupDestination,
    async (event, suggestedName: unknown) => {
      assertTrustedSender(event);
      if (process.env.TRANSLUNAR_TEST_BACKUP_DESTINATION) {
        return process.env.TRANSLUNAR_TEST_BACKUP_DESTINATION;
      }
      const safeName =
        typeof suggestedName === "string" && suggestedName.trim()
          ? suggestedName.replaceAll(/[\\/:*?"<>|]/gu, "-")
          : `translunar-backup-${Date.now()}`;
      const result = await dialog.showOpenDialog(requireWindow(), {
        title: dialogTitle(
          await currentDialogLocale(),
          "dialog.selectBackupDestination",
        ),
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return join(result.filePaths[0], safeName);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.createWorkspaceBackup,
    async (event, destinationPath: unknown) => {
      assertTrustedSender(event);
      try {
        const destination = resolveBackupDestinationInput(
          destinationPath,
          process.env.TRANSLUNAR_TEST_BACKUP_DESTINATION,
        );
        if (!destination.ok) {
          return {
            ok: false,
            code: destination.code,
            message: destination.message,
          };
        }
        const created = await requireDataDirectoryManager().createBackup(
          destination.path,
        );
        await requireShellSettings().pushBackup({
          id: `backup-${created.manifest.createdAtMs}`,
          destinationPath: created.destinationPath,
          createdAtMs: created.manifest.createdAtMs,
          schemaVersion: created.manifest.schemaVersion,
          engineVersion: created.manifest.engineVersion,
          fileCount: created.manifest.files.length,
        });
        return {
          ok: true,
          data: created,
          message: created.destinationPath,
        };
      } catch (error) {
        return {
          ok: false,
          code:
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: string }).code ?? "backup_failed")
              : "backup_failed",
          message: error instanceof Error ? error.message : "Backup failed.",
        };
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.selectRestoreSource, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_RESTORE_SOURCE) {
      return process.env.TRANSLUNAR_TEST_RESTORE_SOURCE;
    }
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: dialogTitle(
        await currentDialogLocale(),
        "dialog.selectRestoreSource",
      ),
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC_CHANNELS.previewRestore, async (event, path: unknown) => {
    assertTrustedSender(event);
    if (typeof path !== "string") throw new Error("Invalid path.");
    const preview = await requireDataDirectoryManager().previewRestore(path);
    if (!preview.ok || !preview.summary) {
      return {
        ok: false,
        code: preview.code,
        message: preview.message,
      };
    }
    return {
      ok: true,
      data: preview.summary,
    };
  });
  ipcMain.handle(
    IPC_CHANNELS.restoreWorkspaceBackup,
    async (event, params: unknown) => {
      assertTrustedSender(event);
      if (!isRecord(params)) {
        throw new Error("Invalid restore request.");
      }
      const path = stringField(params.path);
      const confirmationToken = stringField(params.confirmationToken);
      const manager = requireDataDirectoryManager();
      const result = await manager.restoreFromConfirmedPreview({
        path,
        confirmationToken,
      });
      await persistRestoreActiveDataDirectory(
        manager,
        result,
        requireShellSettings(),
      );
      return result;
    },
  );
  ipcMain.handle(IPC_CHANNELS.getDraftJournal, async (event) => {
    assertTrustedSender(event);
    return requireDraftJournal().list();
  });
  ipcMain.handle(
    IPC_CHANNELS.writeDraftJournal,
    async (event, record: unknown) => {
      assertTrustedSender(event);
      if (!isRecord(record)) throw new Error("Invalid draft record.");
      return requireDraftJournal().upsert({
        projectId: stringField(record.projectId),
        documentId: stringField(record.documentId),
        segmentId: stringField(record.segmentId),
        expectedRevision: Number(record.expectedRevision ?? 0),
        targetText: stringField(record.targetText),
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.clearDraftJournal,
    async (event, segmentIds: unknown) => {
      assertTrustedSender(event);
      const ids = Array.isArray(segmentIds)
        ? segmentIds.map(String)
        : undefined;
      return requireDraftJournal().clear(ids);
    },
  );
  ipcMain.handle(IPC_CHANNELS.getUpdateStatus, (event) => {
    assertTrustedSender(event);
    return requireUpdateManager().snapshot();
  });
  ipcMain.handle(IPC_CHANNELS.setUpdateMode, async (event, mode: unknown) => {
    assertTrustedSender(event);
    if (mode !== "automatic" && mode !== "manual" && mode !== "disabled") {
      throw new Error("Invalid update mode.");
    }
    await requireShellSettings().update({ updateMode: mode });
    return requireUpdateManager().setMode(mode);
  });
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, async (event) => {
    assertTrustedSender(event);
    return requireUpdateManager().check({ manual: true });
  });
  ipcMain.handle(IPC_CHANNELS.deferUpdate, async (event, untilMs: unknown) => {
    assertTrustedSender(event);
    if (typeof untilMs !== "number") throw new Error("Invalid defer time.");
    await requireShellSettings().update({ deferredUntilMs: untilMs });
    return requireUpdateManager().defer(untilMs);
  });
  ipcMain.handle(IPC_CHANNELS.downloadUpdate, async (event) => {
    assertTrustedSender(event);
    return requireUpdateManager().download();
  });
  ipcMain.handle(IPC_CHANNELS.installUpdate, async (event) => {
    assertTrustedSender(event);
    const result = await requireUpdateManager().install();
    if (
      result.status === "rollback-required" ||
      result.installLedger.rollbackRequired
    ) {
      await requireShellSettings().pushUpdate({
        id: `update-${Date.now()}`,
        version: result.installLedger.targetVersion ?? result.currentVersion,
        status: "failed",
        atMs: Date.now(),
        ...(result.lastError ? { detail: result.lastError } : {}),
      });
    }
    // pending-restart: ledger is already persisted; do not claim installed
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.rollbackUpdate, async (event) => {
    assertTrustedSender(event);
    return requireUpdateManager().rollback();
  });
  ipcMain.handle(IPC_CHANNELS.openUpdateInstaller, async (event) => {
    assertTrustedSender(event);
    return requireUpdateManager().openInstaller();
  });
  ipcMain.handle(IPC_CHANNELS.getTutorialState, async (event) => {
    assertTrustedSender(event);
    const settings = await requireShellSettings().load();
    return settings.tutorial;
  });
  ipcMain.handle(
    IPC_CHANNELS.updateTutorialState,
    async (event, patch: unknown) => {
      assertTrustedSender(event);
      if (!isRecord(patch)) throw new Error("Invalid tutorial patch.");
      const settings = await requireShellSettings().load();
      const tutorial: TutorialState = {
        ...settings.tutorial,
        ...defaultTutorialState(Date.now()),
        ...settings.tutorial,
        ...(patch as Partial<TutorialState>),
        updatedAtMs: Date.now(),
      };
      const next = await requireShellSettings().update({ tutorial });
      return next.tutorial;
    },
  );
  ipcMain.handle(IPC_CHANNELS.openExampleProject, async (event) => {
    assertTrustedSender(event);
    try {
      const examplePath = await materializeExampleProject({
        dataDirectory: requireDataDirectoryManager().livePath,
        resourceRoots: [
          join(
            process.resourcesPath ?? app.getAppPath(),
            "examples",
            "welcome",
          ),
          resolve(
            app.getAppPath(),
            "..",
            "..",
            "apps",
            "desktop",
            "resources",
            "examples",
            "welcome",
          ),
        ],
      });
      const project = await requireEngine().call("project.create", {
        name: "Example: Welcome to Translunar",
        sourceLocale: "en-US",
        targetLocale: "zh-CN",
        domain: "example",
      });
      const imported = await requireEngine().call("document.import", {
        projectId: project.id,
        sourcePath: examplePath,
        relativePath: "welcome.txt",
      });
      const documentId =
        imported &&
        typeof imported === "object" &&
        "document" in imported &&
        imported.document &&
        typeof imported.document === "object" &&
        "id" in imported.document
          ? String((imported.document as { id: string }).id)
          : typeof imported === "object" && imported && "id" in imported
            ? String((imported as unknown as { id: string }).id)
            : "";
      return {
        ok: true,
        projectId: project.id,
        documentId,
      };
    } catch (error) {
      const code =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? String((error as { code: string }).code)
          : "example_open_failed";
      return {
        ok: false,
        code,
        message:
          error instanceof Error
            ? error.message
            : "Could not open the example project.",
      };
    }
  });
}

function parsePluginPanelSessionRequest(input: unknown): {
  pluginId: string;
  contributionId: string;
  revision: number;
} {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw new Error("Invalid plugin panel session request.");
  }
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    typeof record.pluginId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(record.pluginId) ||
    typeof record.contributionId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(record.contributionId) ||
    !Number.isSafeInteger(record.revision) ||
    Number(record.revision) < 0
  ) {
    throw new Error("Invalid plugin panel session request.");
  }
  return {
    pluginId: record.pluginId,
    contributionId: record.contributionId,
    revision: Number(record.revision),
  };
}

function invalidatePluginSessionsAfterMutation(
  method: EngineMethod,
  params: unknown,
): void {
  if (
    method !== "plugin.enable" &&
    method !== "plugin.disable" &&
    method !== "plugin.uninstall" &&
    method !== "plugin.upgrade" &&
    method !== "plugin.rollback" &&
    method !== "plugin.permission.grant" &&
    method !== "plugin.permission.deny" &&
    method !== "plugin.permission.revoke"
  ) {
    return;
  }
  if (
    params &&
    typeof params === "object" &&
    "pluginId" in params &&
    typeof (params as { pluginId?: unknown }).pluginId === "string"
  ) {
    pluginAssetSessions.revokePlugin((params as { pluginId: string }).pluginId);
    mainWindow?.webContents.send(
      IPC_CHANNELS.pluginPanelRevoked,
      (params as { pluginId: string }).pluginId,
    );
  }
}

async function currentDialogLocale(): Promise<string> {
  try {
    if (shellSettings) {
      const settings = await shellSettings.load();
      if (settings.locale) return settings.locale;
    }
  } catch {
    // fall through to system locale
  }
  try {
    return app.getLocale();
  } catch {
    return "en-US";
  }
}

function supportedDocumentFilter(locale: string): Electron.FileFilter {
  return {
    name: dialogFilterName(locale, "filter.supportedDocuments"),
    extensions: [
      "docx",
      "xlsx",
      "pptx",
      "pdf",
      "txt",
      "md",
      "markdown",
      "html",
      "htm",
      "xhtml",
      "xlf",
      "xliff",
      "sdlxliff",
      "mqxliff",
      "mqxlz",
    ],
  };
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error("Rejected IPC from an unknown renderer.");
  }
}

function isTrustedRendererUrl(value: string): boolean {
  try {
    const candidate = new URL(value);
    const expected = process.env.VITE_DEV_SERVER_URL
      ? new URL(process.env.VITE_DEV_SERVER_URL)
      : new URL(
          pathToFileURL(
            join(app.getAppPath(), "dist", "renderer", "index.html"),
          ).href,
        );
    return (
      candidate.protocol === expected.protocol &&
      candidate.host === expected.host &&
      candidate.pathname === expected.pathname &&
      candidate.search === expected.search
    );
  } catch {
    return false;
  }
}

function matchesPluginPanelRequest(
  plugin: PluginSummary,
  request: { pluginId: string; contributionId: string; revision: number },
): boolean {
  return (
    plugin.id === request.pluginId &&
    plugin.status === "enabled" &&
    plugin.tier === "sandbox" &&
    plugin.revision === request.revision &&
    typeof plugin.activeVersionId === "string" &&
    plugin.activeVersionId.length > 0 &&
    (plugin.contributions ?? []).some(
      (contribution) =>
        contribution.kind === "uiPanel" &&
        contribution.id === request.contributionId &&
        contribution.bridgeVersion === 1,
    )
  );
}

function requireWindow(): BrowserWindow {
  if (!mainWindow) throw new Error("Application window is unavailable.");
  return mainWindow;
}

function requireEngine(): EngineClient {
  if (!engine) throw new Error("Translation engine is unavailable.");
  return engine;
}

function requireShellSettings(): ShellSettingsStore {
  if (!shellSettings) throw new Error("Shell settings are unavailable.");
  return shellSettings;
}

function requireDataDirectoryManager(): DataDirectoryManager {
  if (!dataDirectoryManager) {
    throw new Error("Data directory manager is unavailable.");
  }
  return dataDirectoryManager;
}

function requireDraftJournal(): DraftJournal {
  if (!draftJournal) throw new Error("Draft journal is unavailable.");
  return draftJournal;
}

function requireUpdateManager(): UpdateManager {
  if (!updateManager) throw new Error("Update manager is unavailable.");
  return updateManager;
}

function isEngineMethod(value: unknown): value is EngineMethod {
  return typeof value === "string" && allowedMethods.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function resolveEngineExecutable(): Promise<string> {
  if (process.env.TRANSLUNAR_ENGINE_PATH) {
    await access(process.env.TRANSLUNAR_ENGINE_PATH);
    return process.env.TRANSLUNAR_ENGINE_PATH;
  }
  const binary =
    process.platform === "win32"
      ? "translunar-engine.exe"
      : "translunar-engine";
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, "engine", binary),
        join(process.resourcesPath, "bin", binary),
      ]
    : [
        resolve(app.getAppPath(), "..", "..", "target", "debug", binary),
        resolve(app.getAppPath(), "..", "..", "target", "release", binary),
        // Orca/worktree cargo target override used by this task.
        resolve(
          "W:/cargo-target-plugin-management-release",
          "debug",
          binary,
        ),
        resolve(
          "W:/cargo-target-plugin-management-release",
          "release",
          binary,
        ),
      ];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // try next
    }
  }
  throw new Error(`Translation engine binary not found (${binary}).`);
}

async function resolveBundledPluginRoot(): Promise<string | null> {
  if (process.env.TRANSLUNAR_BUNDLED_PLUGIN_ROOT) {
    try {
      await access(process.env.TRANSLUNAR_BUNDLED_PLUGIN_ROOT);
      return process.env.TRANSLUNAR_BUNDLED_PLUGIN_ROOT;
    } catch {
      return null;
    }
  }
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "plugins")]
    : [
        resolve(app.getAppPath(), "resources", "plugins"),
        resolve(app.getAppPath(), "..", "..", "apps", "desktop", "resources", "plugins"),
        resolve(
          process.cwd(),
          "apps",
          "desktop",
          "resources",
          "plugins",
        ),
      ];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // try next
    }
  }
  return null;
}
