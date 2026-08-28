import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { ProjectSettingsDialog } from "./ProjectSettingsDialog.js";

const project: Project = {
  id: "p1",
  name: "演示项目",
  sourceLocale: "en-US",
  targetLocale: "zh-CN",
  domain: "general",
  lifecycle: "active",
  revision: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
  configuration: {},
};

function termbase(id: string, name: string) {
  return {
    id,
    name,
    sourceLocale: "en-US",
    domain: null,
    writable: true,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function mount(
  termbaseId: string,
  overrides: Partial<{
    priority: number;
    enabled: boolean;
    writable: boolean;
  }> = {},
) {
  return {
    projectId: "p1",
    termbaseId,
    priority: 0,
    enabled: true,
    writable: true,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

interface BridgePickers {
  tmImport?: string | null;
  tmExport?: string | null;
  termbaseImport?: string | null;
  termbaseExport?: string | null;
  srx?: string | null;
}

function tmMemory(id: string, name: string) {
  return {
    id,
    name,
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function tmMount(memoryId: string, priority: number, writable: boolean) {
  return {
    projectId: "p1",
    memoryId,
    priority,
    enabled: true,
    writable,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

/** One writable working memory — the shape every real project starts with. */
const DEFAULT_MEMORY_LIST = {
  memories: [tmMemory("tm-p1", "主记忆库")],
  mounts: [tmMount("tm-p1", 0, true)],
};

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
  pickers: BridgePickers = {},
  memoryList: typeof DEFAULT_MEMORY_LIST = DEFAULT_MEMORY_LIST,
) {
  // memory.list feeds the TM import/export picker; serve it here so every
  // test's engine mock keeps focusing on the calls it actually asserts.
  const wrapped = (
    method: string,
    params: unknown,
  ): Promise<EngineInvokeResponse> =>
    method === "memory.list"
      ? Promise.resolve({ ok: true, result: memoryList })
      : invoke(method, params);
  const bridge = {
    invoke: vi.fn(wrapped),
    chooseTmImportFile: vi.fn(() => Promise.resolve(pickers.tmImport ?? null)),
    chooseTmExportPath: vi.fn(() => Promise.resolve(pickers.tmExport ?? null)),
    chooseTermbaseImportFile: vi.fn(() =>
      Promise.resolve(pickers.termbaseImport ?? null),
    ),
    chooseTermbaseExportPath: vi.fn(() =>
      Promise.resolve(pickers.termbaseExport ?? null),
    ),
    chooseSrxFile: vi.fn(() => Promise.resolve(pickers.srx ?? null)),
  };
  const api: Partial<DesktopApi> = bridge;
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return bridge;
}

describe("ProjectSettingsDialog", () => {
  beforeEach(() => {
    installBridge(() =>
      Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      }),
    );
  });

  it("saves name and language pair through project.update", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "project.update") {
        return Promise.resolve({
          ok: true,
          result: {
            ...project,
            name: "改名项目",
            sourceLocale: "de-DE",
            targetLocale: "fr-FR",
            revision: 2,
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    const onProjectUpdated = vi.fn();
    render(
      <ProjectSettingsDialog
        open
        project={project}
        onClose={vi.fn()}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    await userEvent.clear(screen.getByLabelText("项目名称"));
    await userEvent.type(screen.getByLabelText("项目名称"), "改名项目");
    await userEvent.clear(screen.getByLabelText("源语言"));
    await userEvent.type(screen.getByLabelText("源语言"), "de-DE");
    await userEvent.clear(screen.getByLabelText("目标语言"));
    await userEvent.type(screen.getByLabelText("目标语言"), "fr-FR");
    await userEvent.click(screen.getByRole("button", { name: "保存项目信息" }));
    await waitFor(() => {
      expect(
        screen.getByText(/项目设置已保存：改名项目（de-DE → fr-FR）/),
      ).toBeInTheDocument();
    });
    const updateCall = calls.find(([method]) => method === "project.update");
    expect(updateCall?.[1]).toEqual({
      projectId: "p1",
      name: "改名项目",
      sourceLocale: "de-DE",
      targetLocale: "fr-FR",
    });
    expect(onProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ name: "改名项目", revision: 2 }),
    );
  });

  it("blocks saving while a required project field is empty", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText("项目名称"));
    expect(screen.getByRole("button", { name: "保存项目信息" })).toBeDisabled();
    expect(calls.some(([method]) => method === "project.update")).toBe(false);
  });

  it("surfaces the engine conflict when the language pair is pinned", async () => {
    installBridge((method) => {
      if (method === "project.update") {
        return Promise.resolve({
          ok: false,
          error: {
            code: "conflict",
            message:
              "cannot change the language pair: the project already has 1 imported document(s); export or remove them first",
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    const onProjectUpdated = vi.fn();
    render(
      <ProjectSettingsDialog
        open
        project={project}
        onClose={vi.fn()}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    await userEvent.clear(screen.getByLabelText("目标语言"));
    await userEvent.type(screen.getByLabelText("目标语言"), "fr-FR");
    await userEvent.click(screen.getByRole("button", { name: "保存项目信息" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "cannot change the language pair",
      );
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onProjectUpdated).not.toHaveBeenCalled();
  });

  it("shows the stored import defaults and disables SRX in paragraph mode", async () => {
    installBridge(() =>
      Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      }),
    );
    render(
      <ProjectSettingsDialog
        open
        project={{
          ...project,
          configuration: {
            segmentation: "sentence",
            srxPath: "/tmp/stored-rules.srx",
          },
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("默认分段方式")).toHaveValue("sentence");
    expect(screen.getByText("stored-rules.srx")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "选择默认 SRX 规则…" }),
    ).toBeEnabled();

    // Paragraph mode never applies SRX rules, so the picker locks; the
    // stored ruleset stays visible because saving keeps it for a switch
    // back to sentence mode.
    await userEvent.selectOptions(
      screen.getByLabelText("默认分段方式"),
      "paragraph",
    );
    expect(
      screen.getByRole("button", { name: "选择默认 SRX 规则…" }),
    ).toBeDisabled();
    expect(screen.getByText("stored-rules.srx")).toBeInTheDocument();
  });

  it("saves sentence import defaults with a picked SRX ruleset", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "project.update") {
          return Promise.resolve({
            ok: true,
            result: {
              ...project,
              revision: 2,
              configuration: {
                segmentation: "sentence",
                srxPath: "/tmp/rules.srx",
              },
            },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { srx: "/tmp/rules.srx" },
    );
    const onProjectUpdated = vi.fn();
    render(
      <ProjectSettingsDialog
        open
        project={project}
        onClose={vi.fn()}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "选择默认 SRX 规则…" }),
    );
    expect(await screen.findByText("rules.srx")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存导入默认" }));
    await waitFor(() => {
      expect(
        screen.getByText(/导入默认已保存：句子分段（SRX：rules.srx）/),
      ).toBeInTheDocument();
    });
    const updateCall = calls.find(([method]) => method === "project.update");
    expect(updateCall?.[1]).toEqual({
      projectId: "p1",
      segmentation: "sentence",
      srxPath: "/tmp/rules.srx",
    });
    expect(onProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2 }),
    );
  });

  it("clears the stored SRX default through clearSrxPath", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "project.update") {
        return Promise.resolve({
          ok: true,
          result: {
            ...project,
            revision: 2,
            configuration: { segmentation: "sentence", srxPath: null },
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(
      <ProjectSettingsDialog
        open
        project={{
          ...project,
          configuration: {
            segmentation: "sentence",
            srxPath: "/tmp/stored-rules.srx",
          },
        }}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(screen.getByText(/内置规则（en-US）/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存导入默认" }));
    await waitFor(() => {
      expect(
        screen.getByText(/导入默认已保存：句子分段（内置 SRX 规则）/),
      ).toBeInTheDocument();
    });
    const updateCall = calls.find(([method]) => method === "project.update");
    expect(updateCall?.[1]).toEqual({
      projectId: "p1",
      segmentation: "sentence",
      clearSrxPath: true,
    });
  });

  it("saves a paragraph default without touching the stored SRX", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "project.update") {
        return Promise.resolve({
          ok: true,
          result: {
            ...project,
            revision: 2,
            configuration: {
              segmentation: "paragraph",
              srxPath: "/tmp/stored-rules.srx",
            },
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(
      <ProjectSettingsDialog
        open
        project={{
          ...project,
          configuration: {
            segmentation: "sentence",
            srxPath: "/tmp/stored-rules.srx",
          },
        }}
        onClose={vi.fn()}
      />,
    );
    await userEvent.selectOptions(
      screen.getByLabelText("默认分段方式"),
      "paragraph",
    );
    await userEvent.click(screen.getByRole("button", { name: "保存导入默认" }));
    await waitFor(() => {
      expect(screen.getByText(/导入默认已保存：段落分段/)).toBeInTheDocument();
    });
    const updateCall = calls.find(([method]) => method === "project.update");
    expect(updateCall?.[1]).toEqual({
      projectId: "p1",
      segmentation: "paragraph",
    });
  });

  it("surfaces an engine error from the import-defaults save", async () => {
    installBridge((method) => {
      if (method === "project.update") {
        return Promise.resolve({
          ok: false,
          error: {
            code: "invalidParams",
            message:
              "srxPath only applies while the segmentation default is sentence",
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "保存导入默认" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "srxPath only applies while the segmentation default is sentence",
      );
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("archives the project through project.archive", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "project.archive") {
        return Promise.resolve({
          ok: true,
          result: {
            ...project,
            lifecycle: "archived",
            archivedAtMs: 99,
            revision: 2,
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    const onProjectUpdated = vi.fn();
    render(
      <ProjectSettingsDialog
        open
        project={project}
        onClose={vi.fn()}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "归档项目" }));
    await waitFor(() => {
      expect(screen.getByText(/项目已归档/)).toBeInTheDocument();
    });
    const archiveCall = calls.find(([method]) => method === "project.archive");
    expect(archiveCall?.[1]).toEqual({ projectId: "p1", archived: true });
    expect(onProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle: "archived", archivedAtMs: 99 }),
    );
  });

  it("restores an archived project through project.archive", async () => {
    const archivedProject: Project = {
      ...project,
      lifecycle: "archived",
      archivedAtMs: 99,
    };
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "project.archive") {
        return Promise.resolve({
          ok: true,
          result: { ...project, revision: 3 },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(
      <ProjectSettingsDialog
        open
        project={archivedProject}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("已归档")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "恢复项目" }));
    await waitFor(() => {
      expect(screen.getByText(/项目已恢复为进行中/)).toBeInTheDocument();
    });
    const archiveCall = calls.find(([method]) => method === "project.archive");
    expect(archiveCall?.[1]).toEqual({ projectId: "p1", archived: false });
  });

  it("detaches a mounted termbase through termbase.detach", async () => {
    const calls: Array<[string, unknown]> = [];
    let detached = false;
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "termbase.detach") {
        detached = true;
        return Promise.resolve({
          ok: true,
          result: { mount: mount("tb1") },
        });
      }
      return Promise.resolve({
        ok: true,
        result: detached
          ? { termbases: [termbase("tb1", "产品术语")], mounts: [] }
          : {
              termbases: [termbase("tb1", "产品术语")],
              mounts: [mount("tb1")],
            },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("产品术语")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "卸载术语库 产品术语" }),
    );
    await waitFor(() => {
      expect(screen.getByText(/术语库「产品术语」已卸载/)).toBeInTheDocument();
    });
    const detachCall = calls.find(([method]) => method === "termbase.detach");
    expect(detachCall?.[1]).toEqual({ projectId: "p1", termbaseId: "tb1" });
    // After the refresh the termbase is listed as unmounted and can only be
    // re-attached, not exported through a mount row.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "挂载" })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "导出术语库 产品术语" }),
    ).not.toBeInTheDocument();
  });

  it("moves a termbase mount up through termbase.update priority", async () => {
    const calls: Array<[string, unknown]> = [];
    let moved = false;
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "termbase.update") {
        moved = true;
        return Promise.resolve({
          ok: true,
          result: {
            mounts: [
              mount("tb2", { priority: 0 }),
              mount("tb1", { priority: 1 }),
            ],
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: {
          termbases: [termbase("tb1", "产品术语"), termbase("tb2", "参考术语")],
          // termbase.list serves mounts in priority order, like the engine.
          mounts: moved
            ? [mount("tb2", { priority: 0 }), mount("tb1", { priority: 1 })]
            : [mount("tb1", { priority: 0 }), mount("tb2", { priority: 1 })],
        },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    // Priority order: the top row's 上移 and the bottom row's 下移 hold.
    const topUp = await screen.findByRole("button", {
      name: "上移术语库 产品术语",
    });
    expect(topUp).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "下移术语库 参考术语" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "上移术语库 参考术语" }),
    );
    const updateCall = calls.find(([method]) => method === "termbase.update");
    expect(updateCall?.[1]).toEqual({
      projectId: "p1",
      termbaseId: "tb2",
      priority: 0,
    });
    // The refetched order flips: the moved mount is now the top row.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "上移术语库 参考术语" }),
      ).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: "上移术语库 产品术语" }),
    ).toBeEnabled();
  });

  it("disables a termbase mount through termbase.update enabled", async () => {
    const calls: Array<[string, unknown]> = [];
    let disabled = false;
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "termbase.update") {
        disabled = true;
        return Promise.resolve({
          ok: true,
          result: { mounts: [mount("tb1", { enabled: false })] },
        });
      }
      return Promise.resolve({
        ok: true,
        result: {
          termbases: [termbase("tb1", "产品术语")],
          mounts: [mount("tb1", { enabled: !disabled })],
        },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "停用术语库 产品术语" }),
    );
    const updateCall = calls.find(([method]) => method === "termbase.update");
    expect(updateCall?.[1]).toEqual({
      projectId: "p1",
      termbaseId: "tb1",
      enabled: false,
    });
    // The refetched mount is disabled: the badge says so and the toggle
    // now offers 启用.
    await waitFor(() => {
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "启用术语库 产品术语" }),
    ).toBeInTheDocument();
  });

  it("flips the per-mount writable switch through termbase.update", async () => {
    const calls: Array<[string, unknown]> = [];
    let readOnly = false;
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "termbase.update") {
        readOnly = true;
        return Promise.resolve({
          ok: true,
          result: { mounts: [mount("tb1", { writable: false })] },
        });
      }
      return Promise.resolve({
        ok: true,
        result: {
          termbases: [termbase("tb1", "产品术语")],
          mounts: [mount("tb1", { writable: !readOnly })],
        },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "设为只读术语库 产品术语" }),
    );
    const updateCall = calls.find(([method]) => method === "termbase.update");
    expect(updateCall?.[1]).toEqual({
      projectId: "p1",
      termbaseId: "tb1",
      writable: false,
    });
    await waitFor(() => {
      expect(screen.getByText("只读")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "设为可写术语库 产品术语" }),
    ).toBeInTheDocument();
  });

  it("imports an external TM through the dedicated file channel", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "tm.import") {
          return Promise.resolve({
            ok: true,
            result: { imported: 5, added: 3, updated: 2 },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { tmImport: "/tmp/legacy.tmx" },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "导入外部 TM…" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          /外部 TM 导入完成（库「主记忆库」）：读取 5 条，新增 3，更新 2/,
        ),
      ).toBeInTheDocument();
    });
    // The destination memory is always explicit — the writable working
    // memory is the default pick, never an implicit fallback.
    const importCall = calls.find(([method]) => method === "tm.import");
    expect(importCall?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/legacy.tmx",
      memoryId: "tm-p1",
    });
  });

  it("does nothing when the TM file pick is canceled", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { tmImport: null },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "导入外部 TM…" }),
    );
    expect(calls.some(([method]) => method === "tm.import")).toBe(false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("surfaces tm.import engine errors instead of pretending", async () => {
    installBridge(
      (method) => {
        if (method === "tm.import") {
          return Promise.resolve({
            ok: false,
            error: { code: "notFound", message: "TM file /tmp/gone.tmx" },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { tmImport: "/tmp/gone.tmx" },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "导入外部 TM…" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "TM file /tmp/gone.tmx",
      );
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("exports the project TM to a picked path", async () => {
    const calls: Array<[string, unknown]> = [];
    const bridge = installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "tm.export") {
          return Promise.resolve({
            ok: true,
            result: { exported: 7, outputPath: "/tmp/out.tmx" },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { tmExport: "/tmp/out.tmx" },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "导出 TM…" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          /TM 导出完成（库「主记忆库」）：7 条 → \/tmp\/out.tmx/,
        ),
      ).toBeInTheDocument();
    });
    // The save dialog gets a sensible default filename derived from the
    // project name, so the picked path starts from something meaningful.
    expect(bridge.chooseTmExportPath).toHaveBeenCalledWith("演示项目-tm.tmx");
    const exportCall = calls.find(([method]) => method === "tm.export");
    expect(exportCall?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/out.tmx",
      memoryId: "tm-p1",
    });
  });

  /** Engine that blocks the plain export but honors an explicit overwrite. */
  function blockedTmExportBridge(calls: Array<[string, unknown]>) {
    return installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "tm.export") {
          if ((params as { overwrite?: boolean }).overwrite !== true) {
            return Promise.resolve({
              ok: false,
              error: {
                code: "exportBlocked",
                message: "output path already exists: /tmp/out.tmx",
              },
            });
          }
          return Promise.resolve({
            ok: true,
            result: { exported: 7, outputPath: "/tmp/out.tmx" },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { tmExport: "/tmp/out.tmx" },
    );
  }

  it("asks before overwriting a blocked TM export and retries with overwrite", async () => {
    const calls: Array<[string, unknown]> = [];
    blockedTmExportBridge(calls);
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "导出 TM…" }),
    );

    // The refusal surfaces as an explicit question, not an error alert.
    const prompt = await screen.findByRole("alertdialog", {
      name: "目标已存在，要覆盖吗？",
    });
    expect(prompt).toHaveTextContent("/tmp/out.tmx");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "覆盖" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          /TM 导出完成（已覆盖，库「主记忆库」）：7 条 → \/tmp\/out.tmx/,
        ),
      ).toBeInTheDocument();
    });
    // The retry hits the exact memory the refused call did.
    const exportCalls = calls.filter(([method]) => method === "tm.export");
    expect(exportCalls).toHaveLength(2);
    expect(exportCalls[0]?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/out.tmx",
      memoryId: "tm-p1",
    });
    expect(exportCalls[1]?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/out.tmx",
      memoryId: "tm-p1",
      overwrite: true,
    });
    expect(
      screen.queryByRole("alertdialog", { name: "目标已存在，要覆盖吗？" }),
    ).not.toBeInTheDocument();
  });

  it("取消 on a blocked TM export sends no overwrite call", async () => {
    const calls: Array<[string, unknown]> = [];
    blockedTmExportBridge(calls);
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "导出 TM…" }),
    );
    await screen.findByRole("alertdialog", {
      name: "目标已存在，要覆盖吗？",
    });

    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("alertdialog", { name: "目标已存在，要覆盖吗？" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("已取消导出")).toBeInTheDocument();
    // Only the refused no-clobber call ever reached the engine.
    expect(calls.filter(([method]) => method === "tm.export")).toHaveLength(1);
  });

  it("asks before overwriting a blocked termbase export too", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "termbase.export") {
          if ((params as { overwrite?: boolean }).overwrite !== true) {
            return Promise.resolve({
              ok: false,
              error: {
                code: "exportBlocked",
                message: "output path already exists: /tmp/terms.csv",
              },
            });
          }
          return Promise.resolve({
            ok: true,
            result: { exported: 6, outputPath: "/tmp/terms.csv" },
          });
        }
        return Promise.resolve({
          ok: true,
          result: {
            termbases: [termbase("tb1", "产品术语")],
            mounts: [mount("tb1")],
          },
        });
      },
      { termbaseExport: "/tmp/terms.csv" },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("产品术语")).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "导出术语库 产品术语" }),
    );
    await screen.findByRole("alertdialog", {
      name: "目标已存在，要覆盖吗？",
    });
    await userEvent.click(screen.getByRole("button", { name: "覆盖" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          /术语库「产品术语」导出完成（已覆盖）：6 条 → \/tmp\/terms.csv/,
        ),
      ).toBeInTheDocument();
    });
    const exportCalls = calls.filter(
      ([method]) => method === "termbase.export",
    );
    expect(exportCalls).toHaveLength(2);
    expect(exportCalls[1]?.[1]).toEqual({
      termbaseId: "tb1",
      path: "/tmp/terms.csv",
      overwrite: true,
    });
  });

  it("imports into and exports from an explicitly picked non-writable memory", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "tm.import") {
          return Promise.resolve({
            ok: true,
            result: { imported: 2, added: 2, updated: 0 },
          });
        }
        if (method === "tm.export") {
          return Promise.resolve({
            ok: true,
            result: { exported: 3, outputPath: "/tmp/ref.tmx" },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { tmImport: "/tmp/ref.tmx", tmExport: "/tmp/ref.tmx" },
      {
        memories: [tmMemory("tm-p1", "主记忆库"), tmMemory("m-ref", "参考库")],
        mounts: [tmMount("tm-p1", 0, true), tmMount("m-ref", 1, false)],
      },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    const picker = await screen.findByLabelText("记忆库");
    // The writable working memory is the default pick.
    expect(picker).toHaveValue("tm-p1");

    await userEvent.selectOptions(picker, "m-ref");
    await userEvent.click(screen.getByRole("button", { name: "导入外部 TM…" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          /外部 TM 导入完成（库「参考库」）：读取 2 条，新增 2，更新 0/,
        ),
      ).toBeInTheDocument();
    });
    const importCall = calls.find(([method]) => method === "tm.import");
    expect(importCall?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/ref.tmx",
      memoryId: "m-ref",
    });

    await userEvent.click(screen.getByRole("button", { name: "导出 TM…" }));
    await waitFor(() => {
      expect(
        screen.getByText(/TM 导出完成（库「参考库」）：3 条 → \/tmp\/ref.tmx/),
      ).toBeInTheDocument();
    });
    const exportCall = calls.find(([method]) => method === "tm.export");
    expect(exportCall?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/ref.tmx",
      memoryId: "m-ref",
    });
  });

  it("shows an honest note instead of TM file actions when nothing is mounted", async () => {
    installBridge(
      () =>
        Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        }),
      {},
      { memories: [], mounts: [] },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText(/未挂载记忆库，无法导入或导出/),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "导入外部 TM…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "导出 TM…" }),
    ).not.toBeInTheDocument();
  });

  it("keeps unrelated settings actions usable while a TM import runs", async () => {
    let finishImport: (response: EngineInvokeResponse) => void = () => {};
    installBridge(
      (method) => {
        if (method === "tm.import") {
          return new Promise<EngineInvokeResponse>((resolve) => {
            finishImport = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          result: {
            termbases: [
              termbase("tb1", "产品术语"),
              termbase("tb2", "备用术语"),
            ],
            mounts: [mount("tb1")],
          },
        });
      },
      { tmImport: "/tmp/slow.tmx" },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("产品术语")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "导入外部 TM…" }));

    // The in-flight control shows progress and disables; exporting the same
    // project TM would conflict, so it locks too.
    const importing = await screen.findByRole("button", { name: "导入中…" });
    expect(importing).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出 TM…" })).toBeDisabled();

    // Termbase actions touch different stores and stay usable.
    expect(
      screen.getByRole("button", { name: "导入术语到 产品术语" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "导出术语库 产品术语" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "挂载" })).toBeEnabled();

    finishImport({ ok: true, result: { imported: 2, added: 1, updated: 1 } });
    await waitFor(() => {
      expect(
        screen.getByText(
          /外部 TM 导入完成（库「主记忆库」）：读取 2 条，新增 1，更新 1/,
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "导入外部 TM…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出 TM…" })).toBeEnabled();
  });

  it("imports and exports a mounted termbase through its file channels", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "termbase.import") {
          return Promise.resolve({
            ok: true,
            result: { imported: 4, added: 2, merged: 2 },
          });
        }
        if (method === "termbase.export") {
          return Promise.resolve({
            ok: true,
            result: { exported: 6, outputPath: "/tmp/terms.csv" },
          });
        }
        return Promise.resolve({
          ok: true,
          result: {
            termbases: [termbase("tb1", "产品术语")],
            mounts: [mount("tb1")],
          },
        });
      },
      { termbaseImport: "/tmp/terms.tbx", termbaseExport: "/tmp/terms.csv" },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("产品术语")).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "导入术语到 产品术语" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          /术语库「产品术语」导入完成：读取 4 条，新增 2，合并 2/,
        ),
      ).toBeInTheDocument();
    });
    const importCall = calls.find(([method]) => method === "termbase.import");
    expect(importCall?.[1]).toEqual({
      termbaseId: "tb1",
      path: "/tmp/terms.tbx",
      targetLocale: "zh-CN",
    });

    await userEvent.click(
      screen.getByRole("button", { name: "导出术语库 产品术语" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/术语库「产品术语」导出完成：6 条 → \/tmp\/terms.csv/),
      ).toBeInTheDocument();
    });
    const exportCall = calls.find(([method]) => method === "termbase.export");
    expect(exportCall?.[1]).toEqual({
      termbaseId: "tb1",
      path: "/tmp/terms.csv",
    });
  });

  it("locks only the same termbase's file actions while its import runs", async () => {
    let finishImport: (response: EngineInvokeResponse) => void = () => {};
    installBridge(
      (method) => {
        if (method === "termbase.import") {
          return new Promise<EngineInvokeResponse>((resolve) => {
            finishImport = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          result: {
            termbases: [
              termbase("tb1", "产品术语"),
              termbase("tb2", "法务术语"),
            ],
            mounts: [mount("tb1"), mount("tb2")],
          },
        });
      },
      { termbaseImport: "/tmp/terms.tbx" },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("法务术语")).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "导入术语到 产品术语" }),
    );

    // The row keeps its aria-label, so assert progress via the visible text.
    const importingTb1 = screen.getByRole("button", {
      name: "导入术语到 产品术语",
    });
    await waitFor(() => {
      expect(importingTb1).toBeDisabled();
    });
    expect(importingTb1).toHaveTextContent("导入中…");
    expect(
      screen.getByRole("button", { name: "导出术语库 产品术语" }),
    ).toBeDisabled();

    // The other termbase and the project TM stay usable.
    expect(
      screen.getByRole("button", { name: "导入术语到 法务术语" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "导出术语库 法务术语" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "导入外部 TM…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出 TM…" })).toBeEnabled();

    finishImport({ ok: true, result: { imported: 3, added: 3, merged: 0 } });
    await waitFor(() => {
      expect(
        screen.getByText(
          /术语库「产品术语」导入完成：读取 3 条，新增 3，合并 0/,
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "导入术语到 产品术语" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "导出术语库 产品术语" }),
    ).toBeEnabled();
  });

  it("lists mounted termbases from the engine", async () => {
    installBridge(() =>
      Promise.resolve({
        ok: true,
        result: {
          termbases: [termbase("tb1", "产品术语")],
          mounts: [mount("tb1")],
        },
      }),
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("产品术语")).toBeInTheDocument();
    });
    expect(screen.getByText("已挂载")).toBeInTheDocument();
  });

  it("opens and closes the term manager for a mounted termbase", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "term.list") {
        return Promise.resolve({
          ok: true,
          result: {
            entries: [
              {
                id: "te1",
                termbaseId: "tb1",
                sourceLocale: "en-US",
                sourceTerm: "actuator",
                partOfSpeech: null,
                definition: null,
                example: null,
                domain: null,
                status: "active",
                revision: 1,
                translations: [],
                createdAtMs: 1,
                updatedAtMs: 1,
              },
            ],
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: {
          termbases: [termbase("tb1", "产品术语")],
          mounts: [mount("tb1")],
        },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("产品术语")).toBeInTheDocument();
    });
    expect(calls.some(([method]) => method === "term.list")).toBe(false);

    await userEvent.click(
      screen.getByRole("button", { name: "管理术语库 产品术语 的术语" }),
    );
    await waitFor(() => {
      expect(screen.getByText("actuator")).toBeInTheDocument();
    });
    const listCall = calls.find(([method]) => method === "term.list");
    expect(listCall?.[1]).toEqual({ termbaseId: "tb1" });

    expect(screen.getByText("收起术语")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "管理术语库 产品术语 的术语" }),
    );
    expect(screen.queryByText("actuator")).not.toBeInTheDocument();
  });

  it("creates and attaches a termbase through the engine", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "termbase.create") {
        return Promise.resolve({
          ok: true,
          result: termbase("tb-new", "新术语库"),
        });
      }
      if (method === "termbase.attach") {
        return Promise.resolve({
          ok: true,
          result: { mount: mount("tb-new") },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("新术语库名称"), "新术语库");
    await userEvent.click(screen.getByRole("button", { name: "新建并挂载" }));
    await waitFor(() => {
      expect(calls.some(([method]) => method === "termbase.create")).toBe(true);
    });
    expect(calls.some(([method]) => method === "termbase.attach")).toBe(true);
  });

  it("renders nothing when closed and closes via the footer button", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ProjectSettingsDialog
        open={false}
        project={project}
        onClose={onClose}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(
      <ProjectSettingsDialog open project={project} onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalled();
  });

  const QA_PROFILE_VIEW = {
    baseProfileId: "builtin.qa.cjk-professional",
    severityOverrides: {},
    settings: {
      maxTargetChars: null,
      minLengthRatioPercent: 35,
      maxLengthRatioPercent: 300,
      cjkSpacing: true,
      cjkPunctuation: true,
      requireSentenceFinalPunctuation: true,
    },
    // The engine-reported static rule ids — the severity table's rows.
    enabledRuleIds: [
      "qa.cjk-dash",
      "qa.edge-whitespace",
      "qa.empty-target",
      "qa.repeated-word",
      "qa.tag-tag_missing",
    ],
    blockExportOnError: false,
    revision: 1,
  };

  it("toggles the export gate through qa.profile.update with the fetched revision", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "qa.profile.get") {
        return Promise.resolve({ ok: true, result: QA_PROFILE_VIEW });
      }
      if (method === "qa.profile.update") {
        return Promise.resolve({
          ok: true,
          result: { ...QA_PROFILE_VIEW, blockExportOnError: true, revision: 2 },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    const toggle = await screen.findByRole("checkbox", {
      name: "有错误时阻止导出",
    });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
    const update = calls.find(([method]) => method === "qa.profile.update");
    expect(update?.[1]).toEqual({
      projectId: "p1",
      baseRevision: 1,
      blockExportOnError: true,
    });
    expect(screen.getByText("已开启导出前 QA 检查")).toBeInTheDocument();
  });

  it("keeps the gate off and reports honestly when qa.profile.update fails", async () => {
    installBridge((method) => {
      if (method === "qa.profile.get") {
        return Promise.resolve({ ok: true, result: QA_PROFILE_VIEW });
      }
      if (method === "qa.profile.update") {
        return Promise.resolve({
          ok: false,
          error: { code: "conflict", message: "project revision is 5" },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    const toggle = await screen.findByRole("checkbox", {
      name: "有错误时阻止导出",
    });
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "project revision is 5",
      );
    });
    // The stored profile was refetched; the checkbox shows the real state.
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText("已开启导出前 QA 检查")).not.toBeInTheDocument();
  });

  it("writes a severity remap as the full table rebased on the stored view", async () => {
    const stored = {
      ...QA_PROFILE_VIEW,
      severityOverrides: { "qa.edge-whitespace": "error" },
    };
    const updates: unknown[] = [];
    installBridge((method, params) => {
      if (method === "qa.profile.get") {
        return Promise.resolve({ ok: true, result: stored });
      }
      if (method === "qa.profile.update") {
        updates.push(params);
        return Promise.resolve({
          ok: true,
          result: {
            ...stored,
            severityOverrides: {
              "qa.edge-whitespace": "error",
              "qa.tag-tag_missing": "error",
            },
            revision: 2,
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    const row = await screen.findByLabelText("qa.tag-tag_missing");
    // A rule without a remap reads 默认 — the renderer never guesses the
    // base profile's severity.
    expect(row).toHaveValue("default");
    expect(screen.getByLabelText("qa.edge-whitespace")).toHaveValue("error");

    await userEvent.selectOptions(row, "error");
    await waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    expect(updates[0]).toEqual({
      projectId: "p1",
      baseRevision: 1,
      severityOverrides: {
        "qa.edge-whitespace": "error",
        "qa.tag-tag_missing": "error",
      },
    });
    expect(
      screen.getByText("严重度已更新：qa.tag-tag_missing → 错误"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(row).toHaveValue("error");
    });
  });

  it("clears the last remap by sending the empty table", async () => {
    const stored = {
      ...QA_PROFILE_VIEW,
      severityOverrides: { "qa.repeated-word": "error" },
    };
    const updates: unknown[] = [];
    installBridge((method, params) => {
      if (method === "qa.profile.get") {
        return Promise.resolve({ ok: true, result: stored });
      }
      if (method === "qa.profile.update") {
        updates.push(params);
        return Promise.resolve({
          ok: true,
          result: { ...stored, severityOverrides: {}, revision: 2 },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    const row = await screen.findByLabelText("qa.repeated-word");
    expect(row).toHaveValue("error");
    await userEvent.selectOptions(row, "default");
    await waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    // {} clears every remap — the contract's wholesale-replacement shape.
    expect(updates[0]).toEqual({
      projectId: "p1",
      baseRevision: 1,
      severityOverrides: {},
    });
    expect(
      screen.getByText("已清除严重度覆写：qa.repeated-word"),
    ).toBeInTheDocument();
  });

  it("saves the settings knobs wholesale and clears them via clearSettings", async () => {
    const updates: unknown[] = [];
    installBridge((method, params) => {
      if (method === "qa.profile.get") {
        return Promise.resolve({ ok: true, result: QA_PROFILE_VIEW });
      }
      if (method === "qa.profile.update") {
        updates.push(params);
        const change = params as {
          settings?: { minLengthRatioPercent: number };
        };
        return Promise.resolve({
          ok: true,
          result: change.settings
            ? {
                ...QA_PROFILE_VIEW,
                settings: {
                  ...QA_PROFILE_VIEW.settings,
                  minLengthRatioPercent: 50,
                  maxTargetChars: 120,
                },
                revision: 2,
              }
            : { ...QA_PROFILE_VIEW, revision: 3 },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    const min = await screen.findByLabelText("最短比（%）");
    await userEvent.clear(min);
    await userEvent.type(min, "50");
    const cap = screen.getByLabelText("字数上限");
    await userEvent.type(cap, "120");
    await userEvent.click(screen.getByRole("checkbox", { name: "CJK 间距" }));
    await userEvent.click(screen.getByRole("button", { name: "保存规则参数" }));
    await waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    expect(updates[0]).toEqual({
      projectId: "p1",
      baseRevision: 1,
      settings: {
        cjkPunctuation: true,
        cjkSpacing: false,
        requireSentenceFinalPunctuation: true,
        minLengthRatioPercent: 50,
        maxLengthRatioPercent: 300,
        maxTargetChars: 120,
      },
    });
    expect(screen.getByText("QA 规则参数已保存")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    await waitFor(() => {
      expect(updates).toHaveLength(2);
    });
    expect(updates[1]).toEqual({
      projectId: "p1",
      baseRevision: 2,
      clearSettings: true,
    });
    expect(screen.getByText("QA 规则参数已恢复默认")).toBeInTheDocument();
  });

  it("rebases a conflicted remap on the refetched revision and retries once", async () => {
    let updateCount = 0;
    let getCount = 0;
    const updates: unknown[] = [];
    installBridge((method, params) => {
      if (method === "qa.profile.get") {
        getCount += 1;
        return Promise.resolve({
          ok: true,
          // The first fetch (dialog open) serves revision 1; the conflict
          // refetch serves the moved revision 5 with a remap someone else
          // wrote in between.
          result:
            getCount === 1
              ? QA_PROFILE_VIEW
              : {
                  ...QA_PROFILE_VIEW,
                  severityOverrides: { "qa.cjk-dash": "warning" },
                  revision: 5,
                },
        });
      }
      if (method === "qa.profile.update") {
        updateCount += 1;
        updates.push(params);
        if (updateCount === 1) {
          return Promise.resolve({
            ok: false,
            error: { code: "conflict", message: "project revision is 5" },
          });
        }
        return Promise.resolve({
          ok: true,
          result: {
            ...QA_PROFILE_VIEW,
            severityOverrides: {
              "qa.cjk-dash": "warning",
              "qa.empty-target": "warning",
            },
            revision: 6,
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    const row = await screen.findByLabelText("qa.empty-target");
    await userEvent.selectOptions(row, "warning");
    await waitFor(() => {
      expect(updates).toHaveLength(2);
    });
    expect(updates[0]).toEqual({
      projectId: "p1",
      baseRevision: 1,
      severityOverrides: { "qa.empty-target": "warning" },
    });
    // The retry rides the fresh revision and the fresh table — the change
    // is rebased, never a stale replay that would drop qa.cjk-dash.
    expect(updates[1]).toEqual({
      projectId: "p1",
      baseRevision: 5,
      severityOverrides: {
        "qa.cjk-dash": "warning",
        "qa.empty-target": "warning",
      },
    });
    expect(
      screen.getByText("严重度已更新：qa.empty-target → 警告"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("qa.cjk-dash")).toHaveValue("warning");
    });
  });

  it("shows the stored base profile id read-only", async () => {
    installBridge((method) => {
      if (method === "qa.profile.get") {
        return Promise.resolve({ ok: true, result: QA_PROFILE_VIEW });
      }
      return Promise.resolve({
        ok: true,
        result: { termbases: [], mounts: [] },
      });
    });
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    expect(
      await screen.findByText("builtin.qa.cjk-professional"),
    ).toBeInTheDocument();
  });
});
