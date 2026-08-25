import { useCallback, useEffect, useState } from "react";

import type {
  AiProviderKind,
  AiStatusResult,
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

import { callEngine, describeError, isAiNotConfigured } from "../lib/engine.js";

const PROVIDERS: Array<{ value: AiProviderKind; label: string }> = [
  { value: "openai", label: "OpenAI" },
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

export interface AiPanelProps {
  activeSegment: Segment | null;
  onApplyDraft: (targetText: string) => void;
  onStatusMessage: (message: string) => void;
}

export function AiPanel({
  activeSegment,
  onApplyDraft,
  onStatusMessage,
}: AiPanelProps) {
  const [status, setStatus] = useState<AiStatusResult | null>(null);
  const [provider, setProvider] = useState<AiProviderKind>("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    void callEngine("ai.status", {})
      .then(setStatus)
      .catch(() => setStatus(null));
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
  }, [provider, model, baseUrl, apiKey, onStatusMessage]);

  const assist = useCallback(
    async (action: "translate" | "refine") => {
      if (!activeSegment) {
        return;
      }
      setBusy(true);
      setError(null);
      setDraft(null);
      try {
        const result = await callEngine("ai.assist", {
          segmentId: activeSegment.id,
          action,
          instruction: null,
        });
        setDraft(result.draftTarget);
        onStatusMessage(
          `AI ${action === "translate" ? "翻译" : "润色"}完成（${result.model}，${result.elapsedMs}ms）`,
        );
      } catch (assistError) {
        if (isAiNotConfigured(assistError)) {
          setError(
            "尚未配置 AI 供应商——引擎拒绝伪造译文。请先在下方填写密钥。",
          );
        } else {
          setError(`AI 调用失败：${describeError(assistError)}`);
        }
      } finally {
        setBusy(false);
      }
    },
    [activeSegment, onStatusMessage],
  );

  const configured = status?.configured === true;

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
              <EmptyState
                title="未选中句段"
                hint="选中句段后可请求 AI 草稿。"
              />
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
              </div>
            )}
            {draft !== null ? (
              <div className="ai-draft">
                <p className="ai-draft__text">{draft}</p>
                <div className="tl-toolbar">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      onApplyDraft(draft);
                      setDraft(null);
                    }}
                  >
                    应用为草稿
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft(null)}
                  >
                    放弃
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="honest-note">
              AI 辅助需要真实的供应商密钥。未配置时引擎会如实返回
              「aiNotConfigured」，不会假装成功。密钥仅保存在引擎内存中。
            </div>
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
                placeholder="例如 gpt-5.2"
                onChange={(event) => setModel(event.target.value)}
                required
              />
              <TextField
                label="Base URL（可选，兼容端点必填）"
                value={baseUrl}
                placeholder="https://…"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <TextField
                label="API Key"
                type="password"
                value={apiKey}
                placeholder="sk-…"
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
