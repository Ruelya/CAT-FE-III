import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { EditorMutationResult, Segment } from "@translunar/contracts";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Cpu,
  Database,
  HardDrive,
  MessageSquarePlus,
  Send,
} from "lucide-react";

import {
  assistantReducer,
  compactMetric,
  createAssistantTurn,
  createInitialAssistantState,
  formatElapsed,
  type AssistantAction,
  type AssistantMetrics,
  type AssistantModel,
  type ReasoningLevel,
} from "./assistant-state";
import { LiveAssistantPanel } from "./LiveAssistantPanel";
import { WorkbenchVisualState } from "./WorkbenchVisualState";
import { useLocale } from "./i18n/LocaleProvider";
import type { MessageKey } from "./i18n/messages";

interface AssistantPanelProps {
  activeSegment: Segment | undefined;
  onUseTarget(target: string): void;
  projectId?: string;
  onApplyMutation?(mutation: EditorMutationResult): void;
}

const QUICK_ACTIONS: Array<{
  action: Exclude<AssistantAction, "prompt">;
  labelKey: MessageKey;
  promptKey: MessageKey;
}> = [
  {
    action: "improve",
    labelKey: "assistant.action.improve",
    promptKey: "assistant.prompt.improve",
  },
  {
    action: "fix-terms",
    labelKey: "assistant.action.fixTerms",
    promptKey: "assistant.prompt.fixTerms",
  },
  {
    action: "shorten",
    labelKey: "assistant.action.shorten",
    promptKey: "assistant.prompt.shorten",
  },
  {
    action: "explain",
    labelKey: "assistant.action.explain",
    promptKey: "assistant.prompt.explain",
  },
];

