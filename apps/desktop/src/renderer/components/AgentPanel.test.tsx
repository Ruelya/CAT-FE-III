import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRunView } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { AiStatusProvider } from "../lib/ai-status.js";
import { AgentPanel } from "./AgentPanel.js";

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
): void {
  const api: Partial<DesktopApi> = {
    invoke,
    onNotification: () => () => {},
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
}

function renderPanel(
  overrides: Partial<Parameters<typeof AgentPanel>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <AiStatusProvider>
      <AgentPanel
        documentId="d1"
        onCompleted={vi.fn()}
        onStatusMessage={vi.fn()}
        onGoExport={vi.fn()}
        {...overrides}
      />
    </AiStatusProvider>,
  );
}

const runningView: AgentRunView = {
  runId: "run-1",
  documentId: "d1",
  status: "running",
  cancelRequested: false,
  plannedSegments: 3,
  tmApplied: 1,
  aiDrafted: 0,
  failedSegments: 0,
  openQaIssues: 0,
  steps: [
    {
      index: 0,
      kind: "plan",
      status: "done",
      detail: "任务单：3 个未翻译句段",
    },
    {
      index: 1,
      kind: "tm",
      status: "done",
      segmentId: "seg-1",
      detail: "复用精确 TM 匹配，落为草稿",
    },
  ],
  createdAtMs: 1,
  updatedAtMs: 1,
};

const finishedView: AgentRunView = {
  ...runningView,
  status: "awaitingReview",
  aiDrafted: 2,
  openQaIssues: 1,
  steps: [
    ...runningView.steps,
    {
      index: 2,
      kind: "qa",
      status: "done",
      detail: "数字 QA 检查 3 个句段，1 个未解决问题",
    },
    {
      index: 3,
      kind: "summary",
      status: "done",
      detail: "已停在人工审核门",
    },
  ],
  updatedAtMs: 2,
};

afterEach(() => {
  Reflect.deleteProperty(window, "tl");
});

describe("AgentPanel", () => {
  it("refuses to start without a configured provider", async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: true,
        result: { configured: false, provider: null, model: null },
      }),
    );
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/没有密钥时它不会启动/)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "创建任务单并运行" }),
    ).toBeDisabled();
  });

  it("runs the task order and parks at the human gate without confirming or exporting", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      switch (method) {
        case "ai.status":
          return Promise.resolve({
            ok: true,
            result: { configured: true, provider: "openai", model: "m" },
          });
        case "ai.agent.start":
          return Promise.resolve({ ok: true, result: runningView });
        case "ai.agent.status":
          return Promise.resolve({ ok: true, result: finishedView });
        default:
          return Promise.resolve({
            ok: false,
            error: { code: "internal", message: `unexpected ${method}` },
          });
      }
    });
    installBridge(invoke);
    const onCompleted = vi.fn();
    const onGoExport = vi.fn();
    renderPanel({ onCompleted, onGoExport });

    const startButton = await screen.findByRole("button", {
      name: "创建任务单并运行",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await userEvent.click(startButton);

    // Task order counters and live steps appear immediately.
    await waitFor(() => {
      expect(screen.getByTestId("agent-run-summary")).toBeInTheDocument();
    });
    expect(screen.getByText("TM 预翻")).toBeInTheDocument();

    // The poll observes the terminal awaiting-review state: human gate.
    await waitFor(
      () => {
        expect(screen.getByTestId("agent-human-gate")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(onCompleted).toHaveBeenCalled();
    expect(screen.getByText("等待人工审核")).toBeInTheDocument();

    // The gate hands control to the human: export is a click away but was
    // never triggered by the agent itself.
    const invokedMethods = invoke.mock.calls.map(([method]) => method);
    expect(invokedMethods).not.toContain("segment.confirm");
    expect(invokedMethods).not.toContain("document.export");
    await userEvent.click(screen.getByRole("button", { name: "去导出…" }));
    expect(onGoExport).toHaveBeenCalled();
  });

  it("tracks runs per document so another document can start while one runs", async () => {
    const secondRun: AgentRunView = {
      ...runningView,
      runId: "run-2",
      documentId: "d2",
    };
    const invoke = vi.fn(
      (method: string, params: unknown): Promise<EngineInvokeResponse> => {
        switch (method) {
          case "ai.status":
            return Promise.resolve({
              ok: true,
              result: { configured: true, provider: "openai", model: "m" },
            });
          case "ai.agent.start": {
            const { documentId } = params as { documentId: string };
            return Promise.resolve({
              ok: true,
              result: documentId === "d1" ? runningView : secondRun,
            });
          }
          case "ai.agent.status": {
            const { runId } = params as { runId: string };
            return Promise.resolve({
              ok: true,
              result: runId === "run-1" ? runningView : secondRun,
            });
          }
          default:
            return Promise.resolve({
              ok: false,
              error: { code: "internal", message: `unexpected ${method}` },
            });
        }
      },
    );
    installBridge(invoke);
    const props = {
      onCompleted: vi.fn(),
      onStatusMessage: vi.fn(),
      onGoExport: vi.fn(),
    };
    const view = render(
      <AiStatusProvider>
        <AgentPanel documentId="d1" {...props} />
      </AiStatusProvider>,
    );

    const startButton = await screen.findByRole("button", {
      name: "创建任务单并运行",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await userEvent.click(startButton);
    await screen.findByRole("button", { name: "运行中…" });

    // Switching documents does not block the other document: the engine
    // allows concurrent runs on different documents.
    view.rerender(
      <AiStatusProvider>
        <AgentPanel documentId="d2" {...props} />
      </AiStatusProvider>,
    );
    const startForSecond = await screen.findByRole("button", {
      name: "创建任务单并运行",
    });
    await waitFor(() => expect(startForSecond).toBeEnabled());
    await userEvent.click(startForSecond);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ai.agent.start",
        expect.objectContaining({ documentId: "d2" }),
      );
    });
    await screen.findByRole("button", { name: "运行中…" });

    // Switching back still shows the first document's live run.
    view.rerender(
      <AiStatusProvider>
        <AgentPanel documentId="d1" {...props} />
      </AiStatusProvider>,
    );
    await screen.findByRole("button", { name: "运行中…" });
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });

  it("cancels a running task order", async () => {
    const canceledView: AgentRunView = {
      ...runningView,
      status: "canceled",
      cancelRequested: true,
      steps: [
        ...runningView.steps,
        {
          index: 2,
          kind: "cancel",
          status: "done",
          detail: "运行已取消：已生成的草稿保留，剩余句段未触碰",
        },
      ],
    };
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      switch (method) {
        case "ai.status":
          return Promise.resolve({
            ok: true,
            result: { configured: true, provider: "openai", model: "m" },
          });
        case "ai.agent.start":
          return Promise.resolve({ ok: true, result: runningView });
        case "ai.agent.cancel":
          return Promise.resolve({ ok: true, result: canceledView });
        case "ai.agent.status":
          return Promise.resolve({ ok: true, result: canceledView });
        default:
          return Promise.resolve({
            ok: false,
            error: { code: "internal", message: `unexpected ${method}` },
          });
      }
    });
    installBridge(invoke);
    renderPanel();

    const startButton = await screen.findByRole("button", {
      name: "创建任务单并运行",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await userEvent.click(startButton);
    await userEvent.click(
      await screen.findByRole("button", { name: "取消运行" }),
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai.agent.cancel", {
        runId: "run-1",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("已取消")).toBeInTheDocument();
    });
    expect(screen.getByText("取消")).toBeInTheDocument();
  });
});
