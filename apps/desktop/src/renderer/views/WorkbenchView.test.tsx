import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Project, Segment } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
  MenuCommand,
} from "../../shared/desktop-api.js";

import { WorkbenchView } from "./WorkbenchView.js";

const PROJECT: Project = {
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

const DOCUMENT = {
  id: "d1",
  projectId: "p1",
  name: "guide.txt",
  relativePath: "guide.txt",
  format: "txt",
  filterId: "txt",
  status: "ready",
  currentVersion: 1,
  segmentCount: 1,
  degradation: [],
  sourceSha256: "sha",
  revision: 1,
  importedAtMs: 1,
  updatedAtMs: 1,
};

const SEGMENT: Segment = {
  id: "s1",
  documentId: "d1",
  ordinal: 0,
  structuralPath: "p:0",
  sourceText: "The retention period is 30 days.",
  targetText: "文件的为 30 天。",
  state: "draft",
  revision: 1,
  sourceHash: "hash",
  contextHash: "context",
  updatedAtMs: 1,
};

const TERMBASE = {
  id: "tb1",
  name: "产品术语",
  sourceLocale: "en-US",
  domain: null,
  writable: true,
  revision: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
};

const MOUNT = {
  projectId: "p1",
  termbaseId: "tb1",
  priority: 0,
  enabled: true,
  writable: true,
  revision: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
};

const TERM_MATCH = {
  entryId: "te1",
  termbaseId: "tb1",
  sourceTerm: "retention period",
  start: 4,
  end: 20,
  translations: [
    {
      id: "tt1",
      entryId: "te1",
      locale: "zh-CN",
      term: "保留期",
      preferred: true,
      forbidden: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    },
  ],
};

/**
 * Sentinel a handler can return to make the bridge answer with an engine
 * error response instead of a result.
 */
class EngineFailure {
  constructor(
    public readonly code: string,
    public readonly message: string,
  ) {}
}

/** Engine responses shared by the tests; per-test handlers layer on top. */
function baseHandlers(): Record<string, (params: unknown) => unknown> {
  return {
    "ai.status": () => ({ configured: false }),
    "document.list": () => ({ documents: [DOCUMENT] }),
    "segment.list": () => ({ segments: [SEGMENT] }),
    "qa.list": () => ({ issues: [] }),
    "tm.lookup": () => ({ matches: [], totalMatches: 0 }),
    "termbase.list": () => ({ termbases: [TERMBASE], mounts: [MOUNT] }),
    "term.lookup": () => ({ matches: [TERM_MATCH] }),
  };
}

interface Bridge {
  invoke: ReturnType<typeof vi.fn>;
  chooseExportPath: ReturnType<typeof vi.fn>;
  /** Fires the listener the workbench registered via onMenuCommand. */
  emitMenuCommand: (command: MenuCommand) => void;
}

function installBridge(
  handlers: Record<string, (params: unknown) => unknown>,
): Bridge {
  const spy = vi.fn(
    (method: string, params: unknown): Promise<EngineInvokeResponse> => {
      const handler = handlers[method];
      if (!handler) {
        return Promise.resolve({
          ok: false,
          error: { code: "notFound", message: `no handler for ${method}` },
        });
      }
      const value = handler(params);
      if (value instanceof EngineFailure) {
        return Promise.resolve({
          ok: false,
          error: { code: value.code, message: value.message },
        });
      }
      return Promise.resolve({ ok: true, result: value });
    },
  );
  const chooseExportPath = vi.fn((): Promise<string | null> => {
    return Promise.resolve(null);
  });
  let menuListener: ((command: MenuCommand) => void) | null = null;
  const api: Partial<DesktopApi> = {
    invoke: spy,
    chooseExportPath,
    onMenuCommand: (listener) => {
      menuListener = listener;
      return () => {
        menuListener = null;
      };
    },
    setMenuContext: vi.fn(),
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return {
    invoke: spy,
    chooseExportPath,
    emitMenuCommand: (command) => {
      if (!menuListener) {
        throw new Error("workbench did not subscribe to menu commands");
      }
      menuListener(command);
    },
  };
}

describe("WorkbenchView term insertion", () => {
  it("inserts a dock term at the grid editor caret without saving", async () => {
    const { invoke } = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    // The editor re-seeds from the saved target in an effect after mounting.
    await waitFor(() => {
      expect(editor.value).toBe("文件的为 30 天。");
    });
    // Caret after 文件的, i.e. in the middle of the unsaved editor text.
    editor.setSelectionRange(3, 3);
    await userEvent.click(screen.getByRole("button", { name: "术语" }));
    await userEvent.click(await screen.findByRole("button", { name: "插入" }));
    expect(editor.value).toBe("文件的保留期为 30 天。");
    expect(editor.selectionStart).toBe(6);
    expect(editor.selectionEnd).toBe(6);
    // Focus returns to the editor so Ctrl+Enter confirm still works.
    expect(document.activeElement).toBe(editor);
    // Insertion edits the draft in place; nothing is saved to the engine.
    expect(
      invoke.mock.calls.some(([method]) => method === "segment.update"),
    ).toBe(false);
  });

  it("appends to the saved draft only when the grid editor is unmounted", async () => {
    let updateParams: unknown = null;
    const handlers = baseHandlers();
    handlers["segment.update"] = (params) => {
      updateParams = params;
      return {
        segment: {
          ...SEGMENT,
          targetText: "文件的为 30 天。保留期",
          revision: 2,
        },
      };
    };
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // Filter the active row out of the grid so no editor is mounted.
    await userEvent.type(screen.getByLabelText("按文本筛选"), "无匹配文本");
    await waitFor(() => {
      expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "术语" }));
    await userEvent.click(await screen.findByRole("button", { name: "插入" }));
    await waitFor(() => {
      expect(updateParams).not.toBeNull();
    });
    expect(updateParams).toMatchObject({
      segmentId: "s1",
      targetText: "文件的为 30 天。保留期",
      baseRevision: 1,
    });
  });
});

describe("WorkbenchView application menu commands", () => {
  it("reports document-open state for honest menu enablement", async () => {
    installBridge(baseHandlers());
    const onDocumentOpenChange = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
        onDocumentOpenChange={onDocumentOpenChange}
      />,
    );
    // Before the document list loads there is nothing open…
    expect(onDocumentOpenChange).toHaveBeenCalledWith(false);
    // …and once the first document loads the menu can enable export/preview.
    await waitFor(() => {
      expect(onDocumentOpenChange).toHaveBeenLastCalledWith(true);
    });
  });

  it("switches dock tabs through the same setTab path as the dock buttons", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    act(() => {
      bridge.emitMenuCommand("show-dock-qa");
    });
    expect(
      screen.getByRole("button", { name: "运行数字 QA" }),
    ).toBeInTheDocument();
    act(() => {
      bridge.emitMenuCommand("show-dock-term");
    });
    expect(await screen.findByRole("button", { name: "插入" })).toBeVisible();
  });

  it("opens the import dialog from the menu like the 导入 button", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    act(() => {
      bridge.emitMenuCommand("import-document");
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("导入文档");
  });

  it("routes menu export through the same chooseExportPath dialog", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    act(() => {
      bridge.emitMenuCommand("export-document");
    });
    // Same suggested name as the 导出译文 button; the user cancelled (null),
    // so no engine export call happens.
    await waitFor(() => {
      expect(bridge.chooseExportPath).toHaveBeenCalledWith(
        "guide-translated.txt",
      );
    });
    expect(
      bridge.invoke.mock.calls.some(([method]) => method === "document.export"),
    ).toBe(false);
  });

  it("seeds concordance from the live selection like the F3 chord", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    await waitFor(() => {
      expect(editor.value).toBe("文件的为 30 天。");
    });
    editor.focus();
    editor.setSelectionRange(0, 3);
    act(() => {
      bridge.emitMenuCommand("open-concordance");
    });
    expect(screen.getByLabelText(/检索词/)).toHaveValue("文件的");
  });

  it("confirms the live editor draft and reports honestly when none is mounted", async () => {
    const handlers = baseHandlers();
    let confirmParams: unknown = null;
    handlers["segment.confirm"] = (params) => {
      confirmParams = params;
      return {
        segment: { ...SEGMENT, state: "confirmed", revision: 2 },
        propagated: [],
      };
    };
    const bridge = installBridge(handlers);
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    // Wait for the editor to re-seed from the saved target: the draft then
    // matches, so confirm goes straight to segment.confirm (no update).
    await waitFor(() => {
      expect(editor.value).toBe("文件的为 30 天。");
    });
    act(() => {
      bridge.emitMenuCommand("confirm-segment");
    });
    await waitFor(() => {
      expect(confirmParams).toMatchObject({ segmentId: "s1" });
    });
    // Filter the active row out so no editor is mounted: the command must
    // not guess, it reports instead.
    await userEvent.type(screen.getByLabelText("按文本筛选"), "无匹配文本");
    await waitFor(() => {
      expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    });
    act(() => {
      bridge.emitMenuCommand("confirm-segment");
    });
    expect(onStatusMessage).toHaveBeenCalledWith(
      "没有正在编辑的句段，无法确认",
    );
  });

  it("focuses the segment filter via the menu command and the Ctrl+F chord", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const filter = screen.getByLabelText("按文本筛选");
    act(() => {
      bridge.emitMenuCommand("focus-filter");
    });
    expect(document.activeElement).toBe(filter);
    // The chord itself is renderer-owned: the menu only displays it.
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(filter);
  });
});

