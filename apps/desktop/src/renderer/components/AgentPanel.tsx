import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentRunView,
  AgentStep,
  AgentStepNotification,
} from "@translunar/contracts";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  TextAreaField,
} from "@translunar/ui";
import type { BadgeTone } from "@translunar/ui";

import { useAiStatus } from "../lib/ai-status.js";
import { callEngine, describeError, isAiNotConfigured } from "../lib/engine.js";

export interface AgentPanelProps {
  documentId: string | null;
  onCompleted: () => void;
  onStatusMessage: (message: string) => void;
  /** Human gate: jump into the export flow. The agent never exports. */
  onGoExport: () => void;
}

const STEP_TONE: Record<AgentStep["status"], BadgeTone> = {
  done: "ok",
  failed: "danger",
  skipped: "neutral",
};

const STEP_LABEL: Record<AgentStep["kind"], string> = {
  plan: "规划",
  tm: "TM 预翻",
  translate: "AI 起草",
  qa: "质检",
  summary: "总结",
  cancel: "取消",
};

const RUN_STATUS_LABEL: Record<AgentRunView["status"], string> = {
  running: "运行中",
  awaitingReview: "等待人工审核",
  canceled: "已取消",
  failed: "失败",
};

const RUN_STATUS_TONE: Record<AgentRunView["status"], BadgeTone> = {
  running: "neutral",
  awaitingReview: "warn",
  canceled: "neutral",
  failed: "danger",
};

const POLL_INTERVAL_MS = 800;

