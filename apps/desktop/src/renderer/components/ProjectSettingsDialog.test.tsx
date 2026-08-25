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

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(invoke);
  const api: Partial<DesktopApi> = { invoke: spy };
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

  it("keeps external TM import disabled until a file channel exists", () => {
    render(<ProjectSettingsDialog open project={project} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "挂载外部 TM…" })).toBeDisabled();
    expect(screen.getByText(/不做假成功/)).toBeInTheDocument();
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
