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

interface BridgeOverrides {
  chooseTmFile?: DesktopApi["chooseTmFile"];
  chooseTermFile?: DesktopApi["chooseTermFile"];
  chooseExportPath?: DesktopApi["chooseExportPath"];
}

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
  overrides: BridgeOverrides = {},
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(invoke);
  const api: Partial<DesktopApi> = {
    invoke: spy,
    chooseTmFile: overrides.chooseTmFile ?? vi.fn().mockResolvedValue(null),
    chooseTermFile: overrides.chooseTermFile ?? vi.fn().mockResolvedValue(null),
    chooseExportPath:
      overrides.chooseExportPath ?? vi.fn().mockResolvedValue(null),
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return spy;
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

  it("imports an external TM through the file channel", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "tm.import") {
          return Promise.resolve({
            ok: true,
            result: { imported: 3, added: 2, updated: 1 },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { chooseTmFile: vi.fn().mockResolvedValue("/tmp/memory.tmx") },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "导入外部 TM…" }));
    await waitFor(() => {
      expect(
        screen.getByText(/TM 导入完成：读取 3 条，新增 2，更新 1/),
      ).toBeInTheDocument();
    });
    expect(calls).toContainEqual([
      "tm.import",
      { projectId: "p1", path: "/tmp/memory.tmx" },
    ]);
  });

  it("does not call tm.import when the picker is canceled", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { chooseTmFile: vi.fn().mockResolvedValue(null) },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "导入外部 TM…" }));
    expect(calls.some(([method]) => method === "tm.import")).toBe(false);
  });

  it("exports the project TM through the save channel", async () => {
    const calls: Array<[string, unknown]> = [];
    const chooseExportPath = vi.fn().mockResolvedValue("/tmp/out.tmx");
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "tm.export") {
          return Promise.resolve({
            ok: true,
            result: { outputPath: "/tmp/out.tmx", exported: 5 },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      },
      { chooseExportPath },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "导出 TM…" }));
    await waitFor(() => {
      expect(screen.getByText(/TM 导出完成：5 条/)).toBeInTheDocument();
    });
    expect(chooseExportPath).toHaveBeenCalledWith("演示项目-tm.tmx");
    expect(calls).toContainEqual([
      "tm.export",
      { projectId: "p1", path: "/tmp/out.tmx" },
    ]);
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

  it("imports terms into a mounted termbase with the project target locale", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge(
      (method, params) => {
        calls.push([method, params]);
        if (method === "termbase.import") {
          return Promise.resolve({
            ok: true,
            result: { imported: 4, added: 3, merged: 1 },
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
      { chooseTermFile: vi.fn().mockResolvedValue("/tmp/terms.csv") },
    );
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("产品术语")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "导入术语…" }));
    await waitFor(() => {
      expect(
        screen.getByText(/「产品术语」导入完成：读取 4 条，新增 3，合并 1/),
      ).toBeInTheDocument();
    });
    expect(calls).toContainEqual([
      "termbase.import",
      { termbaseId: "tb1", path: "/tmp/terms.csv", targetLocale: "zh-CN" },
    ]);
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
