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

function mount(termbaseId: string) {
  return {
    projectId: "p1",
    termbaseId,
    priority: 0,
    enabled: true,
    writable: true,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

interface BridgePickers {
  tmImport?: string | null;
  tmExport?: string | null;
  termbaseImport?: string | null;
  termbaseExport?: string | null;
}

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
  pickers: BridgePickers = {},
) {
  const bridge = {
    invoke: vi.fn(invoke),
    chooseTmImportFile: vi.fn(() => Promise.resolve(pickers.tmImport ?? null)),
    chooseTmExportPath: vi.fn(() => Promise.resolve(pickers.tmExport ?? null)),
    chooseTermbaseImportFile: vi.fn(() =>
      Promise.resolve(pickers.termbaseImport ?? null),
    ),
    chooseTermbaseExportPath: vi.fn(() =>
      Promise.resolve(pickers.termbaseExport ?? null),
    ),
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
      expect(
        screen.getByText(/术语库「产品术语」已卸载：数据保留，可重新挂载/),
      ).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "导入外部 TM…" }));
    await waitFor(() => {
      expect(
        screen.getByText(/外部 TM 导入完成：读取 5 条，新增 3，更新 2/),
      ).toBeInTheDocument();
    });
    const importCall = calls.find(([method]) => method === "tm.import");
    expect(importCall?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/legacy.tmx",
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
    await userEvent.click(screen.getByRole("button", { name: "导入外部 TM…" }));
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
    await userEvent.click(screen.getByRole("button", { name: "导入外部 TM…" }));
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
    await userEvent.click(screen.getByRole("button", { name: "导出 TM…" }));
    await waitFor(() => {
      expect(
        screen.getByText(/TM 导出完成：7 条 → \/tmp\/out.tmx/),
      ).toBeInTheDocument();
    });
    // The save dialog gets a sensible default filename derived from the
    // project name, so the picked path starts from something meaningful.
    expect(bridge.chooseTmExportPath).toHaveBeenCalledWith("演示项目-tm.tmx");
    const exportCall = calls.find(([method]) => method === "tm.export");
    expect(exportCall?.[1]).toEqual({ projectId: "p1", path: "/tmp/out.tmx" });
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
    await userEvent.click(screen.getByRole("button", { name: "导出 TM…" }));

    // The refusal surfaces as an explicit question, not an error alert.
    const prompt = await screen.findByRole("alertdialog", {
      name: "目标已存在，要覆盖吗？",
    });
    expect(prompt).toHaveTextContent("/tmp/out.tmx");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "覆盖" }));
    await waitFor(() => {
      expect(
        screen.getByText(/TM 导出完成（已覆盖）：7 条 → \/tmp\/out.tmx/),
      ).toBeInTheDocument();
    });
    const exportCalls = calls.filter(([method]) => method === "tm.export");
    expect(exportCalls).toHaveLength(2);
    expect(exportCalls[0]?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/out.tmx",
    });
    expect(exportCalls[1]?.[1]).toEqual({
      projectId: "p1",
      path: "/tmp/out.tmx",
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
    await userEvent.click(screen.getByRole("button", { name: "导出 TM…" }));
    await screen.findByRole("alertdialog", {
      name: "目标已存在，要覆盖吗？",
    });

    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("alertdialog", { name: "目标已存在，要覆盖吗？" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/已取消导出：保留现有文件，未做任何修改。/),
    ).toBeInTheDocument();
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
    const exportCalls = calls.filter(([method]) => method === "termbase.export");
    expect(exportCalls).toHaveLength(2);
    expect(exportCalls[1]?.[1]).toEqual({
      termbaseId: "tb1",
      path: "/tmp/terms.csv",
      overwrite: true,
    });
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
        screen.getByText(/外部 TM 导入完成：读取 2 条，新增 1，更新 1/),
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
});
