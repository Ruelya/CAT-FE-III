import type { Segment } from "@translunar/contracts";

export type AssistantModel = "grok-4.5" | "openai-compatible" | "local-preview";
export type ReasoningLevel = "low" | "medium" | "high";
export type AssistantAction =
  "improve" | "fix-terms" | "shorten" | "explain" | "prompt";

export interface AssistantMetrics {
  model: AssistantModel;
  inputTokens: number;
  cacheReadTokens: number;
  thinkingTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  targetText?: string;
  metrics?: AssistantMetrics;
}

export interface AssistantConversation {
  id: string;
  title: string;
  messages: AssistantMessage[];
}

export interface AssistantState {
  conversations: AssistantConversation[];
  activeConversationId: string;
  model: AssistantModel;
  reasoning: ReasoningLevel;
}

export type AssistantStateAction =
  | { type: "select-conversation"; id: string }
  | { type: "new-conversation"; id: string }
  | { type: "archive-conversation"; id: string }
  | { type: "set-model"; model: AssistantModel }
  | { type: "set-reasoning"; reasoning: ReasoningLevel }
  | {
      type: "append-turn";
      conversationId: string;
      user: AssistantMessage;
      assistant: AssistantMessage;
    };

const DEFAULT_TARGET = "供应商应采取商业上合理的管理、技术和物理安全措施。";

export function createInitialAssistantState(
  segment: Segment | undefined,
): AssistantState {
  const target = segment?.targetText.trim() || DEFAULT_TARGET;
  const source =
    segment?.sourceText ??
    "The Supplier shall maintain commercially reasonable administrative, technical, and physical safeguards.";
  return {
    activeConversationId: "terminology-and-tone",
    model: "grok-4.5",
    reasoning: "high",
    conversations: [
      {
        id: "terminology-and-tone",
        title: "Terminology and tone",
        messages: [
          {
            id: "seed-user",
            role: "user",
            text: "Check terminology and improve this translation.",
          },
          {
            id: "seed-assistant",
            role: "assistant",
            text: target,
            targetText: target,
            metrics: {
              model: "grok-4.5",
              inputTokens: 1438,
              cacheReadTokens: 4620,
              thinkingTokens: 241,
              outputTokens: 82,
              cacheWriteTokens: 653,
              elapsedMs: 2700,
            },
          },
        ],
      },
      {
        id: "source-explanation",
        title: "Source explanation",
        messages: [
          {
            id: "explain-user",
            role: "user",
            text: "Explain the obligation in this clause.",
          },
          {
            id: "explain-assistant",
            role: "assistant",
            text: `${source} keeps the obligation mandatory and preserves all three safeguard categories.`,
            metrics: {
              model: "grok-4.5",
              inputTokens: 916,
              cacheReadTokens: 2240,
              thinkingTokens: 188,
              outputTokens: 54,
              cacheWriteTokens: 402,
              elapsedMs: 1900,
            },
          },
        ],
      },
    ],
  };
}

export function assistantReducer(
  state: AssistantState,
  action: AssistantStateAction,
): AssistantState {
  switch (action.type) {
    case "select-conversation":
      return state.conversations.some((item) => item.id === action.id)
        ? { ...state, activeConversationId: action.id }
        : state;
    case "new-conversation":
      return {
        ...state,
        activeConversationId: action.id,
        conversations: [
          { id: action.id, title: "New conversation", messages: [] },
          ...state.conversations,
        ],
      };
    case "archive-conversation": {
      if (state.conversations.length <= 1) return state;
      const remaining = state.conversations.filter(
        (item) => item.id !== action.id,
      );
      if (remaining.length === state.conversations.length) return state;
      return {
        ...state,
        conversations: remaining,
        activeConversationId:
          state.activeConversationId === action.id
            ? (remaining[0]?.id ?? state.activeConversationId)
            : state.activeConversationId,
      };
    }
    case "set-model":
      return { ...state, model: action.model };
    case "set-reasoning":
      return { ...state, reasoning: action.reasoning };
    case "append-turn":
      return {
        ...state,
        conversations: state.conversations.map((item) => {
          if (item.id !== action.conversationId) return item;
          return {
            ...item,
            title:
              item.title === "New conversation"
                ? truncateTitle(action.user.text)
                : item.title,
            messages: [...item.messages, action.user, action.assistant],
          };
        }),
      };
  }
}

export function createAssistantTurn(
  segment: Segment | undefined,
  action: AssistantAction,
  prompt: string,
  model: AssistantModel,
  reasoning: ReasoningLevel,
  idSeed: string,
): { user: AssistantMessage; assistant: AssistantMessage } {
  const source = segment?.sourceText ?? "the active source segment";
  const currentTarget = segment?.targetText.trim() || DEFAULT_TARGET;
  const reply = assistantReply(action, prompt, source, currentTarget);
  const inputTokens = 780 + source.length * 4 + prompt.length * 3;
  const outputTokens = Math.max(34, reply.text.length * 2);
  const reasoningMultiplier =
    reasoning === "high" ? 1.8 : reasoning === "medium" ? 1.25 : 0.7;
  const thinkingTokens = Math.round(112 * reasoningMultiplier + prompt.length);
  return {
    user: {
      id: `${idSeed}-user`,
      role: "user",
      text: prompt,
    },
    assistant: {
      id: `${idSeed}-assistant`,
      role: "assistant",
      text: reply.text,
      ...(reply.targetText ? { targetText: reply.targetText } : {}),
      metrics: {
        model,
        inputTokens,
        cacheReadTokens: Math.round(inputTokens * 2.85),
        thinkingTokens,
        outputTokens,
        cacheWriteTokens: Math.round(inputTokens * 0.43),
        elapsedMs: Math.round(1100 + thinkingTokens * 6.4),
      },
    },
  };
}

export function compactMetric(value: number): string {
  if (value < 1000) return String(value);
  const compact = value / 1000;
  return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}k`;
}

export function formatElapsed(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

function assistantReply(
  action: AssistantAction,
  prompt: string,
  source: string,
  currentTarget: string,
): { text: string; targetText?: string } {
  switch (action) {
    case "improve": {
      const target = currentTarget.replace("采取", "保持并持续落实");
      return { text: target, targetText: target };
    }
    case "fix-terms":
      return { text: DEFAULT_TARGET, targetText: DEFAULT_TARGET };
    case "shorten": {
      const target = "供应商应采取合理的管理、技术与物理安全措施。";
      return { text: target, targetText: target };
    }
    case "explain":
      return {
        text: `This clause is mandatory. It preserves the three safeguard categories in "${source}" and keeps shall as 应.`,
      };
    case "prompt": {
      if (/explain|解释|说明/iu.test(prompt)) {
        return {
          text: `The active clause creates a continuing security obligation. Keep shall as 应 and retain the administrative, technical, and physical categories.`,
        };
      }
      if (/short|缩短|精简/iu.test(prompt)) {
        const target = "供应商应采取合理的安全措施。";
        return { text: target, targetText: target };
      }
      return { text: currentTarget, targetText: currentTarget };
    }
  }
}

function truncateTitle(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 36) return normalized;
  return `${normalized.slice(0, 35)}…`;
}
