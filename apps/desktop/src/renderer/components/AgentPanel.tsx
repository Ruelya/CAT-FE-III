import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentRunResult,
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

import { callEngine, describeError, isAiNotConfigured } from "../lib/engine.js";

export interface AgentPanelProps {
  documentId: string | null;
  onCompleted: () => void;
  onStatusMessage: (message: string) => void;
}

const STEP_TONE: Record<AgentStep["status"], BadgeTone> = {
  done: "ok",
  failed: "danger",
  skipped: "neutral",
};

const STEP_LABEL: Record<AgentStep["kind"], string> = {
  plan: "规划",
  translate: "翻译",
  qa: "质检",
  summary: "总结",
};

export function AgentPanel({
  documentId,
  onCompleted,
  onStatusMessage,
}: AgentPanelProps) {
  const [instruction, setInstruction] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningDocument = useRef<string | null>(null);

  // Live step feed from the engine's reserved notification frames.
  useEffect(() => {
    return window.tl.onNotification((notification) => {
      if (notification.method !== "notify.ai.agent.step") {
        return;
      }
      const payload = notification.params as AgentStepNotification;
      if (
        runningDocument.current &&
        payload.documentId === runningDocument.current
      ) {
        setSteps((current) => [...current, payload.step]);
      }
    });
  }, []);

  const run = useCallback(async () => {
    if (!documentId) {
      return;
    }
    setRunning(true);
    setError(null);
    setSteps([]);
    setResult(null);
    runningDocument.current = documentId;
    try {
      const runResult = await callEngine("ai.agent.run", {
        documentId,
        instruction: instruction.trim() ? instruction.trim() : null,
        maxSegments: null,
      });
      setResult(runResult);
      setSteps(runResult.steps);
      onStatusMessage(
        `Agent 运行结束：翻译 ${runResult.translatedSegments}，失败 ${runResult.failedSegments}，QA 未解决 ${runResult.openQaIssues}`,
      );
      onCompleted();
    } catch (runError) {
      if (isAiNotConfigured(runError)) {
        setError(
          "Agent 需要已配置的 AI 供应商才会启动——它不会假装完成任务。请先在「AI 辅助」页配置密钥。",
        );
      } else {
        setError(`Agent 运行失败：${describeError(runError)}`);
      }
    } finally {
      setRunning(false);
      runningDocument.current = null;
    }
  }, [documentId, instruction, onCompleted, onStatusMessage]);

  const statusTone: BadgeTone =
    result?.status === "completed"
      ? "ok"
      : result?.status === "completedWithIssues"
        ? "warn"
        : result?.status === "failed"
          ? "danger"
          : "neutral";

  return (
    <Panel
      title="Agent 模式"
      className="dock-panel"
      actions={result ? <Badge tone={statusTone}>{result.status}</Badge> : null}
    >
      <div className="dock-stack">
        <div className="honest-note">
          Agent 会规划并执行：优先复用精确 TM，其余句段调用 AI
          起草，最后运行数字 QA 并汇报。每一步通过引擎通知帧实时回传。
        </div>
        <TextAreaField
          label="任务指令（可选）"
          value={instruction}
          placeholder="例如：品牌名保留英文，语气正式。"
          onChange={(event) => setInstruction(event.target.value)}
        />
        <Button
          variant="primary"
          disabled={!documentId || running}
          onClick={() => void run()}
        >
          {running ? "运行中…" : "对当前文档运行 Agent"}
        </Button>
        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
        {steps.length === 0 && !error ? (
          <EmptyState
            title="尚未运行"
            hint="运行后会在此显示规划、逐句翻译、质检与总结的实时步骤。"
          />
        ) : (
          <div className="dock-stack">
            {steps.map((step) => (
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
        )}
      </div>
    </Panel>
  );
}
