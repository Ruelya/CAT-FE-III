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

  it("shows the language pair read-only with an honest explanation", () => {
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    expect(screen.getByText("en-US → zh-CN")).toBeInTheDocument();
    expect(screen.getByText(/尚无 project.update/)).toBeInTheDocument();
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
