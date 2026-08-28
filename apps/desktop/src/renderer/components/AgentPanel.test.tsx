import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentProposal, AgentRunView } from "@translunar/contracts";
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
        onGoQa={vi.fn()}
        onJumpToSegment={vi.fn()}
        {...overrides}
      />
    </AiStatusProvider>,
  );
}

function runView(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    runId: "run-1",
    documentId: "d1",
    status: "running",
    approvalMode: "auto",
    profileId: "profile-1",
    provider: "openai",
    model: "m",
    cancelRequested: false,
    plannedSegments: 3,
    eligibleSegments: 3,
    processedSegments: 0,
    tmApplied: 1,
    aiDrafted: 0,
    skippedSegments: 0,
    failedSegments: 0,
    failedSegmentIds: [],
    autoConfirmed: 0,
    openQaIssues: 0,
    proposals: [],
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
    ...overrides,
  };
}

function proposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    segmentId: "seg-a",
    sourceText: "Alpha sentence.",
    draftTarget: "候选甲。",
    provider: "openai",
    model: "m",
    elapsedMs: 12,
    tagCheck: { ok: true, missing: [], extra: [] },
    status: "pending",
    note: null,
    ...overrides,
  };
}

const runningView = runView();

const finishedView = runView({
  status: "awaitingReview",
  aiDrafted: 2,
  processedSegments: 3,
  openQaIssues: 1,
  steps: [
    ...runningView.steps,
    {
      index: 2,
      kind: "qa",
      status: "done",
      detail: "QA 检查 3 个句段，1 个未解决问题",
    },
    {
      index: 3,
      kind: "summary",
      status: "done",
      detail: "已停在人工审核门",
    },
  ],
  updatedAtMs: 2,
});

