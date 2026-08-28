import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Project, QaIssue, Segment } from "@translunar/contracts";
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
    /** Structured `RpcError.data`, e.g. the QA gate refusal payload. */
    public readonly data?: unknown,
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
          error: { code: value.code, message: value.message, data: value.data },
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
    // The AI dock's Agent section subscribes to step notifications on
    // mount; the tests never emit any.
    onNotification: () => () => {},
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
    // Insertion edits the draft in place; no synchronous save happens (the
    // debounced Trados-style auto-save persists it after the pause).
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
    // The ribbon carries its own 运行 QA button, so dock assertions scope
    // to the dock element.
    const dock = within(
      document.querySelector(".workbench__dock") as HTMLElement,
    );
    act(() => {
      bridge.emitMenuCommand("show-dock-qa");
    });
    expect(dock.getByRole("button", { name: "运行 QA" })).toBeInTheDocument();
    act(() => {
      bridge.emitMenuCommand("show-dock-term");
    });
    expect(await dock.findByRole("button", { name: "插入" })).toBeVisible();
  });

  it("merges TM lookup and 检索 into the 记忆 dock, 辅助 and Agent into AI", async () => {
    installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // Four dock tabs, no separate 检索/Agent tabs (6→4, PRD §3.7).
    for (const label of ["记忆", "术语", "QA", "AI"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // Default 记忆 tab shows both the TM lookup panel and the 检索 area.
    expect(screen.getByText("翻译记忆")).toBeInTheDocument();
    expect(screen.getByLabelText(/检索词/)).toBeInTheDocument();
    // AI tab stacks 辅助 and Agent sections.
    await userEvent.click(screen.getByRole("button", { name: "AI" }));
    expect(screen.getByText("AI 辅助")).toBeInTheDocument();
    expect(screen.getByText(/Agent/)).toBeInTheDocument();
  });

  it("switches docks with Ctrl+1..4 outside the editor", async () => {
    installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const dock = within(
      document.querySelector(".workbench__dock") as HTMLElement,
    );
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    expect(dock.getByRole("button", { name: "运行 QA" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    expect(await dock.findByRole("button", { name: "插入" })).toBeVisible();
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(screen.getByText("翻译记忆")).toBeInTheDocument();
  });

  it("applies the numbered TM match as a draft on Ctrl+数字 in the editor", async () => {
    const handlers = baseHandlers();
    handlers["tm.lookup"] = () => ({
      matches: [
        {
          entry: {
            id: "tm-1",
            memoryId: "m1",
            sourceHash: "hash",
            sourceText: "The retention period is 30 days.",
            targetText: "保留期为 30 天。",
            originProjectId: "p1",
            originDocumentId: "d1",
            originSegmentId: "s1",
            confirmedAtMs: 1,
          },
          score: 100,
          grade: "exact",
        },
      ],
      totalMatches: 1,
    });
    let updateParams: unknown = null;
    handlers["segment.update"] = (params) => {
      updateParams = params;
      return {
        segment: { ...SEGMENT, targetText: "保留期为 30 天。", revision: 2 },
      };
    };
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
      expect(screen.getByText("应用为草稿")).toBeInTheDocument();
    });
    fireEvent.keyDown(editor, { key: "1", ctrlKey: true });
    await waitFor(() => {
      expect(updateParams).toMatchObject({
        segmentId: "s1",
        targetText: "保留期为 30 天。",
        // The apply stamps the real lookup grade and score as the origin.
        origin: { kind: "tmExact", score: 100 },
      });
    });
    expect(onStatusMessage).toHaveBeenCalledWith(
      "已应用第 1 条记忆匹配（100%）为草稿",
    );
    // A number with no matching hit reports honestly and writes nothing.
    fireEvent.keyDown(editor, { key: "5", ctrlKey: true });
    expect(onStatusMessage).toHaveBeenCalledWith("没有第 5 条记忆匹配");
  });

  it("stamps the fuzzy grade and score as the origin on dock apply", async () => {
    const handlers = baseHandlers();
    handlers["tm.lookup"] = () => ({
      matches: [
        {
          entry: {
            id: "tm-1",
            memoryId: "m1",
            sourceHash: "other-hash",
            sourceText: "The retention period is 45 days.",
            targetText: "保留期为 45 天。",
            originProjectId: "p1",
            originDocumentId: "d1",
            originSegmentId: "s1",
            confirmedAtMs: 1,
          },
          score: 85,
          grade: "fuzzy",
        },
      ],
      totalMatches: 1,
    });
    let updateParams: unknown = null;
    handlers["segment.update"] = (params) => {
      updateParams = params;
      return {
        segment: { ...SEGMENT, targetText: "保留期为 45 天。", revision: 2 },
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
    const apply = await screen.findByText("应用为草稿");
    fireEvent.click(apply);
    await waitFor(() => {
      expect(updateParams).toMatchObject({
        segmentId: "s1",
        targetText: "保留期为 45 天。",
        origin: { kind: "tmFuzzy", score: 85 },
      });
    });
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

  it("focuses the segment filter via the menu command and the Ctrl+Shift+F chord", async () => {
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
    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(filter);
  });

  it("toggle-left / toggle-right collapse the rails like the splitter chevrons", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const explorer = document.querySelector(
      ".workbench__explorer",
    ) as HTMLElement;
    const dock = document.querySelector(".workbench__dock") as HTMLElement;
    expect(explorer).not.toHaveAttribute("data-collapsed");
    expect(dock).not.toHaveAttribute("data-collapsed");

    act(() => {
      bridge.emitMenuCommand("toggle-left");
    });
    expect(explorer).toHaveAttribute("data-collapsed");
    act(() => {
      bridge.emitMenuCommand("toggle-left");
    });
    expect(explorer).not.toHaveAttribute("data-collapsed");

    act(() => {
      bridge.emitMenuCommand("toggle-right");
    });
    expect(dock).toHaveAttribute("data-collapsed");
    act(() => {
      bridge.emitMenuCommand("toggle-right");
    });
    expect(dock).not.toHaveAttribute("data-collapsed");
  });

  it("archive-project archives only after the explicit confirm", async () => {
    const handlers = baseHandlers();
    let archiveParams: unknown = null;
    handlers["project.archive"] = (params) => {
      archiveParams = params;
      return { ...PROJECT, lifecycle: "archived", revision: 2 };
    };
    const bridge = installBridge(handlers);
    const onProjectUpdated = vi.fn();
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    act(() => {
      bridge.emitMenuCommand("archive-project");
    });
    // 取消 leaves the project untouched.
    const dialog = screen.getByRole("dialog", { name: "归档项目" });
    expect(dialog).toHaveTextContent("归档「演示项目」。");
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(archiveParams).toBeNull();

    // 确认归档 runs the same project.archive RPC as the settings dialog.
    act(() => {
      bridge.emitMenuCommand("archive-project");
    });
    await userEvent.click(screen.getByRole("button", { name: "确认归档" }));
    await waitFor(() => {
      expect(archiveParams).toEqual({ projectId: "p1", archived: true });
    });
    expect(onProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle: "archived" }),
    );
    expect(onStatusMessage).toHaveBeenCalledWith("项目已归档");
  });

  it("toggle-gate flips the stored QA export gate through qa.profile.update", async () => {
    const handlers = baseHandlers();
    const profile = {
      baseProfileId: "default",
      severityOverrides: {},
      settings: {},
      blockExportOnError: false,
      revision: 3,
    };
    handlers["qa.profile.get"] = () => profile;
    let updateParams: unknown = null;
    handlers["qa.profile.update"] = (params) => {
      updateParams = params;
      return { ...profile, blockExportOnError: true, revision: 4 };
    };
    const bridge = installBridge(handlers);
    const onExportGateChange = vi.fn();
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
        onExportGateChange={onExportGateChange}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // The mount fetch reports the stored gate for the menu checkbox.
    await waitFor(() => {
      expect(onExportGateChange).toHaveBeenLastCalledWith(false);
    });
    act(() => {
      bridge.emitMenuCommand("toggle-gate");
    });
    // The write is based on the refetched revision, never a stale view.
    await waitFor(() => {
      expect(updateParams).toEqual({
        projectId: "p1",
        baseRevision: 3,
        blockExportOnError: true,
      });
    });
    expect(onStatusMessage).toHaveBeenCalledWith("已开启导出前 QA 检查");
    await waitFor(() => {
      expect(onExportGateChange).toHaveBeenLastCalledWith(true);
    });
  });

  it("QA menu commands report honestly with no matching finding", async () => {
    const bridge = installBridge(baseHandlers());
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // baseHandlers answers qa.list with zero issues: every QA command on
    // the active segment reports instead of pretending.
    act(() => {
      bridge.emitMenuCommand("waive");
    });
    expect(onStatusMessage).toHaveBeenLastCalledWith(
      "当前句段没有未解决的 QA 问题",
    );
    act(() => {
      bridge.emitMenuCommand("waive-rule");
    });
    expect(onStatusMessage).toHaveBeenLastCalledWith(
      "当前句段没有未解决的 QA 问题",
    );
    act(() => {
      bridge.emitMenuCommand("restore");
    });
    expect(onStatusMessage).toHaveBeenLastCalledWith(
      "当前句段没有已忽略的 QA 问题",
    );
    act(() => {
      bridge.emitMenuCommand("apply-fix");
    });
    expect(onStatusMessage).toHaveBeenLastCalledWith(
      "当前句段没有可应用的修复",
    );
    // Nothing was written.
    expect(
      bridge.invoke.mock.calls.some(
        ([method]) => method === "qa.waive" || method === "segment.update",
      ),
    ).toBe(false);
  });

  it("open-term-manage and open-tm-manage open the existing surfaces", async () => {
    const bridge = installBridge(baseHandlers());
    const onOpenSettings = vi.fn();
    const onOpenTmManage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenTmManage={onOpenTmManage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    act(() => {
      bridge.emitMenuCommand("open-term-manage");
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    act(() => {
      bridge.emitMenuCommand("open-tm-manage");
    });
    expect(onOpenTmManage).toHaveBeenCalledTimes(1);
  });

  it("ai-translate switches to the AI dock and hands the request to the panel", async () => {
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
      bridge.emitMenuCommand("ai-translate");
    });
    // The AI dock opens; ai.status is unconfigured so the panel shows its
    // own honest refusal instead of a fake run.
    expect(screen.getByRole("button", { name: "AI" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      bridge.invoke.mock.calls.some(([method]) => method === "ai.assist.start"),
    ).toBe(false);
  });

  it("write commands on a locked segment report instead of firing a doomed RPC", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({
      segments: [{ ...SEGMENT, locked: true }],
    });
    const bridge = installBridge(handlers);
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    // Locked row: no editor mounts; the ribbon offers 解锁 instead.
    await screen.findByRole("button", { name: "解锁句段" });
    for (const command of [
      "insert-tm",
      "insert-term",
      "copy-source",
      "clear-target",
    ] as const) {
      act(() => {
        bridge.emitMenuCommand(command);
      });
      expect(onStatusMessage).toHaveBeenLastCalledWith("句段 #1 已锁定");
    }
    // The engine's lock shield was never provoked: nothing was written and
    // no on-demand term lookup ran.
    expect(
      bridge.invoke.mock.calls.some(
        ([method]) => method === "segment.update" || method === "term.lookup",
      ),
    ).toBe(false);
  });
});

describe("WorkbenchView command palette", () => {
  it("opens with Ctrl+K and runs a command through the same dispatch", async () => {
    installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const palette = screen.getByRole("dialog", { name: "命令面板" });
    expect(palette).toBeInTheDocument();
    // Executing a dock command lands on the exact same setTab path the
    // menu and dock buttons use.
    await userEvent.type(screen.getByLabelText("搜索命令"), "QA 面板");
    await userEvent.click(screen.getByRole("option", { name: /QA 面板/ }));
    expect(
      screen.queryByRole("dialog", { name: "命令面板" }),
    ).not.toBeInTheDocument();
    expect(
      within(
        document.querySelector(".workbench__dock") as HTMLElement,
      ).getByRole("button", { name: "运行 QA" }),
    ).toBeInTheDocument();
  });

  it("opens via Ctrl+Shift+P and the menu command, listing document jumps", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    expect(
      screen.getByRole("dialog", { name: "命令面板" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /打开文档：guide.txt/ }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("搜索命令"), { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "命令面板" }),
    ).not.toBeInTheDocument();

    // The application menu item takes the identical path.
    act(() => {
      bridge.emitMenuCommand("open-command-palette");
    });
    expect(
      screen.getByRole("dialog", { name: "命令面板" }),
    ).toBeInTheDocument();
  });

  it("lists the translate/QA verbs with enablement read from live state", async () => {
    const handlers = baseHandlers();
    handlers["qa.profile.get"] = () => ({
      baseProfileId: "default",
      severityOverrides: {},
      settings: {},
      blockExportOnError: false,
      revision: 3,
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    // Write verbs enable on the unlocked active row.
    expect(
      screen.getByRole("option", { name: "插入记忆匹配" }),
    ).not.toHaveAttribute("aria-disabled");
    expect(
      screen.getByRole("option", { name: "复制源文到译文" }),
    ).not.toHaveAttribute("aria-disabled");
    // QA verbs stay honest: the row has no finding, so they disable.
    expect(
      screen.getByRole("option", { name: "忽略当前问题" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("option", { name: "恢复为未解决" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("option", { name: "应用引擎修复" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("option", { name: "归档项目" }),
    ).not.toHaveAttribute("aria-disabled");
    // The gate row names the direction it flips toward (stored: off).
    expect(
      await screen.findByRole("option", { name: "有错误时阻止导出（开启）" }),
    ).toBeInTheDocument();
  });

  it("disables the write verbs on a locked row like the ribbon buttons", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({
      segments: [{ ...SEGMENT, locked: true }],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "解锁句段" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    for (const label of [
      "插入记忆匹配",
      "插入术语",
      "复制源文到译文",
      "清空译文",
    ]) {
      expect(screen.getByRole("option", { name: label })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
  });

  it("折叠左栏 becomes 展开左栏 once the rail actually collapses", async () => {
    installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const explorer = document.querySelector(
      ".workbench__explorer",
    ) as HTMLElement;
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await userEvent.click(screen.getByRole("option", { name: "折叠左栏" }));
    expect(explorer).toHaveAttribute("data-collapsed");
    // Reopened, the same command reads the live rail state and offers 展开;
    // running it restores the rail (same round trip as the chevron).
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await userEvent.click(screen.getByRole("option", { name: "展开左栏" }));
    expect(explorer).not.toHaveAttribute("data-collapsed");
  });

  it("lists the shell rows (新建项目/快捷键/关于) and runs the shell handlers", async () => {
    installBridge(baseHandlers());
    const onNewProject = vi.fn();
    const onOpenShortcuts = vi.fn();
    const onOpenAbout = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
        onNewProject={onNewProject}
        onOpenShortcuts={onOpenShortcuts}
        onOpenAbout={onOpenAbout}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // All three shell rows are listed together; each click lands on the
    // exact handler the application menu branch calls.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      screen.getByRole("option", { name: "键盘快捷键…" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "关于 Translunar CAT" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "新建项目…" }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await userEvent.click(screen.getByRole("option", { name: "键盘快捷键…" }));
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("option", { name: "关于 Translunar CAT" }),
    );
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
  });
});

describe("WorkbenchView Trados-style editor flow", () => {
  it("auto-saves typing quietly and confirms with the fresh revision", async () => {
    const handlers = baseHandlers();
    const updateCalls: unknown[] = [];
    handlers["segment.update"] = (params) => {
      updateCalls.push(params);
      return {
        segment: {
          ...SEGMENT,
          targetText: (params as { targetText: string }).targetText,
          revision: 2,
        },
      };
    };
    const confirmCalls: unknown[] = [];
    handlers["segment.confirm"] = (params) => {
      confirmCalls.push(params);
      return {
        segment: {
          ...SEGMENT,
          targetText: "文件的为 30 天。补",
          state: "confirmed",
          revision: 3,
        },
        propagated: [],
      };
    };
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

    // Typing persists the draft after the pause — no button, no toast.
    await userEvent.type(editor, "补");
    await waitFor(
      () => {
        expect(updateCalls).toHaveLength(1);
      },
      { timeout: 4000 },
    );
    expect(updateCalls[0]).toMatchObject({
      segmentId: "s1",
      targetText: "文件的为 30 天。补",
      baseRevision: 1,
    });
    expect(onStatusMessage).not.toHaveBeenCalledWith("句段 #1 草稿已保存");

    // Ctrl+Enter after the auto-save ack: the text is already persisted,
    // so the confirm goes straight to segment.confirm with the revision
    // the auto-save produced — no duplicate segment.update.
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(confirmCalls).toHaveLength(1);
    });
    expect(confirmCalls[0]).toMatchObject({
      segmentId: "s1",
      baseRevision: 2,
    });
    expect(updateCalls).toHaveLength(1);
    expect(onStatusMessage).toHaveBeenCalledWith("句段 #1 已确认并写入 TM");
  });

  it("confirms without the TM write on Ctrl+Shift+Enter", async () => {
    const handlers = baseHandlers();
    const confirmCalls: unknown[] = [];
    handlers["segment.confirm"] = (params) => {
      confirmCalls.push(params);
      return {
        segment: { ...SEGMENT, state: "confirmed", revision: 2 },
        propagated: [],
      };
    };
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

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(confirmCalls).toHaveLength(1);
    });
    expect(confirmCalls[0]).toMatchObject({
      segmentId: "s1",
      baseRevision: 1,
      skipTmWrite: true,
    });
    expect(onStatusMessage).toHaveBeenCalledWith(
      "句段 #1 已确认，跳过 TM 写入",
    );
  });

  it("refuses to confirm an empty target with an honest message", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({
      segments: [{ ...SEGMENT, targetText: "", state: "untranslated" }],
    });
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

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onStatusMessage).toHaveBeenCalledWith("句段 #1 译文为空，无法确认");
    expect(
      bridge.invoke.mock.calls.some(([method]) => method === "segment.confirm"),
    ).toBe(false);
  });
});

describe("WorkbenchView find next/prev", () => {
  // s1 and s3 both contain "day" (case-insensitive); s2 does not.
  const FIND_SEGMENTS: Segment[] = [
    {
      ...SEGMENT,
      id: "s1",
      ordinal: 0,
      sourceText: "First day of work.",
      targetText: "第一天。",
    },
    {
      ...SEGMENT,
      id: "s2",
      ordinal: 1,
      sourceText: "Nothing to see here.",
      targetText: "无关内容。",
    },
    {
      ...SEGMENT,
      id: "s3",
      ordinal: 2,
      sourceText: "Every DAY counts.",
      targetText: "",
      state: "untranslated",
    },
  ];

  function installFindBridge() {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: FIND_SEGMENTS });
    return installBridge(handlers);
  }

  it("jumps through matches with F4/Shift+F4, wrapping honestly and hiding nothing", async () => {
    installFindBridge();
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    // Ctrl+F summons the floating find widget over the grid.
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await userEvent.type(
      screen.getByLabelText("查找", { selector: "input" }),
      "day",
    );
    // The find widget navigates only; unlike the filter it hides no rows.
    expect(screen.getByText("Nothing to see here.")).toBeInTheDocument();
    expect(screen.getByText("First day of work.")).toBeInTheDocument();

    // F4 skips the non-matching s2 and lands on s3 (no wrap, no status).
    fireEvent.keyDown(window, { key: "F4" });
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();
    expect(
      onStatusMessage.mock.calls.some(([message]) =>
        String(message).includes("已从头继续"),
      ),
    ).toBe(false);

    // Next from the last match wraps to the top and says so.
    fireEvent.keyDown(window, { key: "F4" });
    expect(await screen.findByLabelText("句段 1 译文")).toBeInTheDocument();
    expect(onStatusMessage).toHaveBeenCalledWith(
      "查找「day」：已从头继续，跳到句段 #1",
    );

    // Previous from the first match wraps to the end and says so.
    fireEvent.keyDown(window, { key: "F4", shiftKey: true });
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();
    expect(onStatusMessage).toHaveBeenCalledWith(
      "查找「day」：已从末尾继续，跳到句段 #3",
    );

    // Every row is still rendered; find never engaged the hide-filter.
    expect(screen.getByText("Nothing to see here.")).toBeInTheDocument();
    expect(screen.getByText("First day of work.")).toBeInTheDocument();
  });

  it("reports 没有匹配 and stays on the current segment", async () => {
    installFindBridge();
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await userEvent.type(
      screen.getByLabelText("查找", { selector: "input" }),
      "missing",
    );
    fireEvent.keyDown(window, { key: "F4" });
    expect(onStatusMessage).toHaveBeenCalledWith("查找「missing」：没有匹配");
    // The selection did not move anywhere.
    expect(screen.getByLabelText("句段 1 译文")).toBeInTheDocument();
  });

  it("drives the same jumps from the menu 查找下一个/查找上一个 commands", async () => {
    const bridge = installFindBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await userEvent.type(
      screen.getByLabelText("查找", { selector: "input" }),
      "day",
    );
    act(() => {
      bridge.emitMenuCommand("find-next");
    });
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();
    act(() => {
      bridge.emitMenuCommand("find-prev");
    });
    expect(await screen.findByLabelText("句段 1 译文")).toBeInTheDocument();
  });

  it("summons the find widget when F4 is pressed with an empty query", async () => {
    installFindBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    expect(
      screen.queryByRole("dialog", { name: "查找" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "F4" });
    expect(screen.getByRole("dialog", { name: "查找" })).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByLabelText("查找", { selector: "input" }),
    );
  });

  it("keeps the F3 chord on concordance, untouched by find next", async () => {
    installFindBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    fireEvent.keyDown(window, { key: "F3" });
    expect(await screen.findByLabelText(/检索词/)).toBeInTheDocument();
  });
});

describe("WorkbenchView segment navigation", () => {
  const NAV_SEGMENTS: Segment[] = [
    { ...SEGMENT, id: "s1", ordinal: 0, targetText: "第一句。" },
    {
      ...SEGMENT,
      id: "s2",
      ordinal: 1,
      sourceText: "Already done.",
      targetText: "已完成。",
      state: "confirmed",
    },
    {
      ...SEGMENT,
      id: "s3",
      ordinal: 2,
      sourceText: "Still open.",
      targetText: "",
      state: "untranslated",
    },
  ];

  it("advances past confirmed rows to the next open segment after a confirm", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    handlers["segment.confirm"] = () => ({
      segment: { ...NAV_SEGMENTS[0]!, state: "confirmed", revision: 2 },
      propagated: [],
    });
    installBridge(handlers);
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
      expect(editor.value).toBe("第一句。");
    });

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    // s2 is already confirmed, so the selection skips it and the editor
    // opens on the untranslated s3 — the classic confirm-and-move-on loop.
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();
  });

  it("Ctrl+Alt+Enter advances to the immediate next segment even if confirmed", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    handlers["segment.confirm"] = () => ({
      segment: { ...NAV_SEGMENTS[0]!, state: "confirmed", revision: 2 },
      propagated: [],
    });
    installBridge(handlers);
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
      expect(editor.value).toBe("第一句。");
    });

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true, altKey: true });

    // s2 is confirmed but Ctrl+Alt+Enter lands on it anyway — the review
    // pass walks every row regardless of state.
    expect(await screen.findByLabelText("句段 2 译文")).toBeInTheDocument();
  });

  it("Ctrl+Alt+Shift+Enter confirms and stays on the same segment", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    let confirmed = 0;
    handlers["segment.confirm"] = () => {
      confirmed += 1;
      return {
        segment: { ...NAV_SEGMENTS[0]!, state: "confirmed", revision: 2 },
        propagated: [],
      };
    };
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
      expect(editor.value).toBe("第一句。");
    });

    fireEvent.keyDown(editor, {
      key: "Enter",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(confirmed).toBe(1);
    });
    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith("句段 #1 已确认并写入 TM");
    });
    // The selection did not move: segment 1's editor is still mounted.
    expect(screen.getByLabelText("句段 1 译文")).toBeInTheDocument();
    expect(screen.queryByLabelText("句段 2 译文")).not.toBeInTheDocument();
  });

  it("dispatches the confirm variants from the menu commands", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    handlers["segment.confirm"] = () => ({
      segment: { ...NAV_SEGMENTS[0]!, state: "confirmed", revision: 2 },
      propagated: [],
    });
    const bridge = installBridge(handlers);
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
      expect(editor.value).toBe("第一句。");
    });

    act(() => {
      bridge.emitMenuCommand("confirm-segment-any");
    });
    // Menu command follows the same path as the chord: next row, any state.
    expect(await screen.findByLabelText("句段 2 译文")).toBeInTheDocument();
  });

  it("steps the selection with Alt+↑/↓ and never wraps", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    expect(await screen.findByLabelText("句段 2 译文")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();

    // At the bottom the selection stays put instead of wrapping around.
    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    expect(screen.getByLabelText("句段 3 译文")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    expect(await screen.findByLabelText("句段 2 译文")).toBeInTheDocument();

    // Plain arrows (no Alt) stay inside the editor for caret movement.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByLabelText("句段 2 译文")).toBeInTheDocument();
  });
});

