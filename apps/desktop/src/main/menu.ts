/**
 * Application menu wiring: builds the (pure) template against the renderer-
 * reported context and rebuilds it whenever that context changes, so item
 * enablement honestly tracks whether a project/document is open.
 */

import { BrowserWindow, Menu, app, ipcMain } from "electron";

import { IPC_CHANNELS } from "../shared/desktop-api.js";
import type { MenuCommand, MenuContext } from "../shared/desktop-api.js";
import { buildMenuTemplate } from "./menu-template.js";

/** The renderer payload crosses a trust boundary; coerce to plain booleans. */
function normalizeContext(raw: unknown): MenuContext {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    projectOpen: record.projectOpen === true,
    documentOpen: record.documentOpen === true,
    exportGate: record.exportGate === true,
  };
}

export function installApplicationMenu(): void {
  let context: MenuContext = {
    projectOpen: false,
    documentOpen: false,
    exportGate: false,
  };

  const dispatch = (command: MenuCommand): void => {
    const target =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    target?.webContents.send(IPC_CHANNELS.menuCommand, command);
  };

  const rebuild = (): void => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildMenuTemplate({
          platform: process.platform,
          appName: app.name,
          context,
          onCommand: dispatch,
        }),
      ),
    );
  };

  ipcMain.on(IPC_CHANNELS.menuContext, (_event, raw: unknown) => {
    const next = normalizeContext(raw);
    if (
      next.projectOpen === context.projectOpen &&
      next.documentOpen === context.documentOpen &&
      next.exportGate === context.exportGate
    ) {
      return;
    }
    context = next;
    rebuild();
  });

  rebuild();
}
