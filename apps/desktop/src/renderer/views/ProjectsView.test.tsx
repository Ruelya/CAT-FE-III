import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { LAST_PROJECT_KEY, ProjectsView } from "./ProjectsView.js";

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    name: overrides.id,
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    domain: "general",
    lifecycle: "active",
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    configuration: {},
    ...overrides,
  };
}

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
) {
  const bridge = { invoke: vi.fn(invoke) };
  const api: Partial<DesktopApi> = bridge;
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return bridge;
}

function installListBridge(projects: Project[]) {
  return installBridge((method) => {
    if (method === "project.list") {
      return Promise.resolve({ ok: true, result: { projects } });
    }
    return Promise.resolve({
      ok: false,
      error: { code: "notFound", message: `unexpected ${method}` },
    });
  });
}

describe("ProjectsView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hides archived projects by default and shows them via the toggle", async () => {
    installListBridge([
      project({ id: "active-1", name: "进行中项目" }),
      project({
        id: "archived-1",
        name: "旧项目",
        lifecycle: "archived",
        archivedAtMs: 99,
      }),
    ]);
    render(
      <ProjectsView
        engineState="ready"
        onOpenProject={vi.fn()}
        onStatusMessage={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("进行中项目")).toBeInTheDocument();
    });
    // The list caption counts only active projects; the archived one is
    // hidden until the toggle reveals it.
    expect(screen.getByText("项目（1）")).toBeInTheDocument();
    expect(screen.queryByText("旧项目")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("checkbox", { name: /显示已归档项目（1）/ }),
    );
    expect(screen.getByText("旧项目")).toBeInTheDocument();
    expect(screen.getByText("已归档")).toBeInTheDocument();
  });

  it("omits the archived toggle when no project is archived", async () => {
    installListBridge([project({ id: "only", name: "唯一项目" })]);
    render(
      <ProjectsView
        engineState="ready"
        onOpenProject={vi.fn()}
        onStatusMessage={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("唯一项目")).toBeInTheDocument();
    });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("已归档")).not.toBeInTheDocument();
  });

  it("explains an all-archived list instead of showing an empty page", async () => {
    installListBridge([
      project({
        id: "archived-only",
        name: "已完结项目",
        lifecycle: "archived",
        archivedAtMs: 99,
      }),
    ]);
    render(
      <ProjectsView
        engineState="ready"
        onOpenProject={vi.fn()}
        onStatusMessage={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("没有进行中的项目")).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("checkbox", { name: /显示已归档项目（1）/ }),
    );
    expect(screen.getByText("已完结项目")).toBeInTheDocument();
  });

  it("opens an archived project when clicked from the expanded list", async () => {
    const archived = project({
      id: "archived-open",
      name: "归档可打开",
      lifecycle: "archived",
      archivedAtMs: 99,
    });
    installListBridge([
      project({ id: "active-2", name: "活动项目" }),
      archived,
    ]);
    const onOpenProject = vi.fn();
    render(
      <ProjectsView
        engineState="ready"
        onOpenProject={onOpenProject}
        onStatusMessage={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("活动项目")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /归档可打开/ }));
    expect(onOpenProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "archived-open" }),
    );
  });

  it("offers 继续 for the remembered project and records every open", async () => {
    localStorage.setItem(LAST_PROJECT_KEY, "p2");
    installListBridge([
      project({ id: "p1", name: "项目一" }),
      project({ id: "p2", name: "项目二" }),
    ]);
    const onOpenProject = vi.fn();
    render(
      <ProjectsView
        engineState="ready"
        onOpenProject={onOpenProject}
        onStatusMessage={vi.fn()}
      />,
    );
    const chip = await screen.findByRole("button", { name: "继续「项目二」" });
    await userEvent.click(chip);
    expect(onOpenProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p2" }),
    );

    // Opening a different project from the list re-records the id.
    await userEvent.click(screen.getByRole("button", { name: /项目一/ }));
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBe("p1");
  });

  it("shows no 继续 chip when the remembered project left project.list", async () => {
    localStorage.setItem(LAST_PROJECT_KEY, "gone");
    installListBridge([project({ id: "p1", name: "项目一" })]);
    render(
      <ProjectsView
        engineState="ready"
        onOpenProject={vi.fn()}
        onStatusMessage={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("项目一")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /继续/ })).not.toBeInTheDocument();
  });

  it("focusCreate lands the keyboard in the create form's name field once", async () => {
    installListBridge([project({ id: "p", name: "现有项目" })]);
    const onCreateConsumed = vi.fn();
    const view = render(
      <ProjectsView
        engineState="ready"
        onOpenProject={vi.fn()}
        onStatusMessage={vi.fn()}
        focusCreate={false}
        onCreateConsumed={onCreateConsumed}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("现有项目")).toBeInTheDocument();
    });
    const name = screen.getByLabelText("项目名称");
    expect(document.activeElement).not.toBe(name);
    expect(onCreateConsumed).not.toHaveBeenCalled();

    // 文件 ▸ 新建项目… raises the flag; the existing create form's name
    // field gets focus and the flag is consumed.
    view.rerender(
      <ProjectsView
        engineState="ready"
        onOpenProject={vi.fn()}
        onStatusMessage={vi.fn()}
        focusCreate={true}
        onCreateConsumed={onCreateConsumed}
      />,
    );
    expect(document.activeElement).toBe(name);
    expect(onCreateConsumed).toHaveBeenCalledTimes(1);
  });
});
