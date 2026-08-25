import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Project, TmEntry } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { TmManageDialog } from "./TmManageDialog.js";

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

function entry(id: string, sourceText: string, targetText: string): TmEntry {
  return {
    id,
    memoryId: "tm-p1",
    sourceText,
    targetText,
    sourceHash: `hash-${id}`,
    originProjectId: "p1",
    originDocumentId: "",
    originSegmentId: "",
    confirmedAtMs: 1,
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

function listResponse(
  entries: TmEntry[],
  total?: number,
): EngineInvokeResponse {
  return {
    ok: true,
    result: { entries, total: total ?? entries.length },
  };
}

describe("TmManageDialog", () => {
  it("lists project TM entries with the engine's honest count", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      return Promise.resolve(
        listResponse([
          entry("e1", "Hello world.", "你好，世界。"),
          entry("e2", "Save often.", "经常保存。"),
        ]),
      );
    });
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Hello world.")).toBeInTheDocument();
    });
    expect(screen.getByText("你好，世界。")).toBeInTheDocument();
    expect(screen.getByText("项目 TM 共 2 条")).toBeInTheDocument();
    const listCall = calls.find(([method]) => method === "tm.list");
    expect(listCall?.[1]).toEqual({ projectId: "p1", limit: 50, offset: 0 });
  });

  it("shows an honest empty state when the TM has no entries", async () => {
    installBridge(() => Promise.resolve(listResponse([])));
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("TM 暂无条目")).toBeInTheDocument();
    });
    expect(screen.getByText("项目 TM 共 0 条")).toBeInTheDocument();
  });

  it("surfaces tm.list engine errors instead of pretending", async () => {
    installBridge(() =>
      Promise.resolve({
        ok: false,
        error: { code: "notFound", message: "project p1" },
      }),
    );
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("project p1");
    });
  });

  it("searches entries by sending the trimmed query to tm.list", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      const query = (params as { query?: string }).query;
      if (query === "hello") {
        return Promise.resolve(
          listResponse([entry("e1", "Hello world.", "你好，世界。")]),
        );
      }
      return Promise.resolve(
        listResponse([
          entry("e1", "Hello world.", "你好，世界。"),
          entry("e2", "Save often.", "经常保存。"),
        ]),
      );
    });
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Save often.")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("搜索源文或译文"), "  hello  ");
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(screen.getByText(/匹配「hello」共 1 条/)).toBeInTheDocument();
    });
    expect(screen.queryByText("源：Save often.")).not.toBeInTheDocument();
    const queried = calls.find(
      ([method, params]) =>
        method === "tm.list" && (params as { query?: string }).query,
    );
    expect(queried?.[1]).toEqual({
      projectId: "p1",
      limit: 50,
      offset: 0,
      query: "hello",
    });
  });

  it("shows a no-match empty state for a fruitless search", async () => {
    installBridge((_method, params) => {
      if ((params as { query?: string }).query) {
        return Promise.resolve(listResponse([]));
      }
      return Promise.resolve(
        listResponse([entry("e1", "Hello world.", "你好，世界。")]),
      );
    });
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Hello world.")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("搜索源文或译文"), "nowhere");
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(screen.getByText("无匹配条目")).toBeInTheDocument();
    });
  });

  it("edits source and target through tm.update", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "tm.update") {
        const update = params as {
          entryId: string;
          sourceText: string;
          targetText: string;
        };
        return Promise.resolve({
          ok: true,
          result: {
            entry: entry(update.entryId, update.sourceText, update.targetText),
          },
        });
      }
      return Promise.resolve(
        listResponse([entry("e1", "Hello world.", "你好，世界。")]),
      );
    });
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Hello world.")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "编辑条目 Hello world." }),
    );
    const targetField = screen.getByLabelText("译文");
    expect(targetField).toHaveValue("你好，世界。");
    await userEvent.clear(targetField);
    await userEvent.type(targetField, "世界你好。");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(screen.getByText("世界你好。")).toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("条目已保存。");
    const updateCall = calls.find(([method]) => method === "tm.update");
    expect(updateCall?.[1]).toEqual({
      entryId: "e1",
      sourceText: "Hello world.",
      targetText: "世界你好。",
    });
  });

  it("surfaces tm.update conflicts and keeps the editor open", async () => {
    installBridge((method) => {
      if (method === "tm.update") {
        return Promise.resolve({
          ok: false,
          error: {
            code: "conflict",
            message:
              "another TM entry in this memory already covers that source text",
          },
        });
      }
      return Promise.resolve(
        listResponse([entry("e1", "Hello world.", "你好，世界。")]),
      );
    });
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Hello world.")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "编辑条目 Hello world." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "already covers that source text",
      );
    });
    expect(screen.getByLabelText("源文")).toBeInTheDocument();
  });

  it("deletes only after explicit confirmation and never confirms or exports", async () => {
    const calls: Array<[string, unknown]> = [];
    let backing = [
      entry("e1", "Hello world.", "你好，世界。"),
      entry("e2", "Save often.", "经常保存。"),
    ];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "tm.delete") {
        const removed = backing.find(
          (candidate) =>
            candidate.id === (params as { entryId: string }).entryId,
        );
        backing = backing.filter((candidate) => candidate !== removed);
        return Promise.resolve({ ok: true, result: { entry: removed } });
      }
      return Promise.resolve(listResponse(backing));
    });
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Save often.")).toBeInTheDocument();
    });

    // First press only arms the confirmation; nothing is deleted yet.
    await userEvent.click(
      screen.getByRole("button", { name: "删除条目 Save often." }),
    );
    expect(screen.getByText(/确认删除该条目？/)).toBeInTheDocument();
    expect(calls.some(([method]) => method === "tm.delete")).toBe(false);

    // Backing out leaves the entry alone.
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(calls.some(([method]) => method === "tm.delete")).toBe(false);
    expect(screen.getByText("源：Save often.")).toBeInTheDocument();

    // Arm again and confirm for real.
    await userEvent.click(
      screen.getByRole("button", { name: "删除条目 Save often." }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "确认删除条目 Save often." }),
    );
    await waitFor(() => {
      expect(screen.queryByText("源：Save often.")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "已删除条目：Save often.",
    );
    expect(screen.getByText("项目 TM 共 1 条")).toBeInTheDocument();
    const deleteCall = calls.find(([method]) => method === "tm.delete");
    expect(deleteCall?.[1]).toEqual({ entryId: "e2" });

    // The manage surface must never confirm segments or export files.
    const forbidden = ["segment.confirm", "tm.export", "document.export"];
    expect(calls.filter(([method]) => forbidden.includes(method))).toEqual([]);
  });

  it("renders nothing when closed and closes via the footer button", async () => {
    installBridge(() => Promise.resolve(listResponse([])));
    const onClose = vi.fn();
    const { rerender } = render(
      <TmManageDialog open={false} project={project} onClose={onClose} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<TmManageDialog open project={project} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalled();
  });
});
