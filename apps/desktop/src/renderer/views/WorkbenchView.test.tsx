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

/** Engine responses shared by both tests; per-test handlers layer on top. */
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
      return Promise.resolve({ ok: true, result: handler(params) });
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
    render(<WorkbenchView project={PROJECT} onStatusMessage={vi.fn()} />);
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
    render(<WorkbenchView project={PROJECT} onStatusMessage={vi.fn()} />);
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
    render(<WorkbenchView project={PROJECT} onStatusMessage={vi.fn()} />);
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
    render(<WorkbenchView project={PROJECT} onStatusMessage={vi.fn()} />);
    await screen.findByLabelText("句段 1 译文");
    act(() => {
      bridge.emitMenuCommand("import-document");
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("导入文档");
  });

  it("routes menu export through the same chooseExportPath dialog", async () => {
    const bridge = installBridge(baseHandlers());
    render(<WorkbenchView project={PROJECT} onStatusMessage={vi.fn()} />);
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
    render(<WorkbenchView project={PROJECT} onStatusMessage={vi.fn()} />);
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
      <WorkbenchView project={PROJECT} onStatusMessage={onStatusMessage} />,
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
    render(<WorkbenchView project={PROJECT} onStatusMessage={vi.fn()} />);
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