export function AssistantPanel({
  activeSegment,
  onUseTarget,
  projectId,
  onApplyMutation,
}: AssistantPanelProps) {
  const [liveAvailable, setLiveAvailable] = useState(false);
  const canUseLive = Boolean(projectId && onApplyMutation);
  useEffect(() => {
    if (!projectId || !canUseLive) {
      setLiveAvailable(false);
      return;
    }
    let cancelled = false;
    void Promise.all([
      window.translunar.invoke("ai.settings.get", {}),
      window.translunar.invoke("ai.provider.list", { offset: 0, limit: 100 }),
    ])
      .then(([settings, providers]) => {
        if (!cancelled) {
          setLiveAvailable(
            settings.enabled &&
              settings.allowInteractive &&
              providers.items.some(
                (profile) => profile.enabled && profile.credentialPresent,
              ),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setLiveAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canUseLive, projectId]);

  if (liveAvailable && projectId && onApplyMutation) {
    return (
      <LiveAssistantPanel
        projectId={projectId}
        activeSegment={activeSegment}
        onApplyMutation={onApplyMutation}
      />
    );
  }
  return (
    <OfflineAssistantPanel
      activeSegment={activeSegment}
      onUseTarget={onUseTarget}
    />
  );
}

function OfflineAssistantPanel({
  activeSegment,
  onUseTarget,
}: Pick<AssistantPanelProps, "activeSegment" | "onUseTarget">) {
  const { t } = useLocale();
  const [state, dispatch] = useReducer(
    assistantReducer,
    activeSegment,
    createInitialAssistantState,
  );
  const [conversationOpen, setConversationOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [composerComposing, setComposerComposing] = useState(false);
  const [appliedMessageId, setAppliedMessageId] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const activeConversation = useMemo(
    () =>
      state.conversations.find(
        (item) => item.id === state.activeConversationId,
      ) ?? state.conversations[0],
    [state.activeConversationId, state.conversations],
  );

  const appendTurn = (action: AssistantAction, text: string) => {
    if (!activeConversation || composerComposing || !text.trim()) return;
    setAppliedMessageId(null);
    sequenceRef.current += 1;
    const turn = createAssistantTurn(
      activeSegment,
      action,
      text.trim(),
      state.model,
      state.reasoning,
      `turn-${sequenceRef.current}`,
    );
    dispatch({
      type: "append-turn",
      conversationId: activeConversation.id,
      ...turn,
    });
  };

  const submitPrompt = () => {
    const value = prompt.trim();
    if (!value || composerComposing) return;
    appendTurn("prompt", value);
    setPrompt("");
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      (!event.ctrlKey && !event.metaKey) ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      composerComposing
    ) {
      return;
    }
    event.preventDefault();
    submitPrompt();
  };

  return (
    <div className="assistant-workspace">
      <div className="assistant-toolbar">
        <div className="conversation-picker">
          <button
            type="button"
            className="conversation-trigger"
            aria-haspopup="menu"
            aria-expanded={conversationOpen}
            onClick={() => setConversationOpen((open) => !open)}
          >
            <span>
              {activeConversation?.title ?? t("assistant.conversation")}
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {conversationOpen ? (
            <div className="conversation-popover" role="menu">
              <button
                type="button"
                className="conversation-new"
                role="menuitem"
                onClick={() => {
                  sequenceRef.current += 1;
                  dispatch({
                    type: "new-conversation",
                    id: `conversation-${sequenceRef.current}`,
                  });
                  setConversationOpen(false);
                }}
              >
                <MessageSquarePlus size={14} />
                {t("assistant.newConversation")}
              </button>
              <div className="conversation-list">
                {state.conversations.map((conversation) => (
                  <div
                    className="conversation-row"
                    data-selected={
                      conversation.id === state.activeConversationId
                    }
                    key={conversation.id}
                  >
                    <button
                      type="button"
                      className="conversation-select"
                      role="menuitemradio"
                      aria-checked={
                        conversation.id === state.activeConversationId
                      }
                      onClick={() => {
                        dispatch({
                          type: "select-conversation",
                          id: conversation.id,
                        });
                        setConversationOpen(false);
                      }}
                    >
                      {conversation.title}
                    </button>
                    <button
                      type="button"
                      className="conversation-archive"
                      role="menuitem"
                      aria-label={t("assistant.archiveNamed", {
                        title: conversation.title,
                      })}
                      title={t("assistant.archive")}
                      disabled={state.conversations.length <= 1}
                      onClick={() =>
                        dispatch({
                          type: "archive-conversation",
                          id: conversation.id,
                        })
                      }
                    >
                      <Archive size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="assistant-engine-controls">
          <label>
            <span>{t("common.model")}</span>
            <select
              aria-label={t("assistant.requestedModel")}
              value={state.model}
              onChange={(event) =>
                dispatch({
                  type: "set-model",
                  model: event.currentTarget.value as AssistantModel,
                })
              }
            >
              <option value="grok-4.5">grok-4.5</option>
              <option value="openai-compatible">
                {t("assistant.openAiProfile")}
              </option>
              <option value="local-preview">
                {t("assistant.localPreview")}
              </option>
            </select>
          </label>
          <label>
            <span>{t("common.reasoning")}</span>
            <select
              aria-label={t("assistant.reasoningLevel")}
              value={state.reasoning}
              onChange={(event) =>
                dispatch({
                  type: "set-reasoning",
                  reasoning: event.currentTarget.value as ReasoningLevel,
                })
              }
            >
              <option value="low">{t("common.low")}</option>
              <option value="medium">{t("common.medium")}</option>
              <option value="high">{t("common.high")}</option>
            </select>
          </label>
        </div>
        <span className="assistant-provider-note">
          {t("assistant.offlinePreview")}
        </span>
      </div>

      <div className="assistant-context">
        <span>{t("common.active")}</span>
        <strong>{activeSegment ? activeSegment.ordinal + 1 : "—"}</strong>
        <p title={activeSegment?.sourceText}>{activeSegment?.sourceText}</p>
      </div>

      <div
        className="assistant-quick-actions"
        aria-label={t("assistant.actionsAria")}
      >
        {QUICK_ACTIONS.map((item) => (
          <button
            type="button"
            key={item.action}
            onClick={() => appendTurn(item.action, t(item.promptKey))}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div className="assistant-transcript">
        {activeConversation?.messages.length ? (
          activeConversation.messages.map((message) => (
            <article
              className={`assistant-message ${message.role}`}
              key={message.id}
            >
              <span className="assistant-message-role">
                {message.role === "user"
                  ? t("assistant.you")
                  : t("assistant.roleAssistant")}
              </span>
              <p className={message.targetText ? "cjk" : undefined}>
                {message.text}
              </p>
              {message.role === "assistant" && message.targetText ? (
                <div className="assistant-message-actions">
                  <button
                    type="button"
                    className={
                      appliedMessageId === message.id ? "applied" : undefined
                    }
                    aria-label={t("assistant.useInTarget")}
                    disabled={appliedMessageId === message.id}
                    onClick={() => {
                      onUseTarget(message.targetText ?? "");
                      setAppliedMessageId(message.id);
                    }}
                  >
                    {appliedMessageId === message.id ? (
                      <>
                        <Check size={12} />
                        {t("assistant.applied")}
                      </>
                    ) : (
                      "Use in target"
                    )}
                  </button>
                </div>
              ) : null}
              {message.metrics ? (
                <AssistantMetricsFooter metrics={message.metrics} />
              ) : null}
            </article>
          ))
        ) : (
          <WorkbenchVisualState
            kind="empty"
            variant="assistant"
            label={t("workbench.noAssistantConversation")}
          />
        )}
      </div>

      <div className="assistant-composer">
        <textarea
          value={prompt}
          aria-label={t("assistant.askAria")}
          placeholder={t("assistant.askPlaceholderDots")}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onCompositionStart={() => setComposerComposing(true)}
          onCompositionEnd={() => setComposerComposing(false)}
          onKeyDown={onComposerKeyDown}
        />
        <button
          type="button"
          aria-label={t("assistant.sendAria")}
          title={t("common.send")}
          disabled={!prompt.trim() || composerComposing}
          onClick={submitPrompt}
        >
          <Send size={15} />
          {t("common.send")}
        </button>
      </div>
    </div>
  );
}

function AssistantMetricsFooter({ metrics }: { metrics: AssistantMetrics }) {
  const { t, formatNumber } = useLocale();
  const items = [
    {
      key: "model",
      value: metrics.model,
      label: t("assistant.metric.offlineModel", { model: metrics.model }),
      icon: <Cpu size={12} />,
    },
    {
      key: "input",
      value: compactMetric(metrics.inputTokens),
      label: t("assistant.metric.inputTokens", {
        count: formatNumber(metrics.inputTokens),
      }),
      icon: <ArrowDownToLine size={12} />,
    },
    {
      key: "cache-read",
      value: compactMetric(metrics.cacheReadTokens),
      label: t("assistant.metric.cacheRead", {
        count: formatNumber(metrics.cacheReadTokens),
      }),
      icon: <Database size={12} />,
    },
    {
      key: "thinking",
      value: compactMetric(metrics.thinkingTokens),
      label: t("assistant.metric.thinking", {
        count: formatNumber(metrics.thinkingTokens),
      }),
      icon: <Brain size={12} />,
    },
    {
      key: "output",
      value: compactMetric(metrics.outputTokens),
      label: t("assistant.metric.outputTokens", {
        count: formatNumber(metrics.outputTokens),
      }),
      icon: <ArrowUpFromLine size={12} />,
    },
    {
      key: "cache-write",
      value: compactMetric(metrics.cacheWriteTokens),
      label: t("assistant.metric.cacheWrite", {
        count: formatNumber(metrics.cacheWriteTokens),
      }),
      icon: <HardDrive size={12} />,
    },
    {
      key: "elapsed",
      value: formatElapsed(metrics.elapsedMs),
      label: t("assistant.metric.elapsed", {
        value: formatElapsed(metrics.elapsedMs),
      }),
      icon: <Clock3 size={12} />,
      elapsed: true,
    },
  ];
  return (
    <div className="assistant-metrics" aria-label={t("assistant.metricsAria")}>
      {items.map((item) => (
        <span
          className={
            item.elapsed ? "assistant-metric elapsed" : "assistant-metric"
          }
          key={item.key}
          tabIndex={0}
          title={item.label}
          data-tooltip={item.label}
          aria-label={item.label}
        >
          {item.icon}
          <span>{item.value}</span>
        </span>
      ))}
    </div>
  );
}