describe("WorkbenchView engine-down honesty", () => {
  it("keeps a persistent unsaved alert when the engine never acks a draft write", async () => {
    const handlers = baseHandlers();
    let updateResponse: unknown = new EngineFailure(
      "engineDown",
      "engine process is not running",
    );
    handlers["segment.update"] = () => updateResponse;
    installBridge(handlers);
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    await waitFor(() => {
      expect(editor.value).toBe("文件的为 30 天。");
    });

    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    // A blocking-style inline alert, not just a statusbar toast.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("句段 #1 的草稿未被引擎确认写入");
    expect(alert).toHaveTextContent("engine process is not running");
    // The editor still holds the user's text; nothing was lost or reset.
    expect(editor.value).toBe("文件的为 30 天。");
    expect(onStatusMessage).toHaveBeenCalledWith(
      "句段 #1 草稿未保存：引擎未确认写入",
    );
    // The segment must NOT be presented as saved anywhere.
    expect(onStatusMessage).not.toHaveBeenCalledWith("句段 #1 草稿已保存");

    // Once the engine acks a later save of the same segment, the alert goes.
    updateResponse = {
      segment: { ...SEGMENT, revision: 2 },
    };
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(onStatusMessage).toHaveBeenCalledWith("句段 #1 草稿已保存");
  });

  it("flags an unacked confirm without pretending it reached the TM", async () => {
    const handlers = baseHandlers();
    handlers["segment.confirm"] = () =>
      new EngineFailure("timeout", "segment.confirm timed out");
    installBridge(handlers);
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    await waitFor(() => {
      expect(editor.value).toBe("文件的为 30 天。");
    });

    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("句段 #1 的确认未被引擎确认写入");
    expect(onStatusMessage).toHaveBeenCalledWith(
      "句段 #1 未确认：引擎未确认写入",
    );
    expect(
      onStatusMessage.mock.calls.some(([message]) =>
        String(message).includes("已确认并写入 TM"),
      ),
    ).toBe(false);
  });

  it("resyncs documents and segments from the engine after a crash recovery", async () => {
    const { invoke } = installBridge(baseHandlers());
    const onStatusMessage = vi.fn();
    const view = render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const callsBefore = invoke.mock.calls.filter(
      ([method]) => method === "segment.list",
    ).length;

    // Engine crashes (gate blocks the UI at App level), then recovers.
    view.rerender(
      <WorkbenchView
        project={PROJECT}
        engineState="restarting"
        onStatusMessage={onStatusMessage}
      />,
    );
    view.rerender(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );

    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith(
        "引擎已恢复，文档与句段已从引擎重新同步",
      );
    });
    const callsAfter = invoke.mock.calls.filter(
      ([method]) => method === "segment.list",
    ).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
    expect(
      invoke.mock.calls.filter(([method]) => method === "document.list").length,
    ).toBeGreaterThan(1);
  });
});