describe("WorkbenchView segment lock", () => {
  const LOCK_SEGMENTS: Segment[] = [
    { ...SEGMENT, id: "s1", ordinal: 0, targetText: "第一句。" },
    {
      ...SEGMENT,
      id: "s2",
      ordinal: 1,
      sourceText: "Locked row.",
      targetText: "已锁行。",
      locked: true,
    },
    {
      ...SEGMENT,
      id: "s3",
      ordinal: 2,
      sourceText: "Still open.",
      targetText: "",
      state: "untranslated",
    },
  ];

  it("locks through segment.lock after flushing the pending draft", async () => {
    const handlers = baseHandlers();
    const calls: Array<[string, unknown]> = [];
    handlers["segment.update"] = (params) => {
      calls.push(["segment.update", params]);
      return {
        segment: { ...SEGMENT, targetText: "改过的句子。", revision: 2 },
      };
    };
    handlers["segment.lock"] = (params) => {
      calls.push(["segment.lock", params]);
      return {
        segment: {
          ...SEGMENT,
          targetText: "改过的句子。",
          revision: 3,
          locked: true,
        },
      };
    };
    installBridge(handlers);
    const onStatusMessage = vi.fn();
    const { container } = render(
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

    // Unsaved typing (the debounce is still armed)…
    fireEvent.change(editor, { target: { value: "改过的句子。" } });
    // …clicking 锁定句段 flushes it as a draft first, then locks at the
    // fresh revision — the text lands instead of conflicting.
    await userEvent.click(screen.getByRole("button", { name: "锁定句段" }));

    await waitFor(() => {
      expect(calls.map(([method]) => method)).toEqual([
        "segment.update",
        "segment.lock",
      ]);
    });
    expect(calls[0]?.[1]).toMatchObject({
      segmentId: "s1",
      targetText: "改过的句子。",
      baseRevision: 1,
    });
    expect(calls[1]?.[1]).toEqual({
      segmentId: "s1",
      locked: true,
      baseRevision: 2,
    });
    expect(onStatusMessage).toHaveBeenCalledWith("句段 #1 已锁定");
    // The engine's flag drives everything the user sees: glyph, read-only
    // row, and the ribbon button flipping to 解锁.
    expect(
      screen.getByRole("img", { name: "句段 1 已锁定" }),
    ).toBeInTheDocument();
    expect(container.querySelector('tr[data-segment-id="s1"]')).toHaveAttribute(
      "data-locked",
      "true",
    );
    expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "解锁句段" }),
    ).toBeInTheDocument();
  });

  it("unlocks from the menu command through the same segment.lock RPC", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({
      segments: [{ ...SEGMENT, locked: true }],
    });
    let lockParams: unknown = null;
    handlers["segment.lock"] = (params) => {
      lockParams = params;
      return { segment: { ...SEGMENT, revision: 2, locked: false } };
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
    // Locked active row: no editor, the lock glyph instead.
    await screen.findByRole("img", { name: "句段 1 已锁定" });
    expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();

    act(() => {
      bridge.emitMenuCommand("toggle-lock-segment");
    });

    await waitFor(() => {
      expect(lockParams).toEqual({
        segmentId: "s1",
        locked: false,
        baseRevision: 1,
      });
    });
    expect(onStatusMessage).toHaveBeenCalledWith("句段 #1 已解锁");
    // Unlocked: the editor mounts again and the glyph is gone.
    expect(await screen.findByLabelText("句段 1 译文")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "句段 1 已锁定" }),
    ).not.toBeInTheDocument();
  });

  it("confirm-and-advance skips locked rows to the next open segment", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: LOCK_SEGMENTS });
    handlers["segment.confirm"] = () => ({
      segment: { ...LOCK_SEGMENTS[0]!, state: "confirmed", revision: 2 },
      propagated: [],
    });
    installBridge(handlers);
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
      expect(editor.value).toBe("第一句。");
    });

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    // s2 is a draft — normally the next stop for Ctrl+Enter — but locked,
    // so the selection lands on s3.
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();
  });

  it("Ctrl+Alt+Enter also steps past locked rows", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: LOCK_SEGMENTS });
    handlers["segment.confirm"] = () => ({
      segment: { ...LOCK_SEGMENTS[0]!, state: "confirmed", revision: 2 },
      propagated: [],
    });
    installBridge(handlers);
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
      expect(editor.value).toBe("第一句。");
    });

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true, altKey: true });

    // nextAny walks every row regardless of state — except locked ones,
    // which refuse their editor and would strand the loop.
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();
  });

  it("pretranslate offers the threshold dialog and reports skipped locked rows", async () => {
    const handlers = baseHandlers();
    const pretranslateCalls: unknown[] = [];
    handlers["tm.pretranslate"] = (params) => {
      pretranslateCalls.push(params);
      return {
        documentId: "d1",
        checked: 1,
        pretranslated: 0,
        exact: 0,
        fuzzy: 0,
        skippedLocked: 2,
        segments: [],
      };
    };
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

    // The ribbon button opens the options dialog with the engine's default
    // threshold (75) pre-filled; the chosen value rides to the engine.
    await userEvent.click(screen.getByRole("button", { name: "预翻译" }));
    const dialog = within(
      screen.getByRole("dialog", { name: "预翻译（TM）" }),
    );
    const threshold = dialog.getByLabelText("模糊匹配阈值（%）");
    expect(threshold).toHaveValue(75);
    await userEvent.clear(threshold);
    await userEvent.type(threshold, "90");
    await userEvent.click(dialog.getByRole("button", { name: "开始预翻译" }));

    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith(
        "预翻译完成（阈值 90%）：检查 1 个未译句段，填充 0 个（精确 0 / 模糊 0），跳过 2 个已锁定句段",
      );
    });
    expect(pretranslateCalls[0]).toMatchObject({
      documentId: "d1",
      minScore: 90,
    });
    expect(
      screen.queryByRole("dialog", { name: "预翻译（TM）" }),
    ).not.toBeInTheDocument();
  });
});

