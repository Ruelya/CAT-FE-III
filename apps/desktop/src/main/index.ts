import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BrowserWindow, app, dialog, ipcMain } from "electron";

import { IPC_CHANNELS } from "../shared/desktop-api.js";
import type {
  DocxPreviewResponse,
  EngineInvokeResponse,
} from "../shared/desktop-api.js";
import { EngineRpcError, EngineSupervisor } from "./engine-supervisor.js";
import { installApplicationMenu } from "./menu.js";

function resolveEngineBinary(): string {
  const override = process.env.TL_ENGINE_BIN;
  if (override && override.trim().length > 0) {
    return override;
  }
  const binary = process.platform === "win32" ? "tl-engine.exe" : "tl-engine";
  if (app.isPackaged) {
    return join(process.resourcesPath, "engine", binary);
  }
  // dist/electron/main -> apps/desktop -> repo root.
  const repoRoot = resolve(import.meta.dirname, "../../../../..");
  return join(repoRoot, "target", "debug", binary);
}

function resolveDataDir(): string {
  const override = process.env.TL_DATA_DIR;
  if (override && override.trim().length > 0) {
    return override;
  }
  return join(app.getPath("userData"), "engine-data");
}

let supervisor: EngineSupervisor | undefined;

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: "#eef0f4",
    title: "Translunar CAT",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadURL(
      pathToFileURL(
        join(import.meta.dirname, "../../renderer/index.html"),
      ).toString(),
    );
  }
}

function registerIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.invoke,
    async (
      _event,
      method: unknown,
      params: unknown,
    ): Promise<EngineInvokeResponse> => {
      if (typeof method !== "string") {
        return {
          ok: false,
          error: { code: "invalidRequest", message: "method must be a string" },
        };
      }
      if (!supervisor) {
        return {
          ok: false,
          error: {
            code: "engineDown",
            message: "engine supervisor not started",
          },
        };
      }
      try {
        const result = await supervisor.request(method, params ?? {});
        return { ok: true, result };
      } catch (error) {
        if (error instanceof EngineRpcError) {
          return {
            ok: false,
            error: { code: error.code, message: error.message },
          };
        }
        const message =
          error instanceof Error ? error.message : "unknown error";
        return { ok: false, error: { code: "internal", message } };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.statusGet, () => {
    return (
      supervisor?.status() ?? {
        state: "down",
        restarts: 0,
        lastError: "not started",
      }
    );
  });

  ipcMain.handle(IPC_CHANNELS.relaunch, () => {
    return (
      supervisor?.relaunch() ?? {
        state: "down",
        restarts: 0,
        lastError: "not started",
      }
    );
  });

  // E2E seam on every dialog channel: native dialogs cannot be driven by
  // automation, so an env var can stand in for the user's pick.
  async function openFileDialog(
    seamEnv: string,
    title: string,
    filters: Electron.FileFilter[],
  ): Promise<string | null> {
    const fake = process.env[seamEnv];
    if (fake && fake.trim().length > 0) {
      return fake;
    }
    const result = await dialog.showOpenDialog({
      title,
      properties: ["openFile"],
      filters,
    });
    return result.canceled || result.filePaths.length === 0
      ? null
      : (result.filePaths[0] ?? null);
  }

  async function saveFileDialog(
    seamEnv: string,
    title: string,
    filters: Electron.FileFilter[],
    defaultName: unknown,
  ): Promise<string | null> {
    const fake = process.env[seamEnv];
    if (fake && fake.trim().length > 0) {
      return fake;
    }
    const options: Electron.SaveDialogOptions = { title, filters };
    if (typeof defaultName === "string" && defaultName.length > 0) {
      options.defaultPath = defaultName;
    }
    const result = await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  const TM_FILTERS: Electron.FileFilter[] = [
    { name: "翻译记忆（TMX/CSV/TSV）", extensions: ["tmx", "csv", "tsv"] },
  ];
  const TERMBASE_FILTERS: Electron.FileFilter[] = [
    { name: "术语库（CSV/TSV/TBX）", extensions: ["csv", "tsv", "tbx"] },
  ];
  const SRX_FILTERS: Electron.FileFilter[] = [
    { name: "SRX 分段规则", extensions: ["srx"] },
  ];

  ipcMain.handle(IPC_CHANNELS.chooseSource, () =>
    openFileDialog("TL_FAKE_OPEN_PATH", "选择要导入的文档", [
      {
        name: "可翻译文档",
        extensions: [
          "docx",
          "txt",
          "md",
          "html",
          "xlf",
          "xliff",
          "xlsx",
          "pptx",
        ],
      },
    ]),
  );

  ipcMain.handle(IPC_CHANNELS.chooseExport, (_event, defaultName: unknown) => {
    // The document save dialog keeps its historical no-filter behavior: the
    // export format follows the source document, not a picked extension.
    return saveFileDialog("TL_FAKE_SAVE_PATH", "选择导出位置", [], defaultName);
  });

  ipcMain.handle(IPC_CHANNELS.chooseTmImport, () =>
    openFileDialog(
      "TL_FAKE_TM_OPEN_PATH",
      "选择要导入的翻译记忆文件",
      TM_FILTERS,
    ),
  );

  ipcMain.handle(IPC_CHANNELS.chooseTmExport, (_event, defaultName: unknown) =>
    saveFileDialog(
      "TL_FAKE_TM_SAVE_PATH",
      "选择 TM 导出位置",
      TM_FILTERS,
      defaultName,
    ),
  );

  ipcMain.handle(IPC_CHANNELS.chooseTermbaseImport, () =>
    openFileDialog(
      "TL_FAKE_TERM_OPEN_PATH",
      "选择要导入的术语库文件",
      TERMBASE_FILTERS,
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.chooseTermbaseExport,
    (_event, defaultName: unknown) =>
      saveFileDialog(
        "TL_FAKE_TERM_SAVE_PATH",
        "选择术语库导出位置",
        TERMBASE_FILTERS,
        defaultName,
      ),
  );

  ipcMain.handle(IPC_CHANNELS.chooseSrx, () =>
    openFileDialog("TL_FAKE_SRX_PATH", "选择 SRX 分段规则文件", SRX_FILTERS),
  );

  // Layout preview: run the real export pipeline against a temp path and
  // hand the DOCX bytes to the renderer. The temp dir is always cleaned up;
  // the engine refuses pre-existing paths, so each call gets a fresh dir.
  ipcMain.handle(
    IPC_CHANNELS.previewDocx,
    async (_event, documentId: unknown): Promise<DocxPreviewResponse> => {
      if (typeof documentId !== "string" || documentId.length === 0) {
        return {
          ok: false,
          error: {
            code: "invalidRequest",
            message: "documentId must be a non-empty string",
          },
        };
      }
      if (!supervisor) {
        return {
          ok: false,
          error: {
            code: "engineDown",
            message: "engine supervisor not started",
          },
        };
      }
      const previewDir = await mkdtemp(join(tmpdir(), "tl-preview-"));
      const outputPath = join(previewDir, "preview.docx");
      try {
        const result = (await supervisor.request("document.export", {
          documentId,
          outputPath,
        })) as { translatedSegments?: unknown };
        const bytes = await readFile(outputPath);
        // Copy into a plain ArrayBuffer so structured clone over IPC is
        // exact-sized (a Buffer view can sit inside a larger pool).
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const data = copy.buffer;
        return {
          ok: true,
          data,
          translatedSegments:
            typeof result.translatedSegments === "number"
              ? result.translatedSegments
              : 0,
        };
      } catch (error) {
        if (error instanceof EngineRpcError) {
          return {
            ok: false,
            error: { code: error.code, message: error.message },
          };
        }
        const message =
          error instanceof Error ? error.message : "unknown error";
        return { ok: false, error: { code: "internal", message } };
      } finally {
        await rm(previewDir, { recursive: true, force: true });
      }
    },
  );
}

void app.whenReady().then(() => {
  supervisor = new EngineSupervisor({
    binaryPath: resolveEngineBinary(),
    dataDir: resolveDataDir(),
    clientVersion: app.getVersion(),
    onNotification: (notification) =>
      broadcast(IPC_CHANNELS.notification, notification),
    onStatus: (status) => broadcast(IPC_CHANNELS.statusEvent, status),
  });
  supervisor.start();
  registerIpc();
  installApplicationMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  supervisor?.stop();
});
