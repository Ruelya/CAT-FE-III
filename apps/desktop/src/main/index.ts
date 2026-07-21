import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import {
  ENGINE_METHODS,
  type EngineMethod,
  type EngineParams,
} from "@translunar/contracts";

import { EngineClient } from "./engine-client.js";

const IPC_CHANNELS = {
  invoke: "translunar:engine:invoke",
  selectSource: "translunar:dialog:source-docx",
  selectSources: "translunar:dialog:source-documents",
  selectSourceFolder: "translunar:dialog:source-folder",
  selectProjectArchive: "translunar:dialog:project-archive",
  selectProjectArchiveDestination:
    "translunar:dialog:project-archive-destination",
  selectExport: "translunar:dialog:export-docx",
  restartEngine: "translunar:engine:restart",
  setAiCredential: "translunar:ai:credential:set",
  editorCommand: "translunar:editor:command",
} as const;

let mainWindow: BrowserWindow | null = null;
let engine: EngineClient | null = null;
const allowedMethods = new Set<string>(ENGINE_METHODS);

let engineStoppedForQuit = false;

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start Translunar Desktop.", error);
  app.exit(1);
});

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const executable = await resolveEngineExecutable();
  const dataDirectory =
    process.env.TRANSLUNAR_DATA_DIR ?? join(app.getPath("userData"), "engine");
  engine = new EngineClient(executable, dataDirectory);
  await engine.start();
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
  mainWindow.on("closed", () => {
    mainWindow = null;
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
  ipcMain.handle(
    IPC_CHANNELS.invoke,
    async (event: IpcMainInvokeEvent, method: unknown, params: unknown) => {
      assertTrustedSender(event);
      if (!isEngineMethod(method))
        throw new Error("Unsupported engine method.");
      const activeEngine = requireEngine();
      return activeEngine.call(method, params as EngineParams<typeof method>);
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
    const result = await dialog.showOpenDialog(owner, {
      title: "Import source document",
      properties: ["openFile"],
      filters: [supportedDocumentFilter()],
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
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: "Add source documents",
      properties: ["openFile", "multiSelections"],
      filters: [supportedDocumentFilter()],
    });
    return result.canceled ? [] : result.filePaths.slice(0, 500);
  });
  ipcMain.handle(IPC_CHANNELS.selectSourceFolder, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_SOURCE_FOLDER) {
      return process.env.TRANSLUNAR_TEST_SOURCE_FOLDER;
    }
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: "Add a source folder",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC_CHANNELS.selectProjectArchive, async (event) => {
    assertTrustedSender(event);
    if (process.env.TRANSLUNAR_TEST_PROJECT_ARCHIVE) {
      return process.env.TRANSLUNAR_TEST_PROJECT_ARCHIVE;
    }
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: "Restore a Translunar project",
      properties: ["openFile"],
      filters: [
        {
          name: "Translunar project archives",
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
      const result = await dialog.showSaveDialog(requireWindow(), {
        title: "Export Translunar project archive",
        defaultPath: join(app.getPath("documents"), safeName),
        filters: [
          {
            name: "Translunar project archives",
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
      if (process.env.TRANSLUNAR_TEST_EXPORT_DOCX) {
        return process.env.TRANSLUNAR_TEST_EXPORT_DOCX;
      }
      const extension = safeName.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
      const filters =
        extension === "html"
          ? [{ name: "HTML reports", extensions: ["html"] }]
          : extension === "xlsx"
            ? [{ name: "Excel workbooks", extensions: ["xlsx"] }]
            : [{ name: "Source format", extensions: [extension ?? "docx"] }];
      const result = await dialog.showSaveDialog(requireWindow(), {
        title: "Export Translunar file",
        defaultPath: join(app.getPath("documents"), safeName),
        filters,
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
  );
  ipcMain.handle(IPC_CHANNELS.restartEngine, async (event) => {
    assertTrustedSender(event);
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
}

function supportedDocumentFilter(): Electron.FileFilter {
  return {
    name: "Supported documents",
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
    ],
  };
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Rejected IPC from an unknown renderer.");
  }
}

function requireWindow(): BrowserWindow {
  if (!mainWindow) throw new Error("Application window is unavailable.");
  return mainWindow;
}

function requireEngine(): EngineClient {
  if (!engine) throw new Error("Translation engine is unavailable.");
  return engine;
}

function isEngineMethod(value: unknown): value is EngineMethod {
  return typeof value === "string" && allowedMethods.has(value);
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
  const path = app.isPackaged
    ? join(process.resourcesPath, "bin", binary)
    : resolve(app.getAppPath(), "..", "..", "target", "debug", binary);
  await access(path);
  return path;
}
