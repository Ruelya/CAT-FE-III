import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AiAssistResult,
  AiProviderKind,
  Segment,
} from "@translunar/contracts";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  SelectField,
  TextField,
} from "@translunar/ui";

import { useAiStatus } from "../lib/ai-status.js";
import { diffChars } from "../lib/diff.js";
import { callEngine, describeError, isAiNotConfigured } from "../lib/engine.js";

const PROVIDERS: Array<{ value: AiProviderKind; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "openaiResponses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "deepl", label: "DeepL" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "通义千问" },
  { value: "glm", label: "智谱 GLM" },
  { value: "kimi", label: "Kimi" },
  { value: "volcengine", label: "火山引擎" },
  { value: "openaiCompatible", label: "OpenAI 兼容端点" },
];

/** Assist runs off the engine RPC thread; the panel polls until terminal. */
const ASSIST_POLL_INTERVAL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AiPanelProps {
  activeSegment: Segment | null;
  onApplyDraft: (targetText: string) => void;
  onStatusMessage: (message: string) => void;
}

interface Candidate {
  action: "translate" | "refine";
  result: AiAssistResult;
  /** Target text at request time; the diff is rendered against it. */
  baseTarget: string;
  segmentId: string;
}

export function AiPanel({
  activeSegment,
  onApplyDraft,
  onStatusMessage,
}: AiPanelProps) {
  const { status, configured, setStatus } = useAiStatus();
  const [provider, setProvider] = useState<AiProviderKind>("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [activeAssistId, setActiveAssistId] = useState<string | null>(null);
  // Bumped to invalidate an in-flight poll loop (cancel or unmount).
  const assistGeneration = useRef(0);

  useEffect(() => {
    return () => {
      assistGeneration.current += 1;
    };
  }, []);

  const configure = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await callEngine("ai.configure", {
        provider,
        model,
        baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
        apiKey,
      });
      setStatus(result);
      setApiKey("");
      onStatusMessage(
        `AI 供应商已配置：${result.provider ?? ""} / ${result.model ?? ""}`,
      );
    } catch (configureError) {
      setError(describeError(configureError));
    } finally {
      setBusy(false);
    }
  }, [provider, model, baseUrl, apiKey, onStatusMessage, setStatus]);

  // ai.assist.start returns immediately; the provider call runs off the
  // engine RPC thread and this panel polls ai.assist.status until terminal.
  // The grid, TM lookups, and agent polling stay responsive meanwhile.
  const assist = useCallback(
    async (action: "translate" | "refine") => {
      if (!activeSegment) {
        return;
      }
      const generation = ++assistGeneration.current;
      setBusy(true);
      setError(null);
      setCandidate(null);
      try {
        const started = await callEngine("ai.assist.start", {
          segmentId: activeSegment.id,
          action,
          instruction: null,
        });
        setActiveAssistId(started.assistId);
        let view = started;
        while (view.status === "running") {
          await sleep(ASSIST_POLL_INTERVAL_MS);
          if (assistGeneration.current !== generation) {
            return;
          }
          view = await callEngine("ai.assist.status", {
            assistId: started.assistId,
          });
        }
        if (assistGeneration.current !== generation) {
          return;
        }
        if (view.status === "done" && view.result) {
          setCandidate({
            action,
            result: view.result,
            baseTarget: activeSegment.targetText,
            segmentId: activeSegment.id,
          });
          onStatusMessage(
            `AI ${action === "translate" ? "翻译" : "润色"}完成（${view.result.model}，${view.result.elapsedMs}ms）`,
          );
        } else if (view.status === "failed") {
          setError(`AI 调用失败：${view.errorMessage ?? "未知错误"}`);
        }
        // A canceled run ends silently: the cancel action already reported.
      } catch (assistError) {
        if (assistGeneration.current !== generation) {
          return;
        }
        if (isAiNotConfigured(assistError)) {
          setError("未配置 AI 供应商");
        } else {
          setError(`AI 调用失败：${describeError(assistError)}`);
        }
      } finally {
        if (assistGeneration.current === generation) {
          setBusy(false);
          setActiveAssistId(null);
        }
      }
    },
    [activeSegment, onStatusMessage],
  );

  const cancelAssist = useCallback(async () => {
    if (!activeAssistId) {
      return;
    }
    // Stop the poll loop first so the UI frees up immediately; the engine
    // marks the run canceled and discards any late provider result.
    assistGeneration.current += 1;
    const assistId = activeAssistId;
    setActiveAssistId(null);
    setBusy(false);
    onStatusMessage("已取消 AI 请求");
    try {
      await callEngine("ai.assist.cancel", { assistId });
    } catch {
      // The run may already be terminal or pruned; nothing to surface.
    }
  }, [activeAssistId, onStatusMessage]);

  const confirmedSegment = activeSegment?.state === "confirmed";
  const candidateForActive =
    candidate !== null && candidate.segmentId === activeSegment?.id
      ? candidate
      : null;
  const tagCheck = candidateForActive?.result.tagCheck ?? null;
  const applyBlocked = tagCheck !== null ? !tagCheck.ok : false;

  const diffParts = useMemo(() => {
    if (!candidateForActive) {
      return [];
    }
    return diffChars(
      candidateForActive.baseTarget,
      candidateForActive.result.draftTarget,
    );
  }, [candidateForActive]);

  return (
    <Panel
      title="AI 辅助"
      className="dock-panel"
      actions={
        configured ? (
          <Badge tone="ok">
            {status?.provider} · {status?.model}
          </Badge>
        ) : (
          <Badge tone="warn">未配置</Badge>
        )
      }
    >
      <div className="dock-stack">
        {configured ? (
          <>
            {!activeSegment ? (
              <EmptyState title="未选中句段" />
            ) : confirmedSegment ? (
              <div className="honest-note">该句段已确认</div>
            ) : (
              <div className="tl-toolbar">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void assist("translate")}
                >
                  AI 翻译
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !activeSegment.targetText.trim()}
                  onClick={() => void assist("refine")}
                >
                  AI 润色
                </Button>
                {busy && activeAssistId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void cancelAssist()}
                  >
                    取消请求
                  </Button>
                ) : null}
              </div>
            )}
            {candidateForActive && !confirmedSegment ? (
              <div className="ai-draft" data-testid="ai-candidate">
                <div className="ai-draft__meta">
                  <Badge tone="neutral">
                    {candidateForActive.action === "translate"
                      ? "翻译候选"
                      : "润色候选"}
                  </Badge>
                  {tagCheck ? (
                    tagCheck.ok ? (
                      <Badge tone="ok">标签完整</Badge>
                    ) : (
                      <Badge tone="danger">标签破损</Badge>
                    )
                  ) : null}
                </div>
                <p className="ai-draft__text">
                  {candidateForActive.result.draftTarget}
                </p>
                {candidateForActive.baseTarget.trim() ? (
                  <p className="ai-diff" aria-label="候选与当前译文的差异">
                    {diffParts.map((part, index) => (
                      <span
                        key={`${index}-${part.kind}`}
                        className={
                          part.kind === "insert"
                            ? "ai-diff__ins"
                            : part.kind === "delete"
                              ? "ai-diff__del"
                              : "ai-diff__eq"
                        }
                      >
                        {part.text}
                      </span>
                    ))}
                  </p>
                ) : null}
                {tagCheck && !tagCheck.ok ? (
                  <div className="honest-note" data-tone="danger" role="alert">
                    候选破坏了占位符/标签，不能应用。
                    {tagCheck.missing?.length
                      ? ` 缺失：${tagCheck.missing.join("、")}`
                      : ""}
                    {tagCheck.extra?.length
                      ? ` 多余：${tagCheck.extra.join("、")}`
                      : ""}
                  </div>
                ) : null}
                <div className="tl-toolbar">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={applyBlocked}
                    onClick={() => {
                      onApplyDraft(candidateForActive.result.draftTarget);
                      setCandidate(null);
                    }}
                  >
                    应用为草稿
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCandidate(null)}
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void configure();
              }}
            >
              <SelectField
                label="供应商"
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value as AiProviderKind)
                }
              >
                {PROVIDERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="模型"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                required
              />
              <TextField
                label="Base URL"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <TextField
                label="API Key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                required
              />
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !model.trim() || !apiKey.trim()}
              >
                {busy ? "验证中…" : "保存配置"}
              </Button>
            </form>
          </>
        )}
        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