describe("WorkbenchView confirm-time QA", () => {
  const CONFIRM_ISSUE: QaIssue = {
    id: "q1",
    segmentId: "s1",
    ruleId: "qa.number-mismatch",
    severity: "error",
    status: "open",
    message: "数字不一致：源 30，译 60",
    fingerprint: "fp1",
    evidence: { sourceNumbers: ["30"], targetNumbers: [] },
    createdAtMs: 1,
    updatedAtMs: 1,
  };

  it("merges the confirm's QA findings into the dock without a manual run", async () => {
    const handlers = baseHandlers();
    let confirms = 0;
    handlers["segment.confirm"] = () => {
      confirms += 1;
      // First confirm surfaces an open issue; the second (after the fix)
      // returns the same record resolved — records replaced wholesale.
      return {
        segment: {
          ...SEGMENT,
          state: "confirmed",
          revision: confirms + 1,
        },
        propagated: [],
        qaIssues: [
          confirms === 1
            ? CONFIRM_ISSUE
            : { ...CONFIRM_ISSUE, status: "resolved" },
        ],
      };
    };
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

    // Confirm-and-stay: the confirm succeeds (Studio-like, never gated)
    // and the engine's segment-scoped QA findings ride back on the result.
    fireEvent.keyDown(editor, {
      key: "Enter",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith(
        "句段 #1 已确认并写入 TM，QA 1 个问题",
      );
    });
    // The row's status chip and the QA dock tab pick the issue up without
    // anyone pressing 运行 QA.
    expect(
      screen.getByRole("img", { name: "已确认，1 个未解决 QA 问题" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "QA" }));
    expect(await screen.findByText("数字不一致：源 30，译 60")).toBeVisible();

    // Second confirm returns the issue resolved: the stale record is
    // replaced, the chip clears, and the message carries no QA note.
    fireEvent.keyDown(editor, {
      key: "Enter",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith("句段 #1 已确认并写入 TM");
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("img", { name: "已确认，1 个未解决 QA 问题" }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("WorkbenchView find & replace", () => {
  it("replaces inside the active segment's target through segment.update", async () => {
    const handlers = baseHandlers();
    let updateParams: unknown = null;
    handlers["segment.update"] = (params) => {
      updateParams = params;
      return {
        segment: {
          ...SEGMENT,
          targetText: "文件的为 60 天。",
          revision: 2,
        },
      };
    };
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

    // Ctrl+H summons the find widget with the replace row revealed; the
    // replace action lives there (no permanent toolbar chrome).
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    const widget = within(screen.getByRole("dialog", { name: "查找替换" }));
    await userEvent.type(widget.getByLabelText("查找"), "30 天");
    await userEvent.type(widget.getByLabelText("替换为"), "60 天");
    await userEvent.click(widget.getByRole("button", { name: "替换" }));

    await waitFor(() => {
      expect(updateParams).toMatchObject({
        segmentId: "s1",
        targetText: "文件的为 60 天。",
        baseRevision: 1,
      });
    });
    expect(onStatusMessage).toHaveBeenCalledWith(
      "句段 #1 已替换 1 处「30 天」",
    );
  });

  it("refuses to rewrite a confirmed segment until 含已确认 is checked", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({
      segments: [{ ...SEGMENT, state: "confirmed" }],
    });
    const updateCalls: unknown[] = [];
    handlers["segment.update"] = (params) => {
      updateCalls.push(params);
      return {
        segment: {
          ...SEGMENT,
          state: "draft",
          targetText: "文件的为 60 天。",
          revision: 2,
        },
      };
    };
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

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    const widget = within(screen.getByRole("dialog", { name: "查找替换" }));
    await userEvent.type(widget.getByLabelText("查找"), "30 天");
    await userEvent.type(widget.getByLabelText("替换为"), "60 天");
    await userEvent.click(widget.getByRole("button", { name: "替换" }));

    // Nothing was written; the guard is reported.
    expect(updateCalls).toHaveLength(0);
    expect(onStatusMessage).toHaveBeenCalledWith("句段 #1 已确认，未替换");

    await userEvent.click(widget.getByRole("checkbox", { name: /含已确认/ }));
    await userEvent.click(widget.getByRole("button", { name: "替换" }));
    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
    });
    expect(updateCalls[0]).toMatchObject({
      segmentId: "s1",
      targetText: "文件的为 60 天。",
    });
  });

  it("runs 全部替换 through one segment.replace call and reports honest counts", async () => {
    const handlers = baseHandlers();
    let replaceParams: unknown = null;
    handlers["segment.replace"] = (params) => {
      replaceParams = params;
      return {
        segments: [{ ...SEGMENT, targetText: "文件的为 60 天。", revision: 2 }],
        replacedOccurrences: 2,
        demotedConfirmed: 0,
        skippedConfirmed: 1,
        skippedLocked: 1,
      };
    };
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

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    await userEvent.type(
      screen.getByLabelText("查找", { selector: "input" }),
      "30 天",
    );
    await userEvent.type(screen.getByLabelText("替换为"), "60 天");
    await userEvent.click(screen.getByRole("button", { name: "全部替换" }));

    await waitFor(() => {
      expect(replaceParams).toEqual({
        documentId: "d1",
        find: "30 天",
        replaceWith: "60 天",
        includeConfirmed: false,
      });
    });
    // The rewritten segment lands in the grid without a full reload, and
    // the skipped-confirmed count is not hidden from the user.
    await waitFor(() => {
      expect(editor.value).toBe("文件的为 60 天。");
    });
    expect(onStatusMessage).toHaveBeenCalledWith(
      "全部替换完成：1 个句段、2 处「30 天」→「60 天」；跳过 1 个已确认句段；跳过 1 个已锁定句段",
    );
  });

  it("passes includeConfirmed to segment.replace when 含已确认 is checked", async () => {
    const handlers = baseHandlers();
    let replaceParams: unknown = null;
    handlers["segment.replace"] = (params) => {
      replaceParams = params;
      return {
        segments: [],
        replacedOccurrences: 0,
        demotedConfirmed: 0,
        skippedConfirmed: 0,
      };
    };
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

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    await userEvent.type(
      screen.getByLabelText("查找", { selector: "input" }),
      "missing",
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /含已确认/ }));
    await userEvent.click(screen.getByRole("button", { name: "全部替换" }));

    await waitFor(() => {
      expect(replaceParams).toMatchObject({ includeConfirmed: true });
    });
    // No match: the report says so instead of pretending success.
    expect(onStatusMessage).toHaveBeenCalledWith(
      "全部替换：译文中没有「missing」",
    );
  });

  it("opens the widget on the replace row via Ctrl+H and the menu 替换… command", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // No permanent replace chrome before the summon.
    expect(screen.queryByLabelText("替换为")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("替换为"));

    (document.activeElement as HTMLElement).blur();
    act(() => {
      bridge.emitMenuCommand("open-replace");
    });
    expect(document.activeElement).toBe(screen.getByLabelText("替换为"));
  });
});

describe("WorkbenchView find widget & filter chips", () => {
  const CHIP_SEGMENTS: Segment[] = [
    { ...SEGMENT, id: "s1", ordinal: 0, targetText: "第一天。" },
    {
      ...SEGMENT,
      id: "s2",
      ordinal: 1,
      sourceText: "Second line.",
      targetText: "第二行。",
      state: "confirmed",
    },
    {
      ...SEGMENT,
      id: "s3",
      ordinal: 2,
      sourceText: "Third line.",
      targetText: "",
      state: "untranslated",
    },
  ];

  function installChipBridge() {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: CHIP_SEGMENTS });
    return installBridge(handlers);
  }

  it("Ctrl+F opens find-only, the toggle reveals replace, Esc returns focus to the grid", async () => {
    installChipBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    const editor = await screen.findByLabelText("句段 1 译文");

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const widget = screen.getByRole("dialog", { name: "查找" });
    expect(widget).toBeInTheDocument();
    // Find mode keeps the replace row collapsed.
    expect(screen.queryByLabelText("替换为")).not.toBeInTheDocument();

    // The chevron toggle expands the replace row in place.
    await userEvent.click(screen.getByRole("button", { name: "展开替换" }));
    expect(screen.getByLabelText("替换为")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "查找替换" }),
    ).toBeInTheDocument();

    // Esc dismisses the widget and hands focus back to the grid editor.
    fireEvent.keyDown(screen.getByLabelText("查找", { selector: "input" }), {
      key: "Escape",
    });
    expect(
      screen.queryByRole("dialog", { name: "查找" }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(editor);
  });

  it("shows the honest matching-segment count next to the find box", async () => {
    installChipBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await userEvent.type(
      screen.getByLabelText("查找", { selector: "input" }),
      "line",
    );
    // s2 and s3 contain "line" (case-insensitive); s1 does not.
    expect(screen.getByLabelText("匹配句段数")).toHaveTextContent("2 段");
  });

  it("shows removable filter chips and the resident visible/total count", async () => {
    installChipBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // The count is resident even with no filter active.
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("3/3");
    expect(screen.queryByRole("button", { name: /清除状态筛选/ })).toBeNull();

    // A state filter raises its chip and shrinks the visible count.
    await userEvent.selectOptions(
      screen.getByLabelText("按状态筛选"),
      "confirmed",
    );
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("1/3");
    // A text filter raises a second, independently removable chip.
    await userEvent.type(screen.getByLabelText("按文本筛选"), "line");
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("1/3");
    expect(
      screen.getByRole("button", { name: "清除文本筛选：line" }),
    ).toBeInTheDocument();

    // × on the state chip clears only the state channel.
    await userEvent.click(
      screen.getByRole("button", { name: "清除状态筛选：已确认" }),
    );
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("2/3");
    expect(
      screen.getByRole("button", { name: "清除文本筛选：line" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "清除文本筛选：line" }),
    );
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("3/3");
  });

  it("Esc on the grid clears the active filter as the last resort", async () => {
    installChipBridge();
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.selectOptions(
      screen.getByLabelText("按状态筛选"),
      "confirmed",
    );
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("1/3");

    // Esc fired outside any text control clears the filter and says so.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("3/3");
    expect(onStatusMessage).toHaveBeenCalledWith("已清除筛选");
  });
});

