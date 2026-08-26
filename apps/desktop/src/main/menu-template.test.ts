import { describe, expect, it, vi } from "vitest";

import type { MenuItemConstructorOptions } from "electron";

import type { MenuCommand, MenuContext } from "../shared/desktop-api.js";
import {
  RENDERER_OWNED_ACCELERATORS,
  buildMenuTemplate,
} from "./menu-template.js";
import type { MenuTemplateOptions } from "./menu-template.js";

/**
 * The menu's keymap contract: every command item, which accelerator it
 * shows, whether the renderer owns that chord (accelerator display-only on
 * Windows/Linux), and what state it needs to be enabled. This mirrors the
 * workbench: F3 / F4 / Shift+F4 / Ctrl+Enter / Ctrl+F are renderer keydown
 * handlers; the remaining accelerators have no prior binding and are
 * menu-owned.
 */
const COMMAND_ITEMS: Array<{
  label: string;
  command: MenuCommand;
  accelerator?: string;
  rendererOwned?: boolean;
  needs: "project" | "document";
}> = [
  {
    label: "导入文档…",
    command: "import-document",
    accelerator: "CmdOrCtrl+O",
    needs: "project",
  },
  {
    label: "导出译文…",
    command: "export-document",
    accelerator: "CmdOrCtrl+E",
    needs: "document",
  },
  {
    label: "项目设置…",
    command: "open-project-settings",
    accelerator: "CmdOrCtrl+,",
    needs: "project",
  },
  { label: "返回项目列表", command: "close-project", needs: "project" },
  {
    label: "确认当前句段",
    command: "confirm-segment",
    accelerator: "CmdOrCtrl+Enter",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "确认并到下一句段",
    command: "confirm-segment-any",
    accelerator: "CmdOrCtrl+Alt+Enter",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "确认并停留",
    command: "confirm-segment-stay",
    accelerator: "CmdOrCtrl+Alt+Shift+Enter",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "命令面板",
    command: "open-command-palette",
    accelerator: "CmdOrCtrl+Shift+P",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "译文预览…",
    command: "open-preview",
    accelerator: "CmdOrCtrl+P",
    needs: "document",
  },
  {
    label: "记忆面板",
    command: "show-dock-memory",
    accelerator: "CmdOrCtrl+1",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "术语面板",
    command: "show-dock-term",
    accelerator: "CmdOrCtrl+2",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "QA 面板",
    command: "show-dock-qa",
    accelerator: "CmdOrCtrl+3",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "AI 面板",
    command: "show-dock-ai",
    accelerator: "CmdOrCtrl+4",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "查找…",
    command: "open-find",
    accelerator: "CmdOrCtrl+F",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "替换…",
    command: "open-replace",
    accelerator: "CmdOrCtrl+H",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "查找下一个",
    command: "find-next",
    accelerator: "F4",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "查找上一个",
    command: "find-prev",
    accelerator: "Shift+F4",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "筛选句段",
    command: "focus-filter",
    accelerator: "CmdOrCtrl+Shift+F",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "检索（取选中文本）",
    command: "open-concordance",
    accelerator: "F3",
    rendererOwned: true,
    needs: "project",
  },
];

function build(
  context: MenuContext,
  overrides: Partial<MenuTemplateOptions> = {},
): {
  template: MenuItemConstructorOptions[];
  onCommand: ReturnType<typeof vi.fn>;
} {
  const onCommand = vi.fn();
  const template = buildMenuTemplate({
    platform: "linux",
    appName: "Translunar CAT",
    context,
    onCommand,
    ...overrides,
  });
  return { template, onCommand };
}

function flatten(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const all: MenuItemConstructorOptions[] = [];
  const walk = (items: MenuItemConstructorOptions[]) => {
    for (const item of items) {
      all.push(item);
      if (Array.isArray(item.submenu)) {
        walk(item.submenu);
      }
    }
  };
  walk(template);
  return all;
}

