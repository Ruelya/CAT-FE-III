import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  AiAction,
  AiConversation,
  AiConversationMessage,
  AiProviderProfile,
  AiRun,
  AiRunEvent,
  AiUsage,
  EditorMutationResult,
  GroundingOptions,
  PromptBundle,
  Segment,
} from "@translunar/contracts";
import {
  AlertCircle,
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Brain,
  Check,
  ChevronDown,
  CircleStop,
  Clock3,
  Cpu,
  Database,
  Eye,
  HardDrive,
  LoaderCircle,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

import { formatError } from "./workbench-utils";
import { createAssistantTurn, type ReasoningLevel } from "./assistant-state";

interface LiveAssistantPanelProps {
  projectId: string;
  activeSegment: Segment | undefined;
  onApplyMutation(mutation: EditorMutationResult): void;
}

type DisplayMessage = AiConversationMessage & { pending?: boolean };

interface GroundingSnapshot {
  contextKey: string;
  bundle: PromptBundle;
}

const GROUNDING_OPTIONS: GroundingOptions = {
  includeTerms: true,
  includeTm: true,
  includeContext: true,
  includeStyle: true,
  tmTopN: 5,
  contextBefore: 2,
  contextAfter: 2,
  maxChars: 24_000,
  systemInstruction: "",
  styleInstruction: "",
};

const ACTIONS: Array<{ action: AiAction; label: string; prompt: string }> = [
  { action: "translate", label: "Translate", prompt: "Translate this segment" },
  { action: "improve", label: "Improve", prompt: "Improve this target" },
  { action: "formal", label: "Formal", prompt: "Make the target more formal" },
  { action: "shorten", label: "Shorten", prompt: "Shorten the target" },
];

export function LiveAssistantPanel({
  projectId,
  activeSegment,
  onApplyMutation,
}: LiveAssistantPanelProps) {
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState("local-preview");
  const [reasoning, setReasoning] = useState<ReasoningLevel>("high");
  const [prompt, setPrompt] = useState("");
  const [composing, setComposing] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [groundingSnapshot, setGroundingSnapshot] =
    useState<GroundingSnapshot | null>(null);
  const [showGrounding, setShowGrounding] = useState(false);
  const [run, setRun] = useState<AiRun | null>(null);
  const [streamText, setStreamText] = useState("");
  const [streamEvents, setStreamEvents] = useState<AiRunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);

  const activeConversation = useMemo(
    () =>
      conversations.find((item) => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );
  const selectedProfile = profiles.find((item) => item.id === selectedModel);
  const onlineReady = Boolean(selectedProfile?.credentialPresent);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const load = async () => {
      try {
        const [providerPage, conversationPage, settings] = await Promise.all([
          window.translunar.invoke("ai.provider.list", {
            offset: 0,
            limit: 100,
          }),
          window.translunar.invoke("ai.conversation.list", {
            projectId,
            offset: 0,
            limit: 50,
            includeArchived: false,
          }),
          window.translunar.invoke("ai.settings.get", {}),
        ]);
        if (cancelled) return;
        setProfiles(providerPage.items);
        setConversations(conversationPage.items);
        const preferred =
          settings.defaultProfileId &&
          providerPage.items.some(
            (item) => item.id === settings.defaultProfileId,
          )
            ? settings.defaultProfileId
            : providerPage.items.find((item) => item.credentialPresent)?.id;
        setSelectedModel(preferred ?? "local-preview");
        const first = conversationPage.items[0];
        if (first) {
          setActiveConversationId(first.id);
          await loadMessages(first.id);
        }
      } catch (reason) {
        if (!cancelled) setError(formatError(reason));
      }
    };
    void load();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [projectId]);

  const groundingContextKey = [
    activeSegment?.id ?? "none",
    activeSegment?.revision ?? -1,
    activeConversationId ?? "none",
    selectedModel,
  ].join(":");
  const grounding =
    groundingSnapshot?.contextKey === groundingContextKey
      ? groundingSnapshot.bundle
      : null;

  const loadMessages = async (conversationId: string) => {
    const page = await window.translunar.invoke("ai.conversation.messages", {
      conversationId,
      offset: 0,
      limit: 200,
    });
    if (mountedRef.current) setMessages(page.items);
  };

  const selectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setConversationOpen(false);
    void loadMessages(conversationId).catch((reason: unknown) =>
      setError(formatError(reason)),
    );
  };

  const createConversation = async (): Promise<AiConversation> => {
    const conversation = await window.translunar.invoke(
      "ai.conversation.create",
      {
        projectId,
        title: "New conversation",
      },
    );
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setMessages([]);
    setConversationOpen(false);
    return conversation;
  };

  const archiveConversation = async (conversation: AiConversation) => {
    if (conversations.length <= 1) return;
    const updated = await window.translunar.invoke("ai.conversation.update", {
      conversationId: conversation.id,
      title: conversation.title,
      archived: true,
      expectedRevision: conversation.revision,
    });
    const remaining = conversations.filter((item) => item.id !== updated.id);
    setConversations(remaining);
    const next = remaining[0];
    if (next) selectConversation(next.id);
  };

  const previewGrounding = async (
    action: AiAction,
    text: string,
    conversationId: string,
  ) => {
    if (!activeSegment || selectedModel === "local-preview") return null;
    const contextKey = [
      activeSegment.id,
      activeSegment.revision,
      conversationId,
      selectedModel,
    ].join(":");
    const result = await window.translunar.invoke("ai.grounding.preview", {
      projectId,
      segmentId: activeSegment.id,
      expectedRevision: activeSegment.revision,
      action,
      prompt: text,
      options: {
        ...GROUNDING_OPTIONS,
        systemInstruction: `Reasoning level: ${reasoning}.`,
      },
    });
    setGroundingSnapshot({ contextKey, bundle: result.bundle });
    return result.bundle;
  };

  const startOnlineRun = async (
    action: AiAction,
    text: string,
    conversationId: string,
  ) => {
    if (!activeSegment || !selectedProfile) {
      throw new Error("Choose a connected provider and conversation first.");
    }
    const bundle = await previewGrounding(action, text, conversationId);
    if (!bundle) throw new Error("Grounding preview is unavailable.");
    const started = await window.translunar.invoke("ai.run.start", {
      projectId,
      segmentId: activeSegment.id,
      profileId: selectedProfile.id,
      expectedRevision: activeSegment.revision,
      action,
      prompt: `${text}\n\nReasoning level: ${reasoning}.`,
      options: {
        ...GROUNDING_OPTIONS,
        systemInstruction: `Reasoning level: ${reasoning}.`,
      },
      conversationId,
      maxAttempts: 3,
    });
    setRun(started);
    setStreamText("");
    setStreamEvents([]);
    sequenceRef.current = 0;
    await pollRun(started);
  };

  const pollRun = async (initial: AiRun) => {
    let current = initial;
    let afterSequence = 0;
    for (let attempt = 0; attempt < 480; attempt += 1) {
      const page = await window.translunar.invoke("ai.run.events", {
        runId: current.id,
        afterSequence,
        limit: 100,
      });
      if (!mountedRef.current) return;
      if (page.items.length) {
        afterSequence = page.lastSequence;
        setStreamEvents((existing) => [...existing, ...page.items]);
        const delta = page.items.map((item) => item.deltaText ?? "").join("");
        if (delta) setStreamText((existing) => existing + delta);
      }
      current = await window.translunar.invoke("ai.run.get", {
        runId: current.id,
      });
      setRun(current);
      if (isTerminal(current.status)) {
        await loadMessagesForRun(current);
        return;
      }
      await delay(220);
    }
    throw new Error("AI run did not finish within the polling window.");
  };

  const loadMessagesForRun = async (completed: AiRun) => {
    const conversationId =
      completed.request.conversationId ?? activeConversationId;
    if (!conversationId) return;
    await loadMessages(conversationId);
    if (completed.status === "failed") {
      setError(completed.errorMessage ?? "AI run failed.");
    }
  };

  const submit = async (action: AiAction, text: string) => {
    if (busy || composing || !text.trim()) return;
    setBusy(true);
    setError(null);
    setStreamText("");
    try {
      if (selectedModel === "local-preview") {
        if (!activeSegment) throw new Error("No active segment.");
        const local = createAssistantTurn(
          activeSegment,
          action === "translate"
            ? "improve"
            : action === "formal"
              ? "improve"
              : action === "shorten"
                ? "shorten"
                : "prompt",
          text,
          "local-preview",
          reasoning,
          `local-${Date.now()}`,
        );
        setMessages((current) => [
          ...current,
          {
            id: `${Date.now()}-user`,
            conversationId: activeConversationId ?? "local",
            createdAtMs: Date.now(),
            role: "user",
            text,
          },
          {
            id: `${Date.now()}-assistant`,
            conversationId: activeConversationId ?? "local",
            createdAtMs: Date.now(),
            role: "assistant",
            text: local.assistant.text,
            targetProposal: local.assistant.targetText ?? null,
            segmentId: activeSegment?.id ?? null,
          },
        ]);
      } else {
        const conversationId =
          activeConversationId ?? (await createConversation()).id;
        await startOnlineRun(action, text, conversationId);
      }
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!run || busy) return;
    setBusy(true);
    try {
      const canceled = await window.translunar.invoke("ai.run.cancel", {
        runId: run.id,
        expectedRevision: run.revision,
      });
      setRun(canceled);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!run || busy) return;
    setBusy(true);
    setError(null);
    try {
      const resumed = await window.translunar.invoke("ai.run.resume", {
        runId: run.id,
        expectedRevision: run.revision,
      });
      setRun(resumed);
      await pollRun(resumed);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!run || run.status !== "succeeded" || !activeSegment || busy) return;
    setBusy(true);
    setError(null);
    try {
      const mutation = await window.translunar.invoke("ai.result.apply", {
        runId: run.id,
        expectedRunRevision: run.revision,
        expectedSegmentRevision: activeSegment.revision,
      });
      onApplyMutation(mutation);
      setRun(null);
      setStreamText("");
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  const submitPrompt = () => {
    const value = prompt.trim();
    if (!value) return;
    setPrompt("");
    void submit("freeform", value);
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      (!event.ctrlKey && !event.metaKey) ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    event.preventDefault();
    submitPrompt();
  };

  return (
    <div className="assistant-workspace live-assistant-workspace">
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
            <ChevronDown size={14} />
          </button>
          {conversationOpen ? (
            <div className="conversation-popover" role="menu">
              <button
                type="button"
                className="conversation-new"
                role="menuitem"
                onClick={() => void createConversation()}
              >
                <MessageSquarePlus size={14} /> New conversation
              </button>
              {conversations.map((conversation) => (
                <div
                  className="conversation-row"
                  data-selected={conversation.id === activeConversationId}
                  key={conversation.id}
                >
                  <button
                    type="button"
                    className="conversation-select"
                    role="menuitemradio"
                    aria-checked={conversation.id === activeConversationId}
                    onClick={() => selectConversation(conversation.id)}
                  >
                    {conversation.title}
                  </button>
                  <button
                    type="button"
                    className="conversation-archive"
                    title="Archive conversation"
                    aria-label={`Archive ${conversation.title}`}
                    onClick={() => void archiveConversation(conversation)}
                  >
                    <Archive size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="assistant-engine-controls">
          <label>
            <span>Model</span>
            <select
              aria-label="Requested model"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.currentTarget.value)}
            >
              <option value="local-preview">Local preview (offline)</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.model}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Reasoning</span>
            <select
              aria-label="Reasoning level"
              value={reasoning}
              onChange={(event) =>
                setReasoning(event.currentTarget.value as ReasoningLevel)
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <span
          className={
            onlineReady
              ? "assistant-provider-note online"
              : "assistant-provider-note"
          }
        >
          {selectedModel === "local-preview"
            ? "Offline preview"
            : onlineReady
              ? "Engine connected"
              : "Credential required"}
        </span>
      </div>

      <div className="assistant-context">
        <span>Active</span>
        <strong>{activeSegment ? activeSegment.ordinal + 1 : "—"}</strong>
        <p title={activeSegment?.sourceText}>{activeSegment?.sourceText}</p>
      </div>

      <div className="assistant-quick-actions" aria-label="Assistant actions">
        {ACTIONS.map((item) => (
          <button
            type="button"
            key={item.action}
            disabled={busy || (!activeSegment && item.action !== "freeform")}
            onClick={() => void submit(item.action, item.prompt)}
          >
            <WandSparkles size={12} /> {item.label}
          </button>
        ))}
      </div>

      {selectedModel !== "local-preview" && grounding ? (
        <details
          className="grounding-inspector"
          open={showGrounding}
          onToggle={(event) => setShowGrounding(event.currentTarget.open)}
        >
          <summary>
            <Eye size={13} /> Grounding context{" "}
            <span>
              {grounding.totalChars.toLocaleString()} chars ·{" "}
              {grounding.sections.length} sections
            </span>
          </summary>
          <div className="grounding-sections">
            {grounding.sections.map((section) => (
              <article key={section.id}>
                <header>
                  <strong>{section.label}</strong>
                  <small>
                    {section.itemCount} items
                    {section.truncated ? " · truncated" : ""}
                  </small>
                </header>
                <pre>{section.text}</pre>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      <div className="assistant-transcript" aria-live="polite">
        {messages.length ? (
          messages.map((message) => (
            <article
              className={`assistant-message ${message.role}`}
              key={message.id}
            >
              <span className="assistant-message-role">
                {message.role === "user" ? "You" : "Assistant"}
              </span>
              <p className={message.targetProposal ? "cjk" : undefined}>
                {message.text}
              </p>
              {message.role === "assistant" && message.targetProposal ? (
                <div className="assistant-message-actions">
                  <button
                    type="button"
                    onClick={() => {
                      if (run?.proposalText === message.targetProposal)
                        void apply();
                    }}
                    disabled={
                      !run ||
                      run.status !== "succeeded" ||
                      run.proposalText !== message.targetProposal
                    }
                  >
                    <Check size={12} /> Use in target
                  </button>
                  <button
                    type="button"
                    aria-label="Discard suggestion"
                    title="Discard suggestion"
                    onClick={() => setRun(null)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : null}
              {message.role === "assistant" && message.runId ? (
                <RunMetrics
                  runId={message.runId}
                  run={run?.id === message.runId ? run : null}
                  events={run?.id === message.runId ? streamEvents : []}
                />
              ) : null}
            </article>
          ))
        ) : (
          <div className="assistant-empty">
            <Sparkles size={20} />
            <strong>
              {selectedModel === "local-preview"
                ? "Offline preview ready"
                : "Start a grounded run"}
            </strong>
          </div>
        )}
        {run && !isTerminal(run.status) ? (
          <article className="assistant-message assistant streaming-message">
            <span className="assistant-message-role">
              <LoaderCircle size={12} className="spin" /> Assistant ·{" "}
              {run.status}
            </span>
            <p className="cjk">{streamText || "Preparing grounded context…"}</p>
            <div className="stream-controls">
              <button
                type="button"
                disabled={busy}
                onClick={() => void cancel()}
              >
                <CircleStop size={13} /> Stop
              </button>
            </div>
            <RunMetrics runId={run.id} run={run} events={streamEvents} />
          </article>
        ) : null}
      </div>

      {run?.status === "succeeded" && run.proposalText ? (
        <DiffProposal
          source={activeSegment?.targetText ?? ""}
          target={run.proposalText}
          onApply={() => void apply()}
          onDiscard={() => setRun(null)}
          disabled={busy}
        />
      ) : null}
      {run &&
      (run.status === "failed" ||
        run.status === "interrupted" ||
        run.status === "canceled") ? (
        <div className="run-recovery">
          <AlertCircle size={14} />
          <span>{run.errorMessage ?? `Run ${run.status}.`}</span>
          {run.status !== "canceled" ? (
            <button type="button" disabled={busy} onClick={() => void resume()}>
              <RotateCcw size={13} /> Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="assistant-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="assistant-composer">
        <textarea
          value={prompt}
          aria-label="Ask about the active segment"
          placeholder="Ask about the active segment…"
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={onPromptKeyDown}
        />
        <button
          type="button"
          aria-label="Send assistant message"
          title="Send"
          disabled={!prompt.trim() || composing || busy}
          onClick={submitPrompt}
        >
          <Send size={15} /> Send
        </button>
      </div>
    </div>
  );
}

function RunMetrics({
  runId,
  run,
  events,
}: {
  runId: string;
  run: AiRun | null;
  events: AiRunEvent[];
}) {
  const [historicalRun, setHistoricalRun] = useState<AiRun | null>(null);
  const [historicalEvents, setHistoricalEvents] = useState<AiRunEvent[]>([]);
  useEffect(() => {
    if (run?.id === runId) {
      setHistoricalRun(null);
      setHistoricalEvents([]);
      return;
    }
    let cancelled = false;
    void Promise.all([
      window.translunar.invoke("ai.run.get", { runId }),
      window.translunar.invoke("ai.run.events", {
        runId,
        afterSequence: 0,
        limit: 500,
      }),
    ])
      .then(([loadedRun, loadedEvents]) => {
        if (!cancelled) {
          setHistoricalRun(loadedRun);
          setHistoricalEvents(loadedEvents.items);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [run, runId]);
  const effectiveRun = run?.id === runId ? run : historicalRun;
  const effectiveEvents = run?.id === runId ? events : historicalEvents;
  const usage: AiUsage | null = latestUsage(effectiveEvents);
  const items = [
    {
      key: "model",
      value: effectiveRun?.model ?? "—",
      label: `Request model: ${effectiveRun?.model ?? "unknown"}`,
      icon: <Cpu size={12} />,
    },
    {
      key: "input",
      value: compact(usage?.inputTokens),
      label: `Input tokens: ${full(usage?.inputTokens)}`,
      icon: <ArrowDownToLine size={12} />,
    },
    {
      key: "cache-read",
      value: compact(usage?.cacheReadTokens),
      label: `Cache read tokens: ${full(usage?.cacheReadTokens)}`,
      icon: <Database size={12} />,
    },
    {
      key: "thinking",
      value: compact(usage?.reasoningTokens),
      label: `Thinking tokens: ${full(usage?.reasoningTokens)}`,
      icon: <Brain size={12} />,
    },
    {
      key: "output",
      value: compact(usage?.outputTokens),
      label: `Output tokens: ${full(usage?.outputTokens)}`,
      icon: <ArrowUpFromLine size={12} />,
    },
    {
      key: "cache-write",
      value: compact(usage?.cacheWriteTokens),
      label: `Cache write tokens: ${full(usage?.cacheWriteTokens)}`,
      icon: <HardDrive size={12} />,
    },
    {
      key: "elapsed",
      value:
        effectiveRun?.completedAtMs && effectiveRun.startedAtMs
          ? formatElapsed(effectiveRun.completedAtMs - effectiveRun.startedAtMs)
          : "—",
      label: "Elapsed time",
      icon: <Clock3 size={12} />,
    },
  ];
  return (
    <div className="assistant-metrics" aria-label="AI response metrics">
      {items.map((item) => (
        <span
          className="assistant-metric"
          tabIndex={0}
          title={item.label}
          aria-label={item.label}
          key={item.key}
        >
          {item.icon}
          <span>{item.value}</span>
        </span>
      ))}
    </div>
  );
}

function DiffProposal({
  source,
  target,
  onApply,
  onDiscard,
  disabled,
}: {
  source: string;
  target: string;
  onApply(): void;
  onDiscard(): void;
  disabled: boolean;
}) {
  const sourceWords = tokenize(source);
  const targetWords = tokenize(target);
  const sourceSet = new Set(sourceWords);
  return (
    <section className="ai-diff-proposal" aria-label="AI target diff">
      <header>
        <div>
          <span>Word diff</span>
          <strong>Proposed target</strong>
        </div>
        <div>
          <button type="button" disabled={disabled} onClick={onApply}>
            <Check size={13} /> Use in target
          </button>
          <button
            type="button"
            title="Discard proposal"
            aria-label="Discard proposal"
            onClick={onDiscard}
          >
            <X size={13} />
          </button>
        </div>
      </header>
      <p className="cjk">
        {targetWords.map((word, index) => (
          <mark
            className={sourceSet.has(word) ? "diff-same" : "diff-added"}
            key={`${word}-${index}`}
          >
            {word}
          </mark>
        ))}
      </p>
    </section>
  );
}

function latestUsage(events: AiRunEvent[]): AiUsage | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const usage = events[index]?.usage;
    if (usage) return usage;
  }
  return null;
}

function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1_000) return String(value);
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
}

function full(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "not reported"
    : value.toLocaleString("en-US");
}

function formatElapsed(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function isTerminal(status: AiRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