describe("WorkbenchView boolean filter chips", () => {
  // s1 and s4 share one sourceText (the term hit); s2 is locked and carries
  // a placeholder token; s3 is plain.
  const BOOL_SEGMENTS: Segment[] = [
    { ...SEGMENT, id: "s1", ordinal: 0 },
    {
      ...SEGMENT,
      id: "s2",
      ordinal: 1,
      sourceText: "Second {count} line.",
      targetText: "第二 {count} 行。",
      locked: true,
    },
    {
      ...SEGMENT,
      id: "s3",
      ordinal: 2,
      sourceText: "Third line.",
      targetText: "第三行。",
    },
    { ...SEGMENT, id: "s4", ordinal: 3 },
  ];

  function installBoolBridge(
    termLookup?: (params: unknown) => unknown,
  ): Bridge {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: BOOL_SEGMENTS });
    if (termLookup) {
      handlers["term.lookup"] = termLookup;
    }
    return installBridge(handlers);
  }

  function termLookupCalls(bridge: Bridge): unknown[] {
    return (bridge.invoke.mock.calls as [string, unknown][])
      .filter(([method]) => method === "term.lookup")
      .map(([, params]) => params);
  }

  it("锁定 keeps only locked rows and clears through its own chip", async () => {
    installBoolBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("4/4");

    const toggle = screen.getByRole("button", { name: "锁定" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("1/4");

    // × on the chip clears just this channel.
    await userEvent.click(
      screen.getByRole("button", { name: "清除筛选：锁定" }),
    );
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("4/4");
  });

  it("有标签 keeps only rows whose text carries placeholder tokens", async () => {
    installBoolBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "有标签" }));
    // Only s2 carries a {count} placeholder run.
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("1/4");
    await userEvent.click(
      screen.getByRole("button", { name: "清除筛选：有标签" }),
    );
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("4/4");
  });

  it("有术语 asks term.lookup once per distinct source and keeps engine hits", async () => {
    const bridge = installBoolBridge((params) => {
      const { sourceText } = params as { sourceText: string };
      return sourceText === SEGMENT.sourceText
        ? { matches: [TERM_MATCH] }
        : { matches: [] };
    });
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // The chip is off: nothing scans the table.
    expect(termLookupCalls(bridge)).toHaveLength(0);

    const toggle = screen.getByRole("button", { name: "有术语" });
    await userEvent.click(toggle);
    // s1 and s4 share the hit sourceText; s2/s3 miss.
    await waitFor(() => {
      expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("2/4");
    });
    // Four segments, three distinct source texts — the duplicate is served
    // from the cache, never re-asked.
    const calls = termLookupCalls(bridge);
    expect(calls).toHaveLength(3);
    for (const params of calls) {
      expect(params).toMatchObject({ projectId: "p1" });
    }

    // Turning the chip off restores the rows without another scan.
    await userEvent.click(toggle);
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("4/4");
    expect(termLookupCalls(bridge)).toHaveLength(3);
  });

  it("有术语 shows no rows while the lookup is still in flight", async () => {
    // Lookups resolve only when the test releases the gate — the window
    // between the chip click and convergence, where the grid previously
    // flashed the unfiltered document.
    let releaseLookups!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLookups = resolve;
    });
    installBoolBridge((params) => {
      const { sourceText } = params as { sourceText: string };
      return gate.then(() =>
        sourceText === SEGMENT.sourceText
          ? { matches: [TERM_MATCH] }
          : { matches: [] },
      );
    });
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "有术语" }));
    // Nothing has converged: the grid hides every row instead of showing
    // the full document, with only the standard empty-filter line.
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("0/4");
    expect(screen.getByText("没有符合筛选条件的句段")).toBeInTheDocument();
    // Once the engine answers, the rows narrow to the converged hits.
    act(() => {
      releaseLookups();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("2/4");
    });
  });

  it("有术语 with no hits anywhere empties the grid honestly", async () => {
    installBoolBridge(() => ({ matches: [] }));
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "有术语" }));
    await waitFor(() => {
      expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("0/4");
    });
    expect(screen.getByText("没有符合筛选条件的句段")).toBeInTheDocument();
  });

  it("a failed lookup reports and drops the 有术语 channel", async () => {
    installBoolBridge(
      () => new EngineFailure("internal", "termbase unavailable"),
    );
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const toggle = screen.getByRole("button", { name: "有术语" });
    await userEvent.click(toggle);
    // The failure surfaces and the channel switches itself back off — the
    // grid never narrows on a half-answered set.
    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith(
        expect.stringContaining("术语筛选失败"),
      );
    });
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    });
    expect(screen.getByLabelText("可见句段/总句段")).toHaveTextContent("4/4");
  });
});

