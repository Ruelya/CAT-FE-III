import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Memory,
  MemoryMount,
  Project,
  TmEntry,
} from "@translunar/contracts";
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

function memory(id: string, name: string): Memory {
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

function mount(
  memoryId: string,
  priority: number,
  overrides?: Partial<MemoryMount>,
): MemoryMount {
  return {
    projectId: "p1",
    memoryId,
    priority,
    enabled: true,
    writable: false,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

function entry(
  id: string,
  memoryId: string,
  sourceText: string,
  targetText: string,
): TmEntry {
  return {
    id,
    memoryId,
    sourceText,
    targetText,
    sourceHash: `hash-${id}`,
    originProjectId: "p1",
    originDocumentId: "",
    originSegmentId: "",
    confirmedAtMs: 1,
  };
}

interface BridgeState {
  memories: Memory[];
  mounts: MemoryMount[];
  entries: TmEntry[];
}

/**
 * Stateful fake engine: serves memory.list / tm.list from state and applies
 * memory.attach / detach / update and tm.update / delete the way the real
 * engine does — including the refusal to hold two writable mounts, so the
 * dialog's demote-then-promote sequence is actually exercised.
 */
function installMemoryBridge(state: BridgeState) {
  const calls: Array<[string, unknown]> = [];
  const sorted = () =>
    [...state.mounts].sort((a, b) => a.priority - b.priority);
  const renumber = (list: MemoryMount[]) => {
    list.forEach((item, index) => {
      item.priority = index;
    });
    state.mounts = list;
  };
  const invoke = (
    method: string,
    params: unknown,
  ): Promise<EngineInvokeResponse> => {
    calls.push([method, params]);
    const p = params as Record<string, unknown>;
    switch (method) {
      case "memory.list":
        return Promise.resolve({
          ok: true,
          result: { memories: [...state.memories], mounts: sorted() },
        });
      case "memory.attach": {
        const added = mount(p.memoryId as string, state.mounts.length);
        state.mounts.push(added);
        return Promise.resolve({ ok: true, result: { mount: added } });
      }
      case "memory.detach": {
        const removed = state.mounts.find(
          (item) => item.memoryId === p.memoryId,
        );
        if (!removed) {
          return Promise.resolve({
            ok: false,
            error: { code: "notFound", message: "mount not found" },
          });
        }
        renumber(sorted().filter((item) => item !== removed));
        return Promise.resolve({ ok: true, result: { mount: removed } });
      }
      case "memory.update": {
        const target = state.mounts.find(
          (item) => item.memoryId === p.memoryId,
        );
        if (!target) {
          return Promise.resolve({
            ok: false,
            error: { code: "notFound", message: "mount not found" },
          });
        }
        if (
          p.writable === true &&
          state.mounts.some((item) => item.writable && item !== target)
        ) {
          return Promise.resolve({
            ok: false,
            error: { code: "conflict", message: "已有可写挂载" },
          });
        }
        if (typeof p.enabled === "boolean") {
          target.enabled = p.enabled;
        }
        if (typeof p.writable === "boolean") {
          target.writable = p.writable;
        }
        if (typeof p.priority === "number") {
          const rest = sorted().filter((item) => item !== target);
          rest.splice(Math.min(p.priority, rest.length), 0, target);
          renumber(rest);
        }
        return Promise.resolve({ ok: true, result: { mounts: sorted() } });
      }
      case "memory.create": {
        const created = memory(
          `m-new-${state.memories.length}`,
          p.name as string,
        );
        state.memories.push(created);
        return Promise.resolve({ ok: true, result: created });
      }
      case "memory.rename": {
        const target = state.memories.find((item) => item.id === p.memoryId);
        if (!target) {
          return Promise.resolve({
            ok: false,
            error: { code: "notFound", message: "memory not found" },
          });
        }
        if (target.revision !== p.baseRevision) {
          return Promise.resolve({
            ok: false,
            error: {
              code: "conflict",
              message: `memory revision moved to ${target.revision}; refresh before renaming`,
            },
          });
        }
        target.name = p.name as string;
        target.revision += 1;
        return Promise.resolve({ ok: true, result: { memory: { ...target } } });
      }
      case "memory.delete": {
        const target = state.memories.find((item) => item.id === p.memoryId);
        if (!target) {
          return Promise.resolve({
            ok: false,
            error: { code: "notFound", message: "memory not found" },
          });
        }
        if (state.mounts.some((item) => item.memoryId === p.memoryId)) {
          return Promise.resolve({
            ok: false,
            error: {
              code: "conflict",
              message: "memory is mounted on 1 project(s); detach it first",
            },
          });
        }
        const remaining = state.entries.filter(
          (item) => item.memoryId === p.memoryId,
        );
        if (remaining.length > 0 && p.deleteEntries !== true) {
          return Promise.resolve({
            ok: false,
            error: {
              code: "conflict",
              message: `memory still holds ${remaining.length} TM entries; pass deleteEntries to remove them with it`,
            },
          });
        }
        state.memories = state.memories.filter((item) => item !== target);
        state.entries = state.entries.filter(
          (item) => item.memoryId !== p.memoryId,
        );
        return Promise.resolve({
          ok: true,
          result: { memory: target, deletedEntries: remaining.length },
        });
      }
      case "tm.list": {
        const query = typeof p.query === "string" ? p.query : "";
        const all = state.entries.filter(
          (item) =>
            item.memoryId === p.memoryId &&
            (!query ||
              item.sourceText.includes(query) ||
              item.targetText.includes(query)),
        );
        const offset = typeof p.offset === "number" ? p.offset : 0;
        const limit = typeof p.limit === "number" ? p.limit : 50;
        return Promise.resolve({
          ok: true,
          result: {
            entries: all.slice(offset, offset + limit),
            total: all.length,
          },
        });
      }
      case "tm.update": {
        const target = state.entries.find((item) => item.id === p.entryId);
        if (!target) {
          return Promise.resolve({
            ok: false,
            error: { code: "notFound", message: "entry not found" },
          });
        }
        target.sourceText = p.sourceText as string;
        target.targetText = p.targetText as string;
        return Promise.resolve({ ok: true, result: { entry: { ...target } } });
      }
      case "tm.delete": {
        const target = state.entries.find((item) => item.id === p.entryId);
        state.entries = state.entries.filter((item) => item !== target);
        return Promise.resolve({ ok: true, result: { entry: target } });
      }
      default:
        return Promise.resolve({
          ok: false,
          error: { code: "invalidParams", message: `unexpected ${method}` },
        });
    }
  };
  const bridge = { invoke: vi.fn(invoke) };
  const api: Partial<DesktopApi> = bridge;
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return { bridge, calls };
}

/** Working memory (writable) plus one read-only reference memory. */
function twoMountState(): BridgeState {
  return {
    memories: [memory("tm-p1", "主记忆库"), memory("m-b", "领域库")],
    mounts: [
      mount("tm-p1", 0, { writable: true }),
      mount("m-b", 1),
    ],
    entries: [
      entry("e1", "tm-p1", "Hello world.", "你好，世界。"),
      entry("e2", "tm-p1", "Save often.", "经常保存。"),
      entry("e3", "m-b", "Domain term.", "领域术语。"),
    ],
  };
}

describe("TmManageDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists mounts with 可写/只读 badges and the writable memory's entries", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Hello world.")).toBeInTheDocument();
    });
    // Both mounts render, the writable one badged 可写, the other 只读.
    expect(screen.getByText("可写")).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    // Entries default to the writable (working) memory with an honest count.
    expect(screen.getByText("记忆库「主记忆库」共 2 条")).toBeInTheDocument();
    const listCall = calls.find(([method]) => method === "tm.list");
    expect(listCall?.[1]).toEqual({
      projectId: "p1",
      memoryId: "tm-p1",
      limit: 50,
      offset: 0,
    });
  });

  it("switches the entries listing to another mounted memory", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Hello world.")).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByLabelText("记忆库"), "m-b");
    await waitFor(() => {
      expect(screen.getByText("源：Domain term.")).toBeInTheDocument();
    });
    expect(screen.getByText("记忆库「领域库」共 1 条")).toBeInTheDocument();
    expect(screen.queryByText("源：Hello world.")).not.toBeInTheDocument();
    const switched = calls.find(
      ([method, params]) =>
        method === "tm.list" &&
        (params as { memoryId?: string }).memoryId === "m-b",
    );
    expect(switched).toBeDefined();
  });

  it("promotes a memory to writable by demoting the current one first", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("可写")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "设为可写记忆库 领域库" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "已设为可写：领域库",
      );
    });
    // The fake engine refuses two writable mounts, so reaching this state
    // proves the demote ran before the promote.
    const updates = calls.filter(([method]) => method === "memory.update");
    expect(updates.map(([, params]) => params)).toEqual([
      { projectId: "p1", memoryId: "tm-p1", writable: false },
      { projectId: "p1", memoryId: "m-b", writable: true },
    ]);
    // Exactly one 可写 badge remains.
    expect(screen.getAllByText("可写")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "设为可写记忆库 主记忆库" }),
    ).toBeInTheDocument();
  });

  it("reorders mounts through memory.update priority", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    const moveUp = await screen.findByRole("button", {
      name: "上移记忆库 领域库",
    });
    await userEvent.click(moveUp);
    await waitFor(() => {
      const names = screen
        .getAllByText(/主记忆库|领域库/)
        .filter((node) => node.className === "tm-manage__mount-name")
        .map((node) => node.textContent);
      expect(names).toEqual(["领域库", "主记忆库"]);
    });
    const move = calls.find(([method]) => method === "memory.update");
    expect(move?.[1]).toEqual({
      projectId: "p1",
      memoryId: "m-b",
      priority: 0,
    });
  });

  it("disables a mount for the read path and re-enables it", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    const disable = await screen.findByRole("button", {
      name: "停用记忆库 领域库",
    });
    await userEvent.click(disable);
    await waitFor(() => {
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "启用记忆库 领域库" }),
    );
    await waitFor(() => {
      expect(screen.queryByText("已停用")).not.toBeInTheDocument();
    });
    const updates = calls.filter(([method]) => method === "memory.update");
    expect(updates.map(([, params]) => params)).toEqual([
      { projectId: "p1", memoryId: "m-b", enabled: false },
      { projectId: "p1", memoryId: "m-b", enabled: true },
    ]);
  });

  it("attaches an existing memory read-only", async () => {
    const state = twoMountState();
    state.memories.push(memory("m-c", "参考库"));
    const { calls } = installMemoryBridge(state);
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByLabelText("挂载已有记忆库")).toBeInTheDocument();
    });
    await userEvent.selectOptions(
      screen.getByLabelText("挂载已有记忆库"),
      "m-c",
    );
    await userEvent.click(screen.getByRole("button", { name: "挂载" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "已挂载：参考库（只读）",
      );
    });
    expect(
      screen.getByRole("button", { name: "卸载记忆库 参考库" }),
    ).toBeInTheDocument();
    const attach = calls.find(([method]) => method === "memory.attach");
    expect(attach?.[1]).toEqual({ projectId: "p1", memoryId: "m-c" });
    // A fresh mount never becomes writable by itself.
    expect(screen.getAllByText("只读")).toHaveLength(2);
  });

  it("creates a memory with the project locales and mounts it", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByLabelText("新建记忆库")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("新建记忆库"), "  风格库  ");
    await userEvent.click(
      screen.getByRole("button", { name: "新建并挂载" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "已新建并挂载：风格库（只读）",
      );
    });
    expect(
      screen.getByRole("button", { name: "卸载记忆库 风格库" }),
    ).toBeInTheDocument();
    const create = calls.find(([method]) => method === "memory.create");
    expect(create?.[1]).toEqual({
      name: "风格库",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
    });
    const attach = calls.find(([method]) => method === "memory.attach");
    expect(attach?.[1]).toEqual({ projectId: "p1", memoryId: "m-new-2" });
  });

  it("detaches a mount and keeps its entries", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    const detachButton = await screen.findByRole("button", {
      name: "卸载记忆库 领域库",
    });
    await userEvent.click(detachButton);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "已卸载：领域库（条目保留）",
      );
    });
    expect(
      screen.queryByRole("button", { name: "卸载记忆库 领域库" }),
    ).not.toBeInTheDocument();
    const detach = calls.find(([method]) => method === "memory.detach");
    expect(detach?.[1]).toEqual({ projectId: "p1", memoryId: "m-b" });
  });

  it("surfaces engine errors instead of pretending", async () => {
    const bridge = {
      invoke: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: { code: "notFound", message: "project p1" },
        }),
      ),
    };
    const api: Partial<DesktopApi> = bridge;
    Object.defineProperty(window, "tl", {
      value: api,
      configurable: true,
      writable: true,
    });
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("project p1");
    });
  });

  it("shows an honest empty state when the memory has no entries", async () => {
    const state = twoMountState();
    state.entries = [];
    installMemoryBridge(state);
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("记忆库暂无条目")).toBeInTheDocument();
    });
    expect(screen.getByText("记忆库「主记忆库」共 0 条")).toBeInTheDocument();
  });

  it("searches entries by sending the trimmed query to tm.list", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("源：Save often.")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("搜索源文或译文"), "  Hello  ");
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(screen.getByText(/匹配「Hello」共 1 条/)).toBeInTheDocument();
    });
    expect(screen.queryByText("源：Save often.")).not.toBeInTheDocument();
    const queried = calls.find(
      ([method, params]) =>
        method === "tm.list" && (params as { query?: string }).query,
    );
    expect(queried?.[1]).toEqual({
      projectId: "p1",
      memoryId: "tm-p1",
      limit: 50,
      offset: 0,
      query: "Hello",
    });
  });

  it("edits source and target through tm.update", async () => {
    const { calls } = installMemoryBridge(twoMountState());
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
    const state = twoMountState();
    const { bridge } = installMemoryBridge(state);
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((method: string, params: unknown) => {
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
      return original(method, params);
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
    const { calls } = installMemoryBridge(twoMountState());
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

    // Backing out leaves the entry alone. The delete confirm's 取消 sits in
    // the entries stack — the footer 关闭 and mount rows have other labels.
    const entryCard = screen
      .getByText("源：Save often.")
      .closest(".match-card")!;
    await userEvent.click(
      within(entryCard as HTMLElement).getByRole("button", { name: "取消" }),
    );
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
    expect(screen.getByText("记忆库「主记忆库」共 1 条")).toBeInTheDocument();
    const deleteCall = calls.find(([method]) => method === "tm.delete");
    expect(deleteCall?.[1]).toEqual({ entryId: "e2" });

    // The manage surface must never confirm segments or export files.
    const forbidden = ["segment.confirm", "tm.export", "document.export"];
    expect(calls.filter(([method]) => forbidden.includes(method))).toEqual([]);
  });

  it("renames a memory through memory.rename with the stored baseRevision", async () => {
    const { calls } = installMemoryBridge(twoMountState());
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "重命名记忆库 领域库" }),
    );
    const field = screen.getByLabelText("重命名记忆库 领域库");
    expect(field).toHaveValue("领域库");
    await userEvent.clear(field);
    await userEvent.type(field, "  领域库 v2  ");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "已重命名为：领域库 v2",
      );
    });
    // The mount row and the entries picker pick up the new name.
    expect(
      screen.getByRole("button", { name: "卸载记忆库 领域库 v2" }),
    ).toBeInTheDocument();
    const rename = calls.find(([method]) => method === "memory.rename");
    expect(rename?.[1]).toEqual({
      memoryId: "m-b",
      name: "领域库 v2",
      baseRevision: 1,
    });
  });

  it("deletes an unmounted memory only through the honest two-step cascade", async () => {
    const state = twoMountState();
    state.memories.push(memory("m-old", "旧库"));
    state.entries.push(entry("e9", "m-old", "Legacy.", "遗留。"));
    const { calls } = installMemoryBridge(state);
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByLabelText("挂载已有记忆库")).toBeInTheDocument();
    });
    await userEvent.selectOptions(
      screen.getByLabelText("挂载已有记忆库"),
      "m-old",
    );

    // First press arms the plain confirm; nothing is deleted yet.
    await userEvent.click(
      screen.getByRole("button", { name: "删除记忆库 旧库" }),
    );
    expect(screen.getByText("确认删除记忆库「旧库」？")).toBeInTheDocument();
    expect(calls.some(([method]) => method === "memory.delete")).toBe(false);

    // The confirm never cascades: the engine refuses because entries
    // remain, and its message (with the real count) is shown verbatim.
    await userEvent.click(
      screen.getByRole("button", { name: "确认删除记忆库 旧库" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/memory still holds 1 TM entries/),
      ).toBeInTheDocument();
    });
    const first = calls.find(([method]) => method === "memory.delete");
    expect(first?.[1]).toEqual({ memoryId: "m-old" });

    // Only the explicit 连同条目删除 retries with the cascade.
    await userEvent.click(
      screen.getByRole("button", { name: "连同条目删除记忆库 旧库" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "已删除记忆库「旧库」（连同 1 条条目）",
      );
    });
    const cascade = calls.filter(([method]) => method === "memory.delete");
    expect(cascade[1]?.[1]).toEqual({ memoryId: "m-old", deleteEntries: true });
    // The memory left the attach choices for good.
    expect(screen.queryByText("旧库")).not.toBeInTheDocument();
  });

  it("shows the factual language-pair note for mismatched memories, never a refusal", async () => {
    const state = twoMountState();
    const german = memory("m-de", "德语库");
    german.targetLocale = "de-DE";
    state.memories.push(german);
    const { calls } = installMemoryBridge(state);
    render(<TmManageDialog open project={project} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByLabelText("挂载已有记忆库")).toBeInTheDocument();
    });
    await userEvent.selectOptions(
      screen.getByLabelText("挂载已有记忆库"),
      "m-de",
    );
    await userEvent.click(screen.getByRole("button", { name: "挂载" }));
    // The attach succeeded — soft warning only — and the status carries
    // the factual pair note.
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "已挂载：德语库（只读，语言对 en-US → de-DE（项目 en-US → zh-CN））",
      );
    });
    expect(calls.some(([method]) => method === "memory.attach")).toBe(true);
    // The mounted row keeps a persistent factual badge; matching-pair
    // mounts carry none.
    expect(
      screen.getByText("语言对 en-US → de-DE（项目 en-US → zh-CN）"),
    ).toBeInTheDocument();
  });

  it("renders nothing when closed and closes via the footer button", async () => {
    installMemoryBridge(twoMountState());
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