function findItem(
  template: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions {
  const item = flatten(template).find((entry) => entry.label === label);
  if (!item) {
    throw new Error(`menu item not found: ${label}`);
  }
  return item;
}

function click(item: MenuItemConstructorOptions): void {
  (item.click as unknown as () => void)();
}

const NO_PROJECT: MenuContext = { projectOpen: false, documentOpen: false };
const PROJECT_ONLY: MenuContext = { projectOpen: true, documentOpen: false };
const DOCUMENT_OPEN: MenuContext = { projectOpen: true, documentOpen: true };

describe("buildMenuTemplate structure", () => {
  it("lays out 文件/编辑/视图/导航/帮助 on Linux and Windows", () => {
    for (const platform of ["linux", "win32"] as const) {
      const { template } = build(NO_PROJECT, { platform });
      expect(template.map((item) => item.label)).toEqual([
        "文件",
        "编辑",
        "视图",
        "导航",
        "帮助",
      ]);
    }
  });

  it("prepends the app menu on macOS and moves quit out of 文件", () => {
    const { template } = build(NO_PROJECT, { platform: "darwin" });
    expect(template[0]?.label).toBe("Translunar CAT");
    const fileMenu = findItem(template, "文件");
    const fileRoles = (fileMenu.submenu as MenuItemConstructorOptions[]).map(
      (item) => item.role,
    );
    expect(fileRoles).not.toContain("quit");
    const appMenu = template[0]?.submenu as MenuItemConstructorOptions[];
    expect(appMenu.some((item) => item.role === "quit")).toBe(true);
  });

  it("keeps the standard edit roles and app-level roles available", () => {
    const { template } = build(NO_PROJECT);
    const roles = flatten(template)
      .map((item) => item.role)
      .filter(Boolean);
    for (const role of [
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
      "quit",
      "reload",
      "toggleDevTools",
      "togglefullscreen",
    ]) {
      expect(roles).toContain(role);
    }
  });
});

describe("buildMenuTemplate honesty (enablement)", () => {
  it("disables every workbench command when no project is open", () => {
    const { template } = build(NO_PROJECT);
    for (const spec of COMMAND_ITEMS) {
      expect(findItem(template, spec.label).enabled, spec.label).toBe(false);
    }
  });

  it("enables project-level commands but not document-level ones without a document", () => {
    const { template } = build(PROJECT_ONLY);
    for (const spec of COMMAND_ITEMS) {
      expect(findItem(template, spec.label).enabled, spec.label).toBe(
        spec.needs === "project",
      );
    }
  });

  it("enables everything once a document is open", () => {
    const { template } = build(DOCUMENT_OPEN);
    for (const spec of COMMAND_ITEMS) {
      expect(findItem(template, spec.label).enabled, spec.label).toBe(true);
    }
  });

  it("never disables role items (edit/zoom/quit stay usable)", () => {
    const { template } = build(NO_PROJECT);
    for (const item of flatten(template)) {
      if (item.role) {
        expect(item.enabled, String(item.role)).not.toBe(false);
      }
    }
  });
});

describe("buildMenuTemplate command dispatch", () => {
  it("clicking each command item dispatches exactly that command", () => {
    const { template, onCommand } = build(DOCUMENT_OPEN);
    for (const spec of COMMAND_ITEMS) {
      onCommand.mockClear();
      click(findItem(template, spec.label));
      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(onCommand).toHaveBeenCalledWith(spec.command);
    }
  });
});

describe("buildMenuTemplate keymap (single owner per chord)", () => {
  it("shows the workbench accelerators exactly as specified", () => {
    const { template } = build(DOCUMENT_OPEN);
    for (const spec of COMMAND_ITEMS) {
      expect(findItem(template, spec.label).accelerator, spec.label).toBe(
        spec.accelerator,
      );
    }
  });

  it("displays renderer-owned chords without registering them", () => {
    const { template } = build(DOCUMENT_OPEN);
    for (const spec of COMMAND_ITEMS.filter((entry) => entry.rendererOwned)) {
      const item = findItem(template, spec.label);
      expect(item.registerAccelerator, spec.label).toBe(false);
      expect(RENDERER_OWNED_ACCELERATORS).toContain(spec.accelerator);
    }
  });

  it("never registers a menu accelerator over a renderer-owned chord", () => {
    const { template } = build(DOCUMENT_OPEN);
    for (const item of flatten(template)) {
      if (item.accelerator && item.registerAccelerator !== false) {
        expect(
          RENDERER_OWNED_ACCELERATORS,
          `${String(item.label)} must not swallow ${item.accelerator}`,
        ).not.toContain(item.accelerator);
      }
    }
  });

  it("assigns each accelerator to exactly one menu item", () => {
    const { template } = build(DOCUMENT_OPEN);
    const accelerators = flatten(template)
      .map((item) => item.accelerator)
      .filter((accelerator): accelerator is string => Boolean(accelerator));
    expect(new Set(accelerators).size).toBe(accelerators.length);
  });
});
