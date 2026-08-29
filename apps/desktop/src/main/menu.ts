/**
 * Application menu wiring: builds the (pure) template against the renderer-
 * reported context and rebuilds it whenever that context changes, so item
 * enablement honestly tracks whether a project/document is open.
 *
 * The same template serves two surfaces. It is always installed as the
 * application menu — that keeps every menu-owned accelerator registered —
 * and on hosts with the integrated titlebar the renderer's menu buttons pop
 * the matching top-level submenu through IPC_CHANNELS.menuPopup, so both
 * surfaces stay one template.
 */

import { BrowserWindow, Menu, app, ipcMain } from "electron";

import { IPC_CHANNELS } from "../shared/desktop-api.js";
import type {
  MenuCommand,
  MenuContext,
  SegmentMenuContext,
} from "../shared/desktop-api.js";
import {
  buildMenuTemplate,
  buildSegmentContextMenu,
  menuBarSubmenu,
} from "./menu-template.js";

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

function normalizeSegmentMenuContext(raw: unknown): SegmentMenuContext {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    locked: record.locked === true,
    emptyTarget: record.emptyTarget === true,
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

  // Titlebar menu buttons: pop the named top-level submenu below the button.
  // The promise resolves when the menu closes, so the renderer can hold the
  // button's open state exactly as long as the native menu is up.
  ipcMain.handle(
    IPC_CHANNELS.menuPopup,
    (event, menuId: unknown, x: unknown, y: unknown): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const submenu =
        typeof menuId === "string"
          ? menuBarSubmenu(
              {
                platform: process.platform,
                appName: app.name,
                context,
                onCommand: dispatch,
              },
              menuId,
            )
          : null;
      if (!window || !submenu) {
        return Promise.resolve();
      }
      const menu = Menu.buildFromTemplate(submenu);
      return new Promise((resolve) => {
        menu.popup({
          window,
          x: typeof x === "number" && Number.isFinite(x) ? Math.round(x) : 0,
          y: typeof y === "number" && Number.isFinite(y) ? Math.round(y) : 0,
          callback: resolve,
        });
      });
    },
  );

  // Grid row menu: the three existing translate commands, enabled for
  // this row. Same dispatch path as the application menu.
  ipcMain.handle(
    IPC_CHANNELS.menuSegmentPopup,
    (event, x: unknown, y: unknown, raw: unknown): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return Promise.resolve();
      }
      const menu = Menu.buildFromTemplate(
        buildSegmentContextMenu({
          onCommand: dispatch,
          context: normalizeSegmentMenuContext(raw),
        }),
      );
      return new Promise((resolve) => {
        menu.popup({
          window,
          x: typeof x === "number" && Number.isFinite(x) ? Math.round(x) : 0,
          y: typeof y === "number" && Number.isFinite(y) ? Math.round(y) : 0,
          callback: resolve,
        });
      });
    },
  );

  rebuild();
}