export function AgentPanel({
  documentId,
  onCompleted,
  onStatusMessage,
  onGoExport,
}: AgentPanelProps) {
  const { configured } = useAiStatus();
  const [instruction, setInstruction] = useState("");
  // The engine allows concurrent runs on different documents; track the
  // latest run per document so switching documents neither hides a live run
  // nor blocks starting one elsewhere.
  const [runs, setRuns] = useState<Record<string, AgentRunView>>({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completedRuns = useRef<Set<string>>(new Set());

  const run = documentId ? (runs[documentId] ?? null) : null;
  const running = run?.status === "running";

  const finishRun = useCallback(
    (finished: AgentRunView) => {
      if (completedRuns.current.has(finished.runId)) {
        return;
      }
      completedRuns.current.add(finished.runId);
      if (finished.status === "awaitingReview") {
        onStatusMessage(
          `Agent 已完成：TM ${finished.tmApplied}，AI 草稿 ${finished.aiDrafted}，失败 ${finished.failedSegments}，QA 未解决 ${finished.openQaIssues}`,
        );
      } else if (finished.status === "canceled") {
        onStatusMessage("Agent 运行已取消");
      } else {
        onStatusMessage("Agent 运行失败");
      }
      onCompleted();
    },
    [onCompleted, onStatusMessage],
  );

  // Live step feed from the engine's reserved notification frames. Steps
  // carry the run id, so concurrent runs never cross wires.
  useEffect(() => {
    return window.tl.onNotification((notification) => {
      if (notification.method !== "notify.ai.agent.step") {
        return;
      }
      const payload = notification.params as AgentStepNotification;
      setRuns((current) => {
        const existing = current[payload.documentId];
        if (!existing || existing.runId !== payload.runId) {
          return current;
        }
        const steps = existing.steps.some(
          (step) => step.index === payload.step.index,
        )
          ? existing.steps
          : [...existing.steps, payload.step];
        return {
          ...current,
          [payload.documentId]: {
            ...existing,
            status: payload.runStatus,
            steps,
          },
        };
      });
    });
  }, []);

  // Poll every running run, not just the visible one: counts and terminal
  // transitions arrive even if a notification frame is missed or the user
  // switched documents.
  useEffect(() => {
    const active = Object.values(runs).filter(
      (view) => view.status === "running",
    );
    if (active.length === 0) {
      return;
    }
    const timer = setInterval(() => {
      for (const target of active) {
        void callEngine("ai.agent.status", { runId: target.runId })
          .then((view) => {
            setRuns((current) =>
              current[view.documentId]?.runId === view.runId
                ? { ...current, [view.documentId]: view }
                : current,
            );
            if (view.status !== "running") {
              finishRun(view);
            }
          })
          .catch(() => {
            // Engine unreachable; keep the last known view.
          });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runs, finishRun]);

  const start = useCallback(async () => {
    if (!documentId || !configured) {
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const view = await callEngine("ai.agent.start", {
        documentId,
        instruction: instruction.trim() ? instruction.trim() : null,
        maxSegments: null,
      });
      setRuns((current) => ({ ...current, [view.documentId]: view }));
      onStatusMessage(
        `Agent 任务单已创建：${view.plannedSegments} 个未翻译句段，TM 预翻 ${view.tmApplied} 个`,
      );
      if (view.status !== "running") {
        finishRun(view);
      }
    } catch (startError) {
      if (isAiNotConfigured(startError)) {
        setError("未配置 AI 供应商");
      } else {
        setError(`Agent 启动失败：${describeError(startError)}`);
      }
    } finally {
      setStarting(false);
    }
  }, [documentId, configured, instruction, onStatusMessage, finishRun]);

  const cancel = useCallback(async () => {
    if (!run) {
      return;
    }
    try {
      const view = await callEngine("ai.agent.cancel", { runId: run.runId });
      setRuns((current) => ({ ...current, [view.documentId]: view }));
      onStatusMessage("已请求取消 Agent 运行");
    } catch (cancelError) {
      setError(`取消失败：${describeError(cancelError)}`);
    }
  }, [run, onStatusMessage]);

  return (
    <Panel
      title="Agent 模式"
      className="dock-panel"
      actions={
        run ? (
          <Badge tone={RUN_STATUS_TONE[run.status]}>
            {RUN_STATUS_LABEL[run.status]}
          </Badge>
        ) : null
      }
    >
      <div className="dock-stack">
        {!configured ? (
          <div className="honest-note" role="note">
            未配置 AI 供应商
          </div>
        ) : null}
        <TextAreaField
          label="任务指令（可选）"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <div className="tl-toolbar">
          <Button
            variant="primary"
            disabled={!documentId || !configured || starting || running}
            onClick={() => void start()}
          >
            {running ? "运行中…" : starting ? "启动中…" : "创建任务单并运行"}
          </Button>
          {running ? (
            <Button variant="outline" onClick={() => void cancel()}>
              {run?.cancelRequested ? "正在取消…" : "取消运行"}
            </Button>
          ) : null}
        </div>
        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
        {run ? (
          <div className="agent-run-summary" data-testid="agent-run-summary">
            <span>计划 {run.plannedSegments}</span>
            <span>TM {run.tmApplied}</span>
            <span>AI 草稿 {run.aiDrafted}</span>
            <span>失败 {run.failedSegments}</span>
            <span>QA 未解决 {run.openQaIssues}</span>
          </div>
        ) : null}
        {run?.status === "awaitingReview" ? (
          <div className="agent-gate" data-testid="agent-human-gate">
            <div className="tl-toolbar">
              <Button size="sm" variant="primary" onClick={onCompleted}>
                去工作台查看草稿
              </Button>
              <Button size="sm" variant="outline" onClick={onGoExport}>
                去导出…
              </Button>
            </div>
          </div>
        ) : null}
        {!run && !error ? <EmptyState title="尚未运行" /> : null}
        {run && run.steps.length > 0 ? (
          <div className="dock-stack">
            {run.steps.map((step) => (
              <div key={`${step.index}-${step.kind}`} className="agent-step">
                <div className="agent-step__meta">
                  <Badge tone={STEP_TONE[step.status]}>
                    {STEP_LABEL[step.kind]}
                  </Badge>
                  <span>#{step.index}</span>
                  {step.segmentId ? (
                    <span>句段 {step.segmentId.slice(0, 8)}…</span>
                  ) : null}
                </div>
                <p className="agent-step__detail">{step.detail}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
