import { describe, expect, it } from "vitest";

import {
  assistantReducer,
  compactMetric,
  createAssistantTurn,
  createInitialAssistantState,
  formatElapsed,
} from "./assistant-state";

describe("assistant preview state", () => {
  it("defaults to the approved model and reasoning profile", () => {
    const state = createInitialAssistantState(undefined);
    expect(state.model).toBe("grok-4.5");
    expect(state.reasoning).toBe("high");
    expect(state.conversations[0]?.messages).toHaveLength(2);
  });

  it("creates, selects, appends to, and archives conversations", () => {
    let state = createInitialAssistantState(undefined);
    state = assistantReducer(state, {
      type: "new-conversation",
      id: "new-thread",
    });
    expect(state.activeConversationId).toBe("new-thread");

    const turn = createAssistantTurn(
      undefined,
      "shorten",
      "Shorten the target",
      state.model,
      state.reasoning,
      "turn-1",
    );
    state = assistantReducer(state, {
      type: "append-turn",
      conversationId: "new-thread",
      ...turn,
    });
    expect(state.conversations[0]?.title).toBe("Shorten the target");
    expect(state.conversations[0]?.messages).toHaveLength(2);

    state = assistantReducer(state, {
      type: "archive-conversation",
      id: "new-thread",
    });
    expect(state.conversations.some((item) => item.id === "new-thread")).toBe(
      false,
    );
    expect(state.activeConversationId).not.toBe("new-thread");
  });

  it("formats compact usage values", () => {
    expect(compactMetric(241)).toBe("241");
    expect(compactMetric(1438)).toBe("1.4k");
    expect(compactMetric(14_380)).toBe("14k");
    expect(formatElapsed(2700)).toBe("2.7s");
  });
});