describe("WorkbenchView document rail progress", () => {
  const DOCUMENT_2 = {
    ...DOCUMENT,
    id: "d2",
    name: "second.txt",
    segmentCount: 10,
  };

  it("shows per-document confirmed/draft/QA counts from document.list", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [DOCUMENT, DOCUMENT_2],
      progress: [
        {
          documentId: "d1",
          counts: {
            total: 1,
            untranslated: 0,
            draft: 1,
            confirmed: 0,
            openIssues: 0,
          },
        },
        {
          documentId: "d2",
          counts: {
            total: 10,
            untranslated: 3,
            draft: 2,
            confirmed: 5,
            openIssues: 1,
          },
        },
      ],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    // The inactive document keeps its list-time counts, including QA.
    expect(
      screen.getByText("txt · 确认 5/10 · 草稿 2 · QA 1"),
    ).toBeInTheDocument();
    // The active document reflects the loaded grid (1 draft segment).
    expect(screen.getByText("txt · 确认 0/1 · 草稿 1")).toBeInTheDocument();
  });

  it("updates the active document's rail entry live when a segment is confirmed", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [DOCUMENT],
      progress: [
        {
          documentId: "d1",
          counts: {
            total: 1,
            untranslated: 0,
            draft: 1,
            confirmed: 0,
            openIssues: 0,
          },
        },
      ],
    });
    handlers["segment.confirm"] = () => ({
      segment: { ...SEGMENT, state: "confirmed", revision: 2 },
      propagated: [],
    });
    installBridge(handlers);
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
    expect(screen.getByText("txt · 确认 0/1 · 草稿 1")).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    // No document.list round-trip needed: the rail follows the grid.
    await waitFor(() => {
      expect(screen.getByText("txt · 确认 1/1")).toBeInTheDocument();
    });
  });

  it("falls back to the plain segment count when the engine sends no progress", async () => {
    const handlers = baseHandlers();
    // An older engine (or a crashed migration) answers without the
    // progress field; an empty grid also never fabricates live counts.
    handlers["segment.list"] = () => ({ segments: [] });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    // The name appears in the explorer file list and the open tab.
    expect(await screen.findAllByText("guide.txt")).not.toHaveLength(0);
    expect(screen.getByText("txt · 1 句段")).toBeInTheDocument();
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

    // Trados-style typing: the auto-draft reaches the dead engine after
    // the debounce pause — no save button involved.
    await userEvent.type(editor, "补");

    // A blocking-style inline alert, not just a statusbar toast.
    const alert = await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("句段 #1 的草稿未被引擎确认写入");
    expect(alert).toHaveTextContent("engine process is not running");
    // The editor still holds the user's text; nothing was lost or reset.
    expect(editor.value).toBe("文件的为 30 天。补");
    expect(onStatusMessage).toHaveBeenCalledWith(
      "句段 #1 草稿未保存：引擎未确认写入",
    );
    // The segment must NOT be presented as saved anywhere.
    expect(onStatusMessage).not.toHaveBeenCalledWith("句段 #1 草稿已保存");

    // Once the engine acks a later auto-save of the same segment, the
    // alert goes — and the quiet auto-save posts no success toast.
    updateResponse = {
      segment: { ...SEGMENT, targetText: "文件的为 30 天。补充", revision: 2 },
    };
    await userEvent.type(editor, "充");
    await waitFor(
      () => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(onStatusMessage).not.toHaveBeenCalledWith("句段 #1 草稿已保存");
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

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

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
      expect(onStatusMessage).toHaveBeenCalledWith("引擎已恢复，已重新同步");
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
      "已移除「guide.txt」：删除 1 个句段、0 条 QA 记录",
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
    expect(onStatusMessage).toHaveBeenCalledWith("已取消导出");
  });
});

