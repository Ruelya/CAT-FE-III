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

  ipcMain.handle(IPC_CHANNELS.chooseSource, async () => {
    // E2E seam: native dialogs cannot be driven by automation.
    const fakeOpen = process.env.TL_FAKE_OPEN_PATH;
    if (fakeOpen && fakeOpen.trim().length > 0) {
      return fakeOpen;
    }
    const result = await dialog.showOpenDialog({
      title: "选择要导入的文档",
      properties: ["openFile"],
      filters: [
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
      ],
    });
    return result.canceled || result.filePaths.length === 0
      ? null
      : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(
    IPC_CHANNELS.chooseExport,
    async (_event, defaultName: unknown) => {
      const fakeSave = process.env.TL_FAKE_SAVE_PATH;
      if (fakeSave && fakeSave.trim().length > 0) {
        return fakeSave;
      }
      const options: Electron.SaveDialogOptions = { title: "选择导出位置" };
      if (typeof defaultName === "string" && defaultName.length > 0) {
        options.defaultPath = defaultName;
      }
      const result = await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
  );

  ipcMain.handle(IPC_CHANNELS.chooseTm, async () => {
    // E2E seam, same rationale as TL_FAKE_OPEN_PATH.
    const fakeTm = process.env.TL_FAKE_TM_PATH;
    if (fakeTm && fakeTm.trim().length > 0) {
      return fakeTm;
    }
    const result = await dialog.showOpenDialog({
      title: "选择要导入的翻译记忆文件",
      properties: ["openFile"],
      filters: [{ name: "翻译记忆", extensions: ["tmx", "csv", "tsv"] }],
    });
    return result.canceled || result.filePaths.length === 0
      ? null
      : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.chooseTerm, async () => {
    const fakeTerm = process.env.TL_FAKE_TERM_PATH;
    if (fakeTerm && fakeTerm.trim().length > 0) {
      return fakeTerm;
    }
    const result = await dialog.showOpenDialog({
      title: "选择要导入的术语文件",
      properties: ["openFile"],
      filters: [{ name: "术语表", extensions: ["csv", "tsv", "tbx"] }],
    });
    return result.canceled || result.filePaths.length === 0
      ? null
      : (result.filePaths[0] ?? null);
  });

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
