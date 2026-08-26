/**
 * Pure construction of the application menu template. No `electron` value
 * imports so the template (labels, accelerators, enablement, command
 * dispatch) is unit-testable outside an Electron main process; the wiring
 * lives in `menu.ts`.
 *
 * Keymap ownership rule (spec: editor/workbench chords are renderer-owned,
 * main must not swallow them):
 * - Chords the renderer already listens for (F3 concordance, F4/Shift+F4
 *   find next/prev, Ctrl+Enter confirm) and workbench-interaction chords
 *   (Ctrl+F filter) are displayed
 *   in the menu but NOT registered as global accelerators on Windows/Linux
 *   (`registerAccelerator: false`), so the raw key events keep reaching the
 *   renderer keymap. Clicking the item dispatches the same command over IPC.
 * - App-level commands with no prior binding (import/export/preview/
 *   settings/dock tabs) get their accelerator from the menu itself, which
 *   is their single owner.
 */

import type { MenuItemConstructorOptions } from "electron";

import type { MenuCommand, MenuContext } from "../shared/desktop-api.js";

export interface MenuTemplateOptions {
  platform: NodeJS.Platform;
  appName: string;
  context: MenuContext;
  onCommand: (command: MenuCommand) => void;
}

/** Accelerators owned by renderer keydown handlers, never by the menu. */
export const RENDERER_OWNED_ACCELERATORS: readonly string[] = [
  "F3",
  "F4",
  "Shift+F4",
  "CmdOrCtrl+Enter",
  "CmdOrCtrl+Alt+Enter",
  "CmdOrCtrl+Alt+Shift+Enter",
  "CmdOrCtrl+F",
  "CmdOrCtrl+H",
  "CmdOrCtrl+Shift+P",
];

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

export function buildMenuTemplate(
  options: MenuTemplateOptions,
): MenuItemConstructorOptions[] {
  const { platform, appName, context, onCommand } = options;
  const isMac = platform === "darwin";

  const commandItem = (
    label: string,
    command: MenuCommand,
    enabled: boolean,
    accelerator?: string,
    rendererOwned = false,
  ): MenuItemConstructorOptions => ({
    label,
    enabled,
    ...(accelerator ? { accelerator } : {}),
    ...(rendererOwned ? { registerAccelerator: false } : {}),
    click: () => onCommand(command),
  });

  const fileMenu: MenuItemConstructorOptions = {
    label: "文件",
    submenu: [
      commandItem(
        "导入文档…",
        "import-document",
        context.projectOpen,
        "CmdOrCtrl+O",
      ),
      commandItem(
        "导出译文…",
        "export-document",
        context.documentOpen,
        "CmdOrCtrl+E",
      ),
      SEPARATOR,
      commandItem(
        "项目设置…",
        "open-project-settings",
        context.projectOpen,
        "CmdOrCtrl+,",
      ),
      commandItem("返回项目列表", "close-project", context.projectOpen),
      ...(isMac ? [] : [SEPARATOR, { role: "quit", label: "退出" } as const]),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "编辑",
    submenu: [
      { role: "undo", label: "撤销" },
      { role: "redo", label: "重做" },
      SEPARATOR,
      { role: "cut", label: "剪切" },
      { role: "copy", label: "复制" },
      { role: "paste", label: "粘贴" },
      { role: "selectAll", label: "全选" },
      SEPARATOR,
      // Studio confirm chord family. Same commands as the grid editor's
      // chords; display-only accelerators so the textarea handler stays
      // the owner. All three run the same segment.confirm — only the
      // navigation afterwards differs.
      commandItem(
        "确认当前句段",
        "confirm-segment",
        context.documentOpen,
        "CmdOrCtrl+Enter",
        true,
      ),
      commandItem(
        "确认并到下一句段",
        "confirm-segment-any",
        context.documentOpen,
        "CmdOrCtrl+Alt+Enter",
        true,
      ),
      commandItem(
        "确认并停留",
        "confirm-segment-stay",
        context.documentOpen,
        "CmdOrCtrl+Alt+Shift+Enter",
        true,
      ),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "视图",
    submenu: [
      // Renderer-owned Ctrl+Shift+P (with Ctrl+K as a synonym chord the
      // renderer also listens for) summons the command palette.
      commandItem(
        "命令面板",
        "open-command-palette",
        context.projectOpen,
        "CmdOrCtrl+Shift+P",
        true,
      ),
      SEPARATOR,
      commandItem(
        "译文预览…",
        "open-preview",
        context.documentOpen,
        "CmdOrCtrl+P",
      ),
      SEPARATOR,
      commandItem(
        "翻译记忆面板",
        "show-dock-tm",
        context.projectOpen,
        "CmdOrCtrl+1",
      ),
      commandItem(
        "术语面板",
        "show-dock-term",
        context.projectOpen,
        "CmdOrCtrl+2",
      ),
      commandItem(
        "检索面板",
        "show-dock-concordance",
        context.projectOpen,
        "CmdOrCtrl+3",
      ),
      commandItem(
        "QA 面板",
        "show-dock-qa",
        context.projectOpen,
        "CmdOrCtrl+4",
      ),
      commandItem(
        "AI 辅助面板",
        "show-dock-ai",
        context.projectOpen,
        "CmdOrCtrl+5",
      ),
      commandItem(
        "Agent 面板",
        "show-dock-agent",
        context.projectOpen,
        "CmdOrCtrl+6",
      ),
      SEPARATOR,
      { role: "resetZoom", label: "实际大小" },
      { role: "zoomIn", label: "放大" },
      { role: "zoomOut", label: "缩小" },
      SEPARATOR,
      { role: "togglefullscreen", label: "切换全屏" },
    ],
  };

  const navigationMenu: MenuItemConstructorOptions = {
    label: "导航",
    submenu: [
      // Renderer-owned Ctrl+F focuses the grid filter input.
      commandItem(
        "筛选句段",
        "focus-filter",
        context.documentOpen,
        "CmdOrCtrl+F",
        true,
      ),
      // Renderer-owned F4 / Shift+F4 jump the selection through segments
      // matching the find box query without hiding any rows.
      commandItem("查找下一个", "find-next", context.documentOpen, "F4", true),
      commandItem(
        "查找上一个",
        "find-prev",
        context.documentOpen,
        "Shift+F4",
        true,
      ),
      // Renderer-owned Ctrl+H focuses the replace box in the find/replace
      // toolbar; the actual replace stays a button/Enter action there.
      commandItem(
        "替换…",
        "focus-replace",
        context.documentOpen,
        "CmdOrCtrl+H",
        true,
      ),
      // Renderer-owned F3 seeds concordance from the current selection.
      commandItem(
        "检索（取选中文本）",
        "open-concordance",
        context.projectOpen,
        "F3",
        true,
      ),
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: "帮助",
    submenu: [
      { role: "reload", label: "重新加载窗口" },
      { role: "toggleDevTools", label: "开发者工具" },
    ],
  };

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: "about" },
      SEPARATOR,
      { role: "quit", label: `退出 ${appName}` },
    ],
  };

  return [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    navigationMenu,
    helpMenu,
  ];
}