describe("WorkbenchView document removal", () => {
  const DOCUMENT_2 = {
    ...DOCUMENT,
    id: "d2",
    name: "second.txt",
    segmentCount: 1,
  };
  const SEGMENT_2: Segment = {
    ...SEGMENT,
    id: "s2",
    documentId: "d2",
    sourceText: "Second file text.",
    targetText: "第二个文档。",
  };

  /** Bridge whose document list shrinks when document.remove is called. */
  function installRemoveBridge(initial: Array<typeof DOCUMENT>) {
    const handlers = baseHandlers();
    let documents = [...initial];
    const removeCalls: unknown[] = [];
    handlers["document.list"] = () => ({ documents });
    handlers["segment.list"] = (params) => ({
      segments:
        (params as { documentId: string }).documentId === "d2"
          ? [SEGMENT_2]
          : [SEGMENT],
    });
    handlers["document.remove"] = (params) => {
      removeCalls.push(params);
      const id = (params as { documentId: string }).documentId;
      const removed = documents.find((item) => item.id === id);
      if (!removed) {
        return new EngineFailure("notFound", `document ${id}`);
      }
      documents = documents.filter((item) => item.id !== id);
      return {
        document: removed,
        removedSegments: 1,
        removedQaIssues: 0,
        managedCopyDeleted: true,
      };
    };
    const bridge = installBridge(handlers);
    return { bridge, removeCalls };
  }

  it("removes only after the two-step confirm and selects the neighbor", async () => {
    const { removeCalls } = installRemoveBridge([DOCUMENT, DOCUMENT_2]);
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    await waitFor(() => {
      expect(editor.value).toBe("文件的为 30 天。");
    });

    // First click only arms the confirm; nothing reaches the engine yet.
    await userEvent.click(
      screen.getByRole("button", { name: "移除 guide.txt" }),
    );
    expect(removeCalls).toHaveLength(0);
    expect(
      screen.getByRole("group", { name: "确认移除 guide.txt" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => {
      expect(removeCalls).toHaveLength(1);
    });
    expect(removeCalls[0]).toMatchObject({ documentId: "d1" });

    // The removed document leaves the list and its neighbor opens.
    await waitFor(() => {
      expect(screen.queryByText("guide.txt")).not.toBeInTheDocument();
    });
    const nextEditor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    await waitFor(() => {
      expect(nextEditor.value).toBe("第二个文档。");
    });
    expect(onStatusMessage).toHaveBeenCalledWith(
      "已移除「guide.txt」：删除 1 个句段、0 条 QA 记录；项目 TM、术语库与原始文件保留",
    );
  });

  it("取消 disarms the pending remove without calling the engine", async () => {
    const { removeCalls } = installRemoveBridge([DOCUMENT]);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(
      screen.getByRole("button", { name: "移除 guide.txt" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(removeCalls).toHaveLength(0);
    // Back to the armed-off state; the document is still listed and open.
    expect(
      screen.getByRole("button", { name: "移除 guide.txt" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("句段 1 译文")).toBeInTheDocument();
  });

  it("shows the empty states after removing the last document", async () => {
    const { removeCalls } = installRemoveBridge([DOCUMENT]);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(
      screen.getByRole("button", { name: "移除 guide.txt" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => {
      expect(removeCalls).toHaveLength(1);
    });
    // No document is open anymore: the rail and the grid both say so, and
    // the import path stays available.
    expect(await screen.findByText("暂无文档")).toBeInTheDocument();
    expect(screen.getByText("选择或导入一个文档")).toBeInTheDocument();
    expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入" })).toBeEnabled();
  });
});

describe("WorkbenchView export overwrite confirm", () => {
  /** Bridge where the engine blocks the plain export but honors overwrite. */
  function installExportBridge() {
    const handlers = baseHandlers();
    const exportCalls: unknown[] = [];
    handlers["document.export"] = (params) => {
      exportCalls.push(params);
      if ((params as { overwrite?: boolean }).overwrite !== true) {
        return new EngineFailure(
          "exportBlocked",
          "output path already exists: /tmp/out.txt",
        );
      }
      return {
        outputPath: "/tmp/out.txt",
        translatedSegments: 1,
        degradation: [],
      };
    };
    const bridge = installBridge(handlers);
    bridge.chooseExportPath.mockResolvedValue("/tmp/out.txt");
    return { bridge, exportCalls };
  }

  it("retries a blocked export with overwrite only after 覆盖", async () => {
    const { exportCalls } = installExportBridge();
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "导出译文" }));

    // The refusal surfaces as an explicit question, not a failure toast.
    const prompt = await screen.findByRole("alertdialog", {
      name: "目标已存在，要覆盖吗？",
    });
    expect(prompt).toHaveTextContent("/tmp/out.txt");
    expect(exportCalls).toHaveLength(1);
    expect(exportCalls[0]).toMatchObject({
      documentId: "d1",
      outputPath: "/tmp/out.txt",
    });
    expect(exportCalls[0]).not.toHaveProperty("overwrite");
    expect(
      onStatusMessage.mock.calls.some(([message]) =>
        String(message).includes("导出失败"),
      ),
    ).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "覆盖" }));
    await waitFor(() => {
      expect(exportCalls).toHaveLength(2);
    });
    expect(exportCalls[1]).toMatchObject({
      documentId: "d1",
      outputPath: "/tmp/out.txt",
      overwrite: true,
    });
    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith(
        "导出完成（已覆盖）：/tmp/out.txt（1 个已译单元）",
      );
    });
    expect(
      screen.queryByRole("alertdialog", { name: "目标已存在，要覆盖吗？" }),
    ).not.toBeInTheDocument();
  });

  it("取消 sends no overwrite call and leaves the file untouched", async () => {
    const { exportCalls } = installExportBridge();
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "导出译文" }));
    await screen.findByRole("alertdialog", {
      name: "目标已存在，要覆盖吗？",
    });

    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("alertdialog", { name: "目标已存在，要覆盖吗？" }),
    ).not.toBeInTheDocument();
    // Only the refused no-clobber call ever reached the engine.
    expect(exportCalls).toHaveLength(1);
    expect(onStatusMessage).toHaveBeenCalledWith(
      "已取消导出：保留现有文件，未做任何修改",
    );
  });
});