const CONFIGURED_STATUS: EngineInvokeResponse = {
  ok: true,
  result: { configured: true, provider: "openai", model: "m", profileCount: 1 },
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
      expect(screen.getByText("未配置 AI 供应商")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "创建任务单并运行" }),
    ).toBeDisabled();
  });

  it("runs the task order and parks at the human gate without confirming or exporting", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      switch (method) {
        case "ai.status":
          return Promise.resolve(CONFIGURED_STATUS);
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

    // The progress readout carries the real engine counters.
    expect(screen.getByTestId("agent-progress")).toHaveTextContent(
      "已处理 3 / 3",
    );

    // The gate hands control to the human: export is a click away but was
    // never triggered by the agent itself.
    const invokedMethods = invoke.mock.calls.map(([method]) => method);
    expect(invokedMethods).not.toContain("segment.confirm");
    expect(invokedMethods).not.toContain("document.export");
    await userEvent.click(screen.getByRole("button", { name: "去导出…" }));
    expect(onGoExport).toHaveBeenCalled();
  });

  it("sends the selected approval tier and cap with ai.agent.start", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      switch (method) {
        case "ai.status":
          return Promise.resolve(CONFIGURED_STATUS);
        case "ai.agent.start":
          return Promise.resolve({
            ok: true,
            result: runView({ status: "awaitingReview", processedSegments: 3 }),
          });
        default:
          return Promise.resolve({
            ok: false,
            error: { code: "internal", message: `unexpected ${method}` },
          });
      }
    });
    installBridge(invoke);
    renderPanel();

    // The three tiers describe themselves with distinct one-liners.
    const manualTab = await screen.findByRole("tab", { name: "手动" });
    expect(manualTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("候选进入待审队列，人工批准后写入草稿"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Turbo" }));
    expect(
      screen.getByText("草稿写入后，QA 无错误的句段自动确认并写入 TM"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "自动" }));
    expect(
      screen.getByText("标签完整的候选自动写入草稿，确认由人工完成"),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("句段上限（默认 50）"), "2");
    const startButton = screen.getByRole("button", {
      name: "创建任务单并运行",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await userEvent.click(startButton);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ai.agent.start",
        expect.objectContaining({
          documentId: "d1",
          approvalMode: "auto",
          maxSegments: 2,
          segmentIds: null,
        }),
      );
    });
  });

  it("queues manual-tier proposals and reviews them through ai.agent.review", async () => {
    const pendingA = proposal();
    const pendingB = proposal({
      segmentId: "seg-b",
      sourceText: "Bravo sentence.",
      draftTarget: "候选乙。",
    });
    const manualFinished = runView({
      status: "awaitingReview",
      approvalMode: "manual",
      processedSegments: 2,
      plannedSegments: 2,
      eligibleSegments: 2,
      tmApplied: 0,
      proposals: [pendingA, pendingB],
      steps: [],
    });
    const afterApply = {
      ...manualFinished,
      aiDrafted: 1,
      proposals: [{ ...pendingA, status: "applied" as const }, pendingB],
    };
    const afterReject = {
      ...afterApply,
      proposals: [
        { ...pendingA, status: "applied" as const },
        { ...pendingB, status: "rejected" as const },
      ],
    };
    let reviews = 0;
    const invoke = vi.fn(
      (method: string, params: unknown): Promise<EngineInvokeResponse> => {
        switch (method) {
          case "ai.status":
            return Promise.resolve(CONFIGURED_STATUS);
          case "ai.agent.start":
            return Promise.resolve({ ok: true, result: manualFinished });
          case "ai.agent.review": {
            reviews += 1;
            void params;
            return Promise.resolve({
              ok: true,
              result: reviews === 1 ? afterApply : afterReject,
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
    const onCompleted = vi.fn();
    renderPanel({ onCompleted });

    const startButton = await screen.findByRole("button", {
      name: "创建任务单并运行",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await userEvent.click(startButton);

    // Both candidates sit in the queue; the grid stays untouched (no
    // segment.update went out) and the counters say so.
    await waitFor(() => {
      expect(screen.getByTestId("agent-proposals")).toBeInTheDocument();
    });
    expect(screen.getByText("待审候选 2")).toBeInTheDocument();
    expect(screen.getByText("候选甲。")).toBeInTheDocument();
    expect(screen.getByText("候选乙。")).toBeInTheDocument();
    expect(screen.getByTestId("agent-run-summary")).toHaveTextContent(
      "AI 草稿 0",
    );

    // Approving the first proposal reviews exactly that segment.
    const [firstApprove] = screen.getAllByRole("button", { name: "批准" });
    expect(firstApprove).toBeDefined();
    await userEvent.click(firstApprove!);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai.agent.review", {
        runId: "run-1",
        segmentIds: ["seg-a"],
        decision: "apply",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("已写入")).toBeInTheDocument();
    });
    expect(onCompleted).toHaveBeenCalled();

    // 全部拒绝 sweeps the remaining pending ids.
    await userEvent.click(screen.getByRole("button", { name: "全部拒绝" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai.agent.review", {
        runId: "run-1",
        segmentIds: ["seg-b"],
        decision: "reject",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("已拒绝")).toBeInTheDocument();
    });
    const invokedMethods = invoke.mock.calls.map(([method]) => method);
    expect(invokedMethods).not.toContain("segment.update");
    expect(invokedMethods).not.toContain("segment.confirm");
  });

  it("reports turbo auto-confirms and opens the QA dock from the gate", async () => {
    const turboFinished = runView({
      status: "awaitingReview",
      approvalMode: "turbo",
      processedSegments: 3,
      aiDrafted: 2,
      autoConfirmed: 1,
      openQaIssues: 1,
      steps: [
        {
          index: 0,
          kind: "confirm",
          status: "done",
          segmentId: "seg-1",
          detail: "QA 通过，已确认并写入 TM",
        },
      ],
    });
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      switch (method) {
        case "ai.status":
          return Promise.resolve(CONFIGURED_STATUS);
        case "ai.agent.start":
          return Promise.resolve({ ok: true, result: turboFinished });
        default:
          return Promise.resolve({
            ok: false,
            error: { code: "internal", message: `unexpected ${method}` },
          });
      }
    });
    installBridge(invoke);
    const onGoQa = vi.fn();
    renderPanel({ onGoQa });

    const startButton = await screen.findByRole("button", {
      name: "创建任务单并运行",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await userEvent.click(startButton);

    // The summary carries the real auto-confirm counter and the confirm
    // step from the engine feed.
    await waitFor(() => {
      expect(screen.getByTestId("agent-run-summary")).toHaveTextContent(
        "自动确认 1",
      );
    });
    expect(screen.getByText("确认")).toBeInTheDocument();

    // Leftover QA issues hand off to the QA dock, a human finishes there.
    await userEvent.click(
      screen.getByRole("button", { name: "查看 QA 修复项" }),
    );
    expect(onGoQa).toHaveBeenCalled();
  });

  it("reruns exactly the failed segments as a fresh scoped run", async () => {
    const failedFinished = runView({
      status: "awaitingReview",
      processedSegments: 3,
      failedSegments: 2,
      failedSegmentIds: ["seg-8", "seg-9"],
      steps: [],
    });
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      switch (method) {
        case "ai.status":
          return Promise.resolve(CONFIGURED_STATUS);
        case "ai.agent.start":
          return Promise.resolve({ ok: true, result: failedFinished });
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

    const rerunButton = await screen.findByRole("button", {
      name: "重跑失败句段（2）",
    });
    await userEvent.click(rerunButton);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ai.agent.start",
        expect.objectContaining({
          segmentIds: ["seg-8", "seg-9"],
          approvalMode: "auto",
          profileId: "profile-1",
        }),
      );
    });
  });

  it("jumps to the segment behind a step", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      switch (method) {
        case "ai.status":
          return Promise.resolve(CONFIGURED_STATUS);
        case "ai.agent.start":
          return Promise.resolve({ ok: true, result: finishedView });
        default:
          return Promise.resolve({
            ok: false,
            error: { code: "internal", message: `unexpected ${method}` },
          });
      }
    });
    installBridge(invoke);
    const onJumpToSegment = vi.fn();
    renderPanel({ onJumpToSegment });

    const startButton = await screen.findByRole("button", {
      name: "创建任务单并运行",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await userEvent.click(startButton);

    const jump = await screen.findByRole("button", { name: "定位句段" });
    await userEvent.click(jump);
    expect(onJumpToSegment).toHaveBeenCalledWith("seg-1");
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
            return Promise.resolve(CONFIGURED_STATUS);
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
      onGoQa: vi.fn(),
      onJumpToSegment: vi.fn(),
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
          return Promise.resolve(CONFIGURED_STATUS);
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
