import {
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Segment } from "@translunar/contracts";
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

interface AssistantPanelProps {
  activeSegment: Segment | undefined;
  onUseTarget(target: string): void;
}

const QUICK_ACTIONS: Array<{
  action: Exclude<AssistantAction, "prompt">;
  label: string;
  prompt: string;
}> = [
  { action: "improve", label: "Improve", prompt: "Improve this target" },
  { action: "fix-terms", label: "Fix terms", prompt: "Fix terminology" },
  { action: "shorten", label: "Shorten", prompt: "Shorten the target" },
  { action: "explain", label: "Explain", prompt: "Explain the source" },
];

export function AssistantPanel({
  activeSegment,
  onUseTarget,
}: AssistantPanelProps) {
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
            <span>{activeConversation?.title ?? "Conversation"}</span>
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
                New conversation
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
                      aria-label={`Archive ${conversation.title}`}
                      title="Archive conversation"
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
            <span>Model</span>
            <select
              aria-label="Requested model"
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
                OpenAI-compatible profile
              </option>
              <option value="local-preview">Local preview</option>
            </select>
          </label>
          <label>
            <span>Reasoning</span>
            <select
              aria-label="Reasoning level"
              value={state.reasoning}
              onChange={(event) =>
                dispatch({
                  type: "set-reasoning",
                  reasoning: event.currentTarget.value as ReasoningLevel,
                })
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <span className="assistant-provider-note">Offline preview</span>
      </div>

      <div className="assistant-context">
        <span>Active</span>
        <strong>{activeSegment ? activeSegment.ordinal + 1 : "—"}</strong>
        <p title={activeSegment?.sourceText}>{activeSegment?.sourceText}</p>
      </div>

      <div className="assistant-quick-actions" aria-label="Assistant actions">
        {QUICK_ACTIONS.map((item) => (
          <button
            type="button"
            key={item.action}
            onClick={() => appendTurn(item.action, item.prompt)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="assistant-transcript" aria-live="polite">
        {activeConversation?.messages.length ? (
          activeConversation.messages.map((message) => (
            <article
              className={`assistant-message ${message.role}`}
              key={message.id}
            >
              <span className="assistant-message-role">
                {message.role === "user" ? "You" : "Assistant"}
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
                    aria-label="Use in target"
                    disabled={appliedMessageId === message.id}
                    onClick={() => {
                      onUseTarget(message.targetText ?? "");
                      setAppliedMessageId(message.id);
                    }}
                  >
                    {appliedMessageId === message.id ? (
                      <>
                        <Check size={12} />
                        Applied
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
          <div className="assistant-empty">
            <strong>No messages</strong>
          </div>
        )}
      </div>

      <div className="assistant-composer">
        <textarea
          value={prompt}
          aria-label="Ask about the active segment"
          placeholder="Ask about the active segment..."
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onCompositionStart={() => setComposerComposing(true)}
          onCompositionEnd={() => setComposerComposing(false)}
          onKeyDown={onComposerKeyDown}
        />
        <button
          type="button"
          aria-label="Send assistant message"
          title="Send"
          disabled={!prompt.trim() || composerComposing}
          onClick={submitPrompt}
        >
          <Send size={15} />
          Send
        </button>
      </div>
    </div>
  );
}

function AssistantMetricsFooter({ metrics }: { metrics: AssistantMetrics }) {
  const items = [
    {
      key: "model",
      value: metrics.model,
      label: `Offline model profile: ${metrics.model}`,
      icon: <Cpu size={12} />,
    },
    {
      key: "input",
      value: compactMetric(metrics.inputTokens),
      label: `Synthetic input tokens: ${metrics.inputTokens.toLocaleString("en-US")}`,
      icon: <ArrowDownToLine size={12} />,
    },
    {
      key: "cache-read",
      value: compactMetric(metrics.cacheReadTokens),
      label: `Synthetic cache read tokens: ${metrics.cacheReadTokens.toLocaleString("en-US")}`,
      icon: <Database size={12} />,
    },
    {
      key: "thinking",
      value: compactMetric(metrics.thinkingTokens),
      label: `Synthetic thinking tokens: ${metrics.thinkingTokens.toLocaleString("en-US")}`,
      icon: <Brain size={12} />,
    },
    {
      key: "output",
      value: compactMetric(metrics.outputTokens),
      label: `Synthetic output tokens: ${metrics.outputTokens.toLocaleString("en-US")}`,
      icon: <ArrowUpFromLine size={12} />,
    },
    {
      key: "cache-write",
      value: compactMetric(metrics.cacheWriteTokens),
      label: `Synthetic cache write tokens: ${metrics.cacheWriteTokens.toLocaleString("en-US")}`,
      icon: <HardDrive size={12} />,
    },
    {
      key: "elapsed",
      value: formatElapsed(metrics.elapsedMs),
      label: `Synthetic elapsed time: ${formatElapsed(metrics.elapsedMs)}`,
      icon: <Clock3 size={12} />,
      elapsed: true,
    },
  ];
  return (
    <div className="assistant-metrics" aria-label="Synthetic response metrics">
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