describe("WorkbenchView QA waive", () => {
  const QA_ISSUE = {
    id: "issue-1",
    segmentId: "s1",
    ruleId: "qa.number-mismatch",
    severity: "error",
    status: "open",
    message: "数字不一致：源 30 / 译 40",
    fingerprint: "fp-1",
    evidence: {
      sourceNumbers: ["30"],
      targetNumbers: ["40"],
      sourceValues: [],
      targetValues: [],
      relatedSegmentIds: [],
    },
    waiveNote: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  };

  it("忽略/恢复 go through qa.waive and never confirm or write TM", async () => {
    const handlers = baseHandlers();
    handlers["qa.list"] = () => ({ issues: [QA_ISSUE], total: 1 });
    let waiveParams: unknown = null;
    handlers["qa.waive"] = (params) => {
      waiveParams = params;
      return { issue: { ...QA_ISSUE, status: "waived", updatedAtMs: 2 } };
    };
    const bridge = installBridge(handlers);
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "QA" }));
    expect(await screen.findByText("质量检查（未解决 1）")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "忽略" }));
    await waitFor(() => {
      expect(waiveParams).toEqual({ issueId: "issue-1", waived: true });
    });
    // The open count drops honestly and the card says what really happened:
    // parked by a human, not fixed, nothing confirmed, nothing in TM.
    expect(await screen.findByText("质量检查（未解决 0）")).toBeInTheDocument();
    expect(screen.getByText("已忽略")).toBeInTheDocument();
    expect(
      screen.getByText(/已忽略：问题仍存在，未确认句段、未写入 TM/),
    ).toBeInTheDocument();
    expect(onStatusMessage).toHaveBeenCalledWith(
      "已忽略 QA 问题：问题并未修复，未确认句段、未写入 TM",
    );
    // Red line: waiving is not confirming. No confirm and no TM/segment
    // write may ever ride along with a waive.
    const methods = bridge.invoke.mock.calls.map(
      ([method]) => method as string,
    );
    for (const forbidden of [
      "segment.confirm",
      "segment.update",
      "tm.update",
      "tm.import",
    ]) {
      expect(methods).not.toContain(forbidden);
    }

    // 恢复 flips the same issue back to open through the same endpoint.
    handlers["qa.waive"] = (params) => {
      waiveParams = params;
      return { issue: { ...QA_ISSUE, updatedAtMs: 3 } };
    };
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    await waitFor(() => {
      expect(waiveParams).toEqual({ issueId: "issue-1", waived: false });
    });
    expect(await screen.findByText("质量检查（未解决 1）")).toBeInTheDocument();
    expect(onStatusMessage).toHaveBeenCalledWith("已恢复 QA 问题为未解决");
  });

  it("keeps the issue open and reports honestly when qa.waive fails", async () => {
    const handlers = baseHandlers();
    handlers["qa.list"] = () => ({ issues: [QA_ISSUE], total: 1 });
    handlers["qa.waive"] = () =>
      new EngineFailure("engineDown", "engine process is not running");
    installBridge(handlers);
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "QA" }));
    await userEvent.click(await screen.findByRole("button", { name: "忽略" }));

    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith(
        expect.stringContaining("忽略失败"),
      );
    });
    // The issue must not be presented as waived anywhere.
    expect(screen.getByText("质量检查（未解决 1）")).toBeInTheDocument();
    expect(screen.getByText("未解决")).toBeInTheDocument();
    expect(screen.queryByText("已忽略")).not.toBeInTheDocument();
    expect(
      onStatusMessage.mock.calls.some(([message]) =>
        String(message).startsWith("已忽略"),
      ),
    ).toBe(false);
    // The button unlocks so the user can retry once the engine is back.
    expect(screen.getByRole("button", { name: "忽略" })).toBeEnabled();
  });
});