describe("WorkbenchView QA export gate", () => {
  const GATE_FAILURE = new EngineFailure(
    "exportBlocked",
    "export blocked: 2 error-severity QA issue(s) are open; first rules: qa.number-mismatch, qa.tag-placeholder_missing",
    {
      reason: "qaGate",
      openErrors: 2,
      ruleIds: ["qa.number-mismatch", "qa.tag-placeholder_missing"],
    },
  );

  /** Bridge where the QA gate blocks the plain export until overridden. */
  function installGateBridge() {
    const handlers = baseHandlers();
    const exportCalls: unknown[] = [];
    handlers["document.export"] = (params) => {
      exportCalls.push(params);
      if ((params as { overrideQaGate?: boolean }).overrideQaGate !== true) {
        return GATE_FAILURE;
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

  it("surfaces the gate refusal and retries with overrideQaGate only after 仍要导出", async () => {
    const { exportCalls } = installGateBridge();
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

    // The refusal is a question with the engine's own numbers, not a toast.
    const prompt = await screen.findByRole("alertdialog", {
      name: "存在 QA 错误，仍要导出吗？",
    });
    expect(prompt).toHaveTextContent("2 个错误未解决");
    expect(prompt).toHaveTextContent(
      "qa.number-mismatch、qa.tag-placeholder_missing",
    );
    expect(exportCalls).toHaveLength(1);
    expect(exportCalls[0]).not.toHaveProperty("overrideQaGate");
    expect(
      onStatusMessage.mock.calls.some(([message]) =>
        String(message).includes("导出失败"),
      ),
    ).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "仍要导出" }));
    await waitFor(() => {
      expect(exportCalls).toHaveLength(2);
    });
    expect(exportCalls[1]).toMatchObject({
      documentId: "d1",
      outputPath: "/tmp/out.txt",
      overrideQaGate: true,
    });
    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith(
        "导出完成：/tmp/out.txt（1 个已译单元）",
      );
    });
    expect(
      screen.queryByRole("alertdialog", { name: "存在 QA 错误，仍要导出吗？" }),
    ).not.toBeInTheDocument();
  });

  it("取消 sends no override call and keeps the findings in view", async () => {
    const { exportCalls } = installGateBridge();
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
      name: "存在 QA 错误，仍要导出吗？",
    });

    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("alertdialog", { name: "存在 QA 错误，仍要导出吗？" }),
    ).not.toBeInTheDocument();
    // Only the refused gate call ever reached the engine.
    expect(exportCalls).toHaveLength(1);
    expect(onStatusMessage).toHaveBeenCalledWith("已取消导出");
  });

  it("carries the gate decision through a destination-exists overwrite", async () => {
    const handlers = baseHandlers();
    const exportCalls: {
      overrideQaGate?: boolean;
      overwrite?: boolean;
    }[] = [];
    handlers["document.export"] = (params) => {
      const typed = params as { overrideQaGate?: boolean; overwrite?: boolean };
      exportCalls.push(typed);
      if (typed.overrideQaGate !== true) {
        return GATE_FAILURE;
      }
      if (typed.overwrite !== true) {
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

    // Gate first (the engine checks QA before the destination), then the
    // plain destination question; the final retry carries both decisions.
    await screen.findByRole("alertdialog", {
      name: "存在 QA 错误，仍要导出吗？",
    });
    await userEvent.click(screen.getByRole("button", { name: "仍要导出" }));
    await screen.findByRole("alertdialog", {
      name: "目标已存在，要覆盖吗？",
    });
    await userEvent.click(screen.getByRole("button", { name: "覆盖" }));
    await waitFor(() => {
      expect(exportCalls).toHaveLength(3);
    });
    expect(exportCalls[2]).toMatchObject({
      overrideQaGate: true,
      overwrite: true,
    });
    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith(
        "导出完成（已覆盖）：/tmp/out.txt（1 个已译单元）",
      );
    });
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
      return { issues: [{ ...QA_ISSUE, status: "waived", updatedAtMs: 2 }] };
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
    // The open count drops honestly and the card shows the waived state.
    expect(await screen.findByText("质量检查（未解决 0）")).toBeInTheDocument();
    expect(screen.getByText("已忽略")).toBeInTheDocument();
    expect(onStatusMessage).toHaveBeenCalledWith("已忽略 QA 问题");
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
      return { issues: [{ ...QA_ISSUE, updatedAtMs: 3 }] };
    };
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    await waitFor(() => {
      expect(waiveParams).toEqual({ issueId: "issue-1", waived: false });
    });
    expect(await screen.findByText("质量检查（未解决 1）")).toBeInTheDocument();
    expect(onStatusMessage).toHaveBeenCalledWith("已恢复 QA 问题为未解决");
  });

  it("忽略同类 waives the whole rule through one engine call", async () => {
    const second = {
      ...QA_ISSUE,
      id: "issue-2",
      segmentId: "s2",
      fingerprint: "fp-2",
    };
    const handlers = baseHandlers();
    handlers["qa.list"] = () => ({ issues: [QA_ISSUE, second], total: 2 });
    let waiveParams: unknown = null;
    handlers["qa.waive"] = (params) => {
      waiveParams = params;
      return {
        issues: [
          { ...QA_ISSUE, status: "waived", updatedAtMs: 2 },
          { ...second, status: "waived", updatedAtMs: 2 },
        ],
      };
    };
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
    expect(await screen.findByText("质量检查（未解决 2）")).toBeInTheDocument();

    const [batch] = screen.getAllByRole("button", {
      name: "忽略本文档全部 qa.number-mismatch 问题",
    });
    await userEvent.click(batch!);
    // One engine call carries the rule selector; both rows flip together.
    await waitFor(() => {
      expect(waiveParams).toEqual({
        ruleId: "qa.number-mismatch",
        documentId: "d1",
        waived: true,
      });
    });
    expect(await screen.findByText("质量检查（未解决 0）")).toBeInTheDocument();
    expect(screen.getAllByText("已忽略")).toHaveLength(2);
    expect(onStatusMessage).toHaveBeenCalledWith("已忽略 2 个 QA 问题");
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

describe("WorkbenchView ribbon", () => {
  it("routes 导出译文 through the same chooseExportPath seam as the menu", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "导出译文" }));
    await waitFor(() => {
      expect(bridge.chooseExportPath).toHaveBeenCalledWith(
        "guide-translated.txt",
      );
    });
    // The user cancelled (null), so no engine export call happens.
    expect(
      bridge.invoke.mock.calls.some(([method]) => method === "document.export"),
    ).toBe(false);
  });

  it("确认句段 confirms the live editor draft and reports honestly without one", async () => {
    const handlers = baseHandlers();
    let confirmParams: unknown = null;
    handlers["segment.confirm"] = (params) => {
      confirmParams = params;
      return {
        segment: { ...SEGMENT, state: "confirmed", revision: 2 },
        propagated: [],
      };
    };
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
    await userEvent.click(screen.getByRole("button", { name: "确认句段" }));
    await waitFor(() => {
      expect(confirmParams).toMatchObject({ segmentId: "s1" });
    });
    // With the active row filtered out no editor is mounted: the ribbon
    // command reports instead of guessing.
    await userEvent.type(screen.getByLabelText("按文本筛选"), "无匹配文本");
    await waitFor(() => {
      expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "确认句段" }));
    expect(onStatusMessage).toHaveBeenCalledWith(
      "没有正在编辑的句段，无法确认",
    );
  });

  it("opens the import dialog and dispatches the shell callbacks", async () => {
    installBridge(baseHandlers());
    const onOpenSettings = vi.fn();
    const onOpenTmManage = vi.fn();
    const onCloseProject = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenTmManage={onOpenTmManage}
        onCloseProject={onCloseProject}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("导入文档");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "项目设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "TM 管理" }));
    expect(onOpenTmManage).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "项目列表" }));
    expect(onCloseProject).toHaveBeenCalledTimes(1);
  });

  it("summons the find widget and opens 检索 from the review group buttons", async () => {
    installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // Ribbon buttons share accessible names with find-widget controls
    // (替换), so scope the clicks to the toolbar.
    const ribbon = within(screen.getByRole("toolbar", { name: "工具栏" }));
    await userEvent.click(ribbon.getByRole("button", { name: "查找" }));
    expect(document.activeElement).toBe(
      screen.getByLabelText("查找", { selector: "input" }),
    );
    await userEvent.click(ribbon.getByRole("button", { name: "替换" }));
    expect(document.activeElement).toBe(screen.getByLabelText("替换为"));
    await userEvent.click(ribbon.getByRole("button", { name: "检索" }));
    expect(await screen.findByLabelText(/检索词/)).toBeInTheDocument();
  });

  it("撤销/重做 drive the mounted editor's undo stack and disable without one", async () => {
    installBridge(baseHandlers());
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    const editor = await screen.findByLabelText("句段 1 译文");
    // The active row's editor is mounted, so history commands are live and
    // land on the refocused editor.
    const undo = screen.getByRole("button", { name: "撤销" });
    const redo = screen.getByRole("button", { name: "重做" });
    expect(undo).toBeEnabled();
    await userEvent.click(undo);
    expect(execCommand).toHaveBeenCalledWith("undo");
    expect(document.activeElement).toBe(editor);
    await userEvent.click(redo);
    expect(execCommand).toHaveBeenCalledWith("redo");

    // Filter the row out: no editor, no application-level undo to fake.
    await userEvent.type(screen.getByLabelText("按文本筛选"), "无匹配文本");
    await waitFor(() => {
      expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
  });

  it("插入记忆 applies TM match #1 as a draft with its origin", async () => {
    const handlers = baseHandlers();
    handlers["tm.lookup"] = () => ({
      matches: [
        {
          entry: {
            id: "tm-1",
            memoryId: "m1",
            sourceHash: "hash",
            sourceText: SEGMENT.sourceText,
            targetText: "保留期为 30 天。",
            originProjectId: "p1",
            originDocumentId: "d1",
            originSegmentId: "s1",
            confirmedAtMs: 1,
          },
          score: 100,
          grade: "exact",
          memoryName: "主记忆库",
        },
      ],
      totalMatches: 1,
    });
    let updateParams: unknown = null;
    handlers["segment.update"] = (params) => {
      updateParams = params;
      return {
        segment: {
          ...SEGMENT,
          targetText: "保留期为 30 天。",
          revision: 2,
        },
      };
    };
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
    // The dock lists the match before the button applies it.
    await screen.findByText("应用为草稿");
    await userEvent.click(screen.getByRole("button", { name: "插入记忆" }));
    await waitFor(() => {
      expect(updateParams).toMatchObject({
        segmentId: "s1",
        targetText: "保留期为 30 天。",
        origin: { kind: "tmExact", score: 100 },
      });
    });
    expect(onStatusMessage).toHaveBeenCalledWith(
      "已应用第 1 条记忆匹配（100%）为草稿",
    );
  });

  it("插入记忆 reports the honest miss when the engine has no match", async () => {
    const bridge = installBridge(baseHandlers());
    const onStatusMessage = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={onStatusMessage}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // baseHandlers answers tm.lookup with zero matches.
    await userEvent.click(screen.getByRole("button", { name: "插入记忆" }));
    expect(onStatusMessage).toHaveBeenCalledWith("没有第 1 条记忆匹配");
    expect(
      bridge.invoke.mock.calls.some(([method]) => method === "segment.update"),
    ).toBe(false);
  });

  it("插入术语 lands the first non-forbidden hit at the caret, a miss opens the 术语 dock", async () => {
    const handlers = baseHandlers();
    let termMatches: unknown[] = [TERM_MATCH];
    handlers["term.lookup"] = () => ({ matches: termMatches });
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
    editor.setSelectionRange(3, 3);
    await userEvent.click(screen.getByRole("button", { name: "插入术语" }));
    await waitFor(() => {
      expect(editor.value).toBe("文件的保留期为 30 天。");
    });
    expect(onStatusMessage).toHaveBeenCalledWith("已插入术语「保留期」");

    // A miss switches to the 术语 dock and says so — nothing is inserted.
    termMatches = [];
    await userEvent.click(screen.getByRole("button", { name: "插入术语" }));
    await waitFor(() => {
      expect(onStatusMessage).toHaveBeenCalledWith("当前句段无术语命中");
    });
    expect(screen.getByRole("button", { name: "术语" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(editor.value).toBe("文件的保留期为 30 天。");
  });

  it("运行 QA and 预览 run the same handlers as the menu commands", async () => {
    const handlers = baseHandlers();
    let qaRuns = 0;
    handlers["qa.run"] = () => {
      qaRuns += 1;
      return { issues: [], checkedSegments: 1, openIssues: 0 };
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
    const ribbon = within(screen.getByRole("toolbar", { name: "工具栏" }));
    await userEvent.click(ribbon.getByRole("button", { name: "运行 QA" }));
    await waitFor(() => {
      expect(qaRuns).toBe(1);
    });
    // 预览 toggles the same layout flag as Ctrl+P.
    const pane = screen.getByLabelText("预览面板");
    expect(pane).not.toHaveAttribute("data-open");
    await userEvent.click(ribbon.getByRole("button", { name: "预览" }));
    expect(pane).toHaveAttribute("data-open");
    await userEvent.click(ribbon.getByRole("button", { name: "预览" }));
    expect(pane).not.toHaveAttribute("data-open");
  });
});

describe("WorkbenchView document tabs", () => {
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

  function installTabsBridge() {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({ documents: [DOCUMENT, DOCUMENT_2] });
    handlers["segment.list"] = (params) => ({
      segments:
        (params as { documentId: string }).documentId === "d2"
          ? [SEGMENT_2]
          : [SEGMENT],
    });
    return installBridge(handlers);
  }

  it("opens a tab per opened file and switches between them", async () => {
    installTabsBridge();
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
    // Only the auto-opened first document has a tab (the 文本/预览 view
    // switch is gone — preview lives in the docked bottom pane).
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "guide.txt" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Opening the second file from the explorer adds its tab and loads it.
    await userEvent.click(screen.getByText("second.txt"));
    const secondTab = await screen.findByRole("tab", { name: "second.txt" });
    await waitFor(() => {
      expect(secondTab).toHaveAttribute("aria-selected", "true");
    });
    const secondEditor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    await waitFor(() => {
      expect(secondEditor.value).toBe("第二个文档。");
    });

    // Clicking the first tab switches straight back.
    await userEvent.click(screen.getByRole("tab", { name: "guide.txt" }));
    const firstEditor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    await waitFor(() => {
      expect(firstEditor.value).toBe("文件的为 30 天。");
    });
  });

  it("closing a tab keeps the document in the project and never removes it", async () => {
    const bridge = installTabsBridge();
    const onDocumentOpenChange = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
        onDocumentOpenChange={onDocumentOpenChange}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    await userEvent.click(
      screen.getByRole("button", { name: "关闭标签页 guide.txt" }),
    );
    // The tab is gone but the file stays listed in the explorer, and no
    // remove call ever reached the engine.
    expect(
      screen.queryByRole("tab", { name: "guide.txt" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("guide.txt")).toBeInTheDocument();
    expect(
      bridge.invoke.mock.calls.some(([method]) => method === "document.remove"),
    ).toBe(false);
    // No document is open: the grid says so and the menu context follows.
    expect(screen.getByText("没有打开的文档")).toBeInTheDocument();
    await waitFor(() => {
      expect(onDocumentOpenChange).toHaveBeenLastCalledWith(false);
    });
  });

  it("closing the active tab activates its neighbor", async () => {
    installTabsBridge();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await userEvent.click(screen.getByText("second.txt"));
    const secondTab = await screen.findByRole("tab", { name: "second.txt" });
    await waitFor(() => {
      expect(secondTab).toHaveAttribute("aria-selected", "true");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "关闭标签页 second.txt" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "guide.txt" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    const editor =
      await screen.findByLabelText<HTMLTextAreaElement>("句段 1 译文");
    await waitFor(() => {
      expect(editor.value).toBe("文件的为 30 天。");
    });
  });

  it("docks a collapsed preview pane that expands from the bar or Ctrl+P", async () => {
    const bridge = installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    // Collapsed by default: the bar is there, the body content is not.
    const pane = screen.getByRole("region", { name: "预览面板" });
    expect(within(pane).queryByText(/共 \d+ 个句段/)).toBeNull();

    await userEvent.click(
      within(pane).getByRole("button", { name: "展开预览" }),
    );
    expect(within(pane).getByText(/共 1 个句段/)).toBeVisible();

    // The menu command (Ctrl+P) toggles the same pane back closed.
    act(() => {
      bridge.emitMenuCommand("toggle-preview");
    });
    expect(within(pane).queryByText(/共 1 个句段/)).toBeNull();
  });

  it("jumps from a proofread preview segment back to the grid row", async () => {
    installBridge(baseHandlers());
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const pane = screen.getByRole("region", { name: "预览面板" });
    await userEvent.click(
      within(pane).getByRole("button", { name: "展开预览" }),
    );
    await userEvent.click(within(pane).getByTitle("句段 #1"));
    // The grid row is activated and its editor mounts.
    expect(await screen.findByLabelText("句段 1 译文")).toBeInTheDocument();
  });
});

describe("WorkbenchView project explorer", () => {
  it("shows the language pair, real aggregate progress, and project details", async () => {
    const handlers = baseHandlers();
    const DOCUMENT_2 = {
      ...DOCUMENT,
      id: "d2",
      name: "second.txt",
      segmentCount: 10,
    };
    handlers["document.list"] = () => ({
      documents: [DOCUMENT, DOCUMENT_2],
      progress: [
        {
          documentId: "d1",
          counts: {
            total: 1,
            untranslated: 0,
            draft: 1,
            confirmed: 0,
            openIssues: 0,
          },
        },
        {
          documentId: "d2",
          counts: {
            total: 10,
            untranslated: 3,
            draft: 2,
            confirmed: 5,
            openIssues: 1,
          },
        },
      ],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");

    // Language pair and aggregate progress derived from document.list.
    expect(screen.getByText("en-US → zh-CN")).toBeInTheDocument();
    // 5 confirmed of 11 total segments -> 45%.
    expect(screen.getByText("45%")).toBeInTheDocument();

    // Details region carries the real counts, not placeholders.
    const details = screen.getByRole("region", { name: "项目详情" });
    expect(details).toHaveTextContent("文件数");
    expect(details).toHaveTextContent("2");
    expect(details).toHaveTextContent("总句段");
    expect(details).toHaveTextContent("11");
    expect(details).toHaveTextContent("已确认句段");
    expect(details).toHaveTextContent("5（45%）");
  });

  it("omits the aggregate ratio when the engine sent no per-file progress", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: [] });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    expect(await screen.findAllByText("guide.txt")).not.toHaveLength(0);
    // No progress data: the details show the honest segment count but no
    // invented confirmed ratio, and no progress bar renders up top.
    const details = screen.getByRole("region", { name: "项目详情" });
    expect(details).toHaveTextContent("总句段");
    expect(details).not.toHaveTextContent("已确认句段");
    expect(screen.queryByText(/^进度：/)).not.toBeInTheDocument();
  });

  it("filters the file list locally through the 搜索文件 box", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [DOCUMENT, { ...DOCUMENT, id: "d2", name: "second.txt" }],
    });
    const bridge = installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const files = within(screen.getByRole("region", { name: "文件" }));
    expect(files.getByText("guide.txt")).toBeInTheDocument();
    expect(files.getByText("second.txt")).toBeInTheDocument();

    const listCallsBefore = bridge.invoke.mock.calls.filter(
      ([method]) => method === "document.list",
    ).length;
    // Substring, case-insensitive, in-memory: no RPC leaves the renderer.
    await userEvent.type(files.getByLabelText("搜索文件"), "SECOND");
    expect(files.queryByText("guide.txt")).not.toBeInTheDocument();
    expect(files.getByText("second.txt")).toBeInTheDocument();

    // A miss shows the honest empty state, and clearing restores the list.
    await userEvent.clear(files.getByLabelText("搜索文件"));
    await userEvent.type(files.getByLabelText("搜索文件"), "無此文件");
    expect(files.getByText("无匹配文件")).toBeInTheDocument();
    await userEvent.clear(files.getByLabelText("搜索文件"));
    expect(files.getByText("guide.txt")).toBeInTheDocument();
    const listCallsAfter = bridge.invoke.mock.calls.filter(
      ([method]) => method === "document.list",
    ).length;
    expect(listCallsAfter).toBe(listCallsBefore);
  });

  it("matches the 搜索文件 query against the visible folder path", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [
        { ...DOCUMENT, relativePath: "/w/docs/guides/guide.txt" },
        {
          ...DOCUMENT,
          id: "d2",
          name: "terms.txt",
          relativePath: "/w/legal/terms.txt",
        },
      ],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const files = within(screen.getByRole("region", { name: "文件" }));
    // A folder name is a hit for everything inside the folder — the tree
    // draws `docs/guides/guide.txt`, so typing `guides` must not answer
    // 无匹配文件 while the folder row sits on screen.
    await userEvent.type(files.getByLabelText("搜索文件"), "guides");
    expect(files.getByText("guide.txt")).toBeInTheDocument();
    expect(files.queryByText("terms.txt")).not.toBeInTheDocument();
    // The searched folder is force-open so the hit is visible, and its
    // chevron reports that fact.
    expect(files.getByRole("treeitem", { name: /guides/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // The stripped shared prefix (`/w`) is not searchable: it has no row.
    await userEvent.clear(files.getByLabelText("搜索文件"));
    await userEvent.type(files.getByLabelText("搜索文件"), "/w");
    expect(files.getByText("无匹配文件")).toBeInTheDocument();
  });

  it("rolls open QA findings up onto the folder row", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [
        { ...DOCUMENT, relativePath: "/w/docs/guides/guide.txt" },
        {
          ...DOCUMENT,
          id: "d2",
          name: "terms.txt",
          relativePath: "/w/legal/terms.txt",
        },
      ],
      progress: [
        {
          documentId: "d1",
          counts: {
            total: 4,
            untranslated: 1,
            draft: 1,
            confirmed: 2,
            openIssues: 0,
          },
        },
        {
          documentId: "d2",
          counts: {
            total: 2,
            untranslated: 0,
            draft: 0,
            confirmed: 2,
            openIssues: 3,
          },
        },
      ],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const files = within(screen.getByRole("region", { name: "文件" }));
    // `legal` holds terms.txt's 3 open findings; `docs` is clean and wears
    // no badge — a zero would be noise, not information.
    const legalDir = files.getByRole("treeitem", { name: /legal/ });
    expect(within(legalDir).getByTitle("未解决 QA 问题 3")).toHaveTextContent(
      "3",
    );
    const docsDir = files.getByRole("treeitem", { name: /docs/ });
    expect(
      within(docsDir).queryByTitle(/未解决 QA 问题/),
    ).not.toBeInTheDocument();
  });

  it("marks open-but-inactive documents with data-open, weaker than active", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [
        DOCUMENT,
        {
          ...DOCUMENT,
          id: "d2",
          name: "second.txt",
          relativePath: "second.txt",
        },
      ],
    });
    handlers["segment.list"] = (params) => ({
      segments:
        (params as { documentId: string }).documentId === "d1"
          ? [SEGMENT]
          : [{ ...SEGMENT, id: "s2", documentId: "d2" }],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const files = within(screen.getByRole("region", { name: "文件" }));
    const first = files.getByRole("treeitem", { name: /guide\.txt/ });
    const second = files.getByRole("treeitem", { name: /second\.txt/ });
    // Only the auto-opened first document is open; second is plain closed.
    expect(first).toHaveAttribute("data-active", "true");
    expect(first).not.toHaveAttribute("data-open");
    expect(second).toHaveAttribute("data-active", "false");
    expect(second).not.toHaveAttribute("data-open");

    // Opening the second document flips activation; the first stays open
    // in its tab and now wears the in-between data-open state.
    await userEvent.click(
      second.querySelector(".document-list__select") as HTMLElement,
    );
    await waitFor(() => {
      expect(second).toHaveAttribute("data-active", "true");
    });
    expect(first).toHaveAttribute("data-active", "false");
    expect(first).toHaveAttribute("data-open", "true");
    expect(second).not.toHaveAttribute("data-open");
  });

  it("draws format-specific file glyphs from the engine's format id", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [
        {
          ...DOCUMENT,
          format: "docx",
          name: "spec.docx",
          relativePath: "spec.docx",
        },
        {
          ...DOCUMENT,
          id: "d2",
          format: "markdown",
          name: "notes.md",
          relativePath: "notes.md",
        },
        {
          ...DOCUMENT,
          id: "d3",
          format: "mystery",
          name: "blob.bin",
          relativePath: "blob.bin",
        },
      ],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const files = within(screen.getByRole("region", { name: "文件" }));
    const glyph = (name: RegExp) =>
      files
        .getByRole("treeitem", { name })
        .querySelector(".document-list__file-icon")
        ?.getAttribute("class") ?? "";
    expect(glyph(/spec\.docx/)).toContain("tabler-icon-file-type-docx");
    expect(glyph(/notes\.md/)).toContain("tabler-icon-markdown");
    // An unmapped format keeps the plain file glyph — never an invented one.
    expect(glyph(/blob\.bin/)).toContain("tabler-icon-file-text");
  });

  it("draws one indent guide per ancestor folder level", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [
        { ...DOCUMENT, relativePath: "/w/docs/guides/guide.txt" },
        {
          ...DOCUMENT,
          id: "d2",
          name: "terms.txt",
          relativePath: "/w/terms.txt",
        },
      ],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    const files = within(screen.getByRole("region", { name: "文件" }));
    // guide.txt sits under docs/guides → two ancestor hairlines; the
    // root-level terms.txt draws none.
    expect(
      files
        .getByRole("treeitem", { name: /guide\.txt/ })
        .querySelectorAll(".document-list__guide"),
    ).toHaveLength(2);
    expect(
      files
        .getByRole("treeitem", { name: /terms\.txt/ })
        .querySelectorAll(".document-list__guide"),
    ).toHaveLength(0);
    // Folder rows indent the same way: guides (depth 1) draws one line.
    expect(
      files
        .getByRole("treeitem", { name: /guides/ })
        .querySelectorAll(".document-list__guide"),
    ).toHaveLength(1);
  });
});

describe("WorkbenchView segment intel", () => {
  const TM_MATCH = {
    entry: {
      id: "tm-1",
      memoryId: "m1",
      sourceHash: "hash",
      sourceText: "The retention period is 30 days.",
      targetText: "保留期为 30 天。",
      originProjectId: "p1",
      originDocumentId: "d1",
      originSegmentId: "s1",
      confirmedAtMs: 1,
    },
    score: 100,
    grade: "exact",
    memoryName: "主记忆库",
  };

  it("surfaces the best TM match on the tab chip, active row, and dock", async () => {
    const handlers = baseHandlers();
    handlers["tm.lookup"] = () => ({ matches: [TM_MATCH], totalMatches: 1 });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // The tab chip carries the live score but stays out of the accessible
    // name, so the tab is still reachable as plain "记忆".
    const tmTab = screen.getByRole("button", { name: "记忆" });
    await waitFor(() => {
      expect(tmTab).toHaveTextContent("100%");
    });
    // The active grid row shows the same match quality inline.
    expect(screen.getByTitle("TM 最佳匹配 100%")).toBeInTheDocument();
    // And the TM dock (default tab) lists the entry with its apply action.
    expect(screen.getByText("应用为草稿")).toBeInTheDocument();
    expect(
      screen.getByText("源：The retention period is 30 days."),
    ).toBeInTheDocument();
    // The match card names the memory the hit came from.
    expect(screen.getByTitle("来源记忆库")).toHaveTextContent("主记忆库");
  });

  it("reports live document stats to the shell status bar", async () => {
    installBridge(baseHandlers());
    const onStatsChange = vi.fn();
    const view = render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
        onStatsChange={onStatsChange}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await waitFor(() => {
      expect(onStatsChange).toHaveBeenCalledWith({
        documentName: "guide.txt",
        counts: {
          total: 1,
          untranslated: 0,
          draft: 1,
          confirmed: 0,
          openIssues: 0,
        },
        // baseHandlers' document.list reports no sourceWords, so the shell
        // gets null — the readout renders nothing rather than counting.
        sourceWords: null,
        activeOrdinal: 0,
        // The target editor is mounted, so the caret readout is live.
        caret: { line: 1, column: 1 },
      });
    });
    // Unmounting (project close) clears the stats instead of leaving the
    // status bar pointing at a document that is no longer open.
    view.unmount();
    expect(onStatsChange).toHaveBeenLastCalledWith(null);
  });

  it("passes the engine's source word count through to the shell stats", async () => {
    const handlers = baseHandlers();
    handlers["document.list"] = () => ({
      documents: [DOCUMENT],
      progress: [
        {
          documentId: "d1",
          counts: {
            total: 1,
            untranslated: 0,
            draft: 1,
            confirmed: 0,
            openIssues: 0,
            // Engine-computed 口径 value; the renderer never counts words.
            sourceWords: 8,
          },
        },
      ],
    });
    installBridge(handlers);
    const onStatsChange = vi.fn();
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
        onStatsChange={onStatsChange}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    await waitFor(() => {
      expect(onStatsChange).toHaveBeenCalledWith(
        expect.objectContaining({ sourceWords: 8 }),
      );
    });
    // The local recount that keeps the explorer live must not drop the
    // engine's word count (target edits never change the source text).
    const lastStats = onStatsChange.mock.calls.at(-1)?.[0] as {
      sourceWords: number | null;
    };
    expect(lastStats.sourceWords).toBe(8);
  });

  it("registers a status-bar jump that applies the 草稿/QA grid filters", async () => {
    installBridge(baseHandlers());
    let jump: ((target: "draft" | "qa") => void) | null = null;
    const view = render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
        onRegisterStatJump={(next) => {
          jump = next;
        }}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    expect(jump).not.toBeNull();

    // 草稿 readout → draft filter: the chip appears and the draft row stays.
    act(() => {
      jump?.("draft");
    });
    expect(
      screen.getByRole("button", { name: "清除状态筛选：草稿" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("句段 1 译文")).toBeInTheDocument();

    // QA readout → QA filter: no open issues, so the grid empties honestly.
    act(() => {
      jump?.("qa");
    });
    expect(
      screen.getByRole("button", { name: "清除状态筛选：QA 问题" }),
    ).toBeInTheDocument();
    expect(screen.getByText("没有符合筛选条件的句段")).toBeInTheDocument();

    // Unmount deregisters: the shell never keeps a jump into a closed view.
    view.unmount();
    expect(jump).toBeNull();
  });
});

describe("WorkbenchView go-to navigation", () => {
  function seg(
    id: string,
    ordinal: number,
    source: string,
    target: string,
    state: Segment["state"],
    locked = false,
  ): Segment {
    return {
      ...SEGMENT,
      id,
      ordinal,
      structuralPath: `p:${ordinal}`,
      sourceText: source,
      targetText: target,
      state,
      ...(locked ? { locked: true } : {}),
    };
  }

  /** Three alpha rows so a text filter can keep everything visible. */
  const NAV_SEGMENTS = [
    seg("s1", 0, "Alpha one.", "一。", "draft"),
    seg("s2", 1, "Alpha two.", "", "untranslated"),
    seg("s3", 2, "Alpha three.", "三。", "draft"),
  ];

  it("go-to-segment jumps by number and reports 没有句段 #n honestly", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    const bridge = installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    act(() => {
      bridge.emitMenuCommand("go-to-segment");
    });
    const dialog = screen.getByRole("dialog", { name: "转到句段" });
    await userEvent.type(within(dialog).getByLabelText("句段号"), "3");
    await userEvent.click(within(dialog).getByRole("button", { name: "转到" }));
    // The selection landed on segment #3; the dialog is gone.
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "转到句段" }),
    ).not.toBeInTheDocument();

    // Out of range: an inline note, the dialog stays, nothing moves.
    act(() => {
      bridge.emitMenuCommand("go-to-segment");
    });
    const reopened = screen.getByRole("dialog", { name: "转到句段" });
    await userEvent.type(within(reopened).getByLabelText("句段号"), "99");
    await userEvent.click(
      within(reopened).getByRole("button", { name: "转到" }),
    );
    expect(within(reopened).getByRole("alert")).toHaveTextContent(
      "没有句段 #99",
    );
    expect(screen.getByLabelText("句段 3 译文")).toBeInTheDocument();
  });

  it("opens the go-to dialog on the renderer-owned Ctrl+G chord", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    expect(
      screen.getByRole("dialog", { name: "转到句段" }),
    ).toBeInTheDocument();
  });

  it("next-untranslated jumps the selection without touching the filter", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    const bridge = installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    // An active text filter that keeps every row visible: the jump must
    // leave it exactly as it is (the filter is a separate channel).
    const filter = screen.getByLabelText("按文本筛选");
    await userEvent.type(filter, "alpha");
    await screen.findByLabelText("句段 1 译文");
    act(() => {
      bridge.emitMenuCommand("next-untranslated");
    });
    expect(await screen.findByLabelText("句段 2 译文")).toBeInTheDocument();
    expect(filter).toHaveValue("alpha");
    // Every alpha row is still visible — nothing was hidden by the jump.
    expect(screen.getByText("Alpha one.")).toBeInTheDocument();
    expect(screen.getByText("Alpha three.")).toBeInTheDocument();
  });

  it("next-* with an empty set reports a short status and keeps the filter", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({
      segments: [
        seg("s1", 0, "Alpha one.", "一。", "confirmed"),
        seg("s2", 1, "Alpha two.", "二。", "draft"),
      ],
    });
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
    const filter = screen.getByLabelText("按文本筛选");
    await userEvent.type(filter, "alpha");
    act(() => {
      bridge.emitMenuCommand("next-untranslated");
    });
    expect(onStatusMessage).toHaveBeenLastCalledWith("没有未译句段");
    act(() => {
      bridge.emitMenuCommand("next-locked");
    });
    expect(onStatusMessage).toHaveBeenLastCalledWith("没有锁定句段");
    act(() => {
      bridge.emitMenuCommand("next-qa");
    });
    expect(onStatusMessage).toHaveBeenLastCalledWith(
      "没有未解决 QA 问题的句段",
    );
    // The filter survived every miss.
    expect(filter).toHaveValue("alpha");
    expect(screen.getByLabelText("句段 1 译文")).toBeInTheDocument();
  });

  it("F8 jumps to the next open QA finding through the same dispatch", async () => {
    const handlers = baseHandlers();
    handlers["segment.list"] = () => ({ segments: NAV_SEGMENTS });
    handlers["qa.list"] = () => ({
      issues: [
        {
          id: "q-nav",
          segmentId: "s3",
          ruleId: "qa.empty-target",
          severity: "error",
          status: "open",
          message: "Target is empty.",
          fingerprint: "fp-nav",
          evidence: {},
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    });
    installBridge(handlers);
    render(
      <WorkbenchView
        project={PROJECT}
        engineState="ready"
        onStatusMessage={vi.fn()}
      />,
    );
    await screen.findByLabelText("句段 1 译文");
    fireEvent.keyDown(window, { key: "F8" });
    expect(await screen.findByLabelText("句段 3 译文")).toBeInTheDocument();
  });
});
