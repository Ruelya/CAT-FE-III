import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Project, Segment } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
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

function installBridge(
  handlers: Record<string, (params: unknown) => unknown>,
): ReturnType<typeof vi.fn> {
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
  const api: Partial<DesktopApi> = { invoke: spy };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return spy;
}

describe("WorkbenchView term insertion", () => {
  it("inserts a dock term at the grid editor caret without saving", async () => {
    const invoke = installBridge(baseHandlers());
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
    const invoke = installBridge(baseHandlers());
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
