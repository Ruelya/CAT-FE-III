import { describe, expect, it } from "vitest";
import type { AiRunEvent } from "@translunar/contracts";

import { createEmptyEventReplay, reduceRunEvents } from "./ai-events";

function ev(
  sequence: number,
  kind: AiRunEvent["kind"],
  extra: Partial<AiRunEvent> = {},
): AiRunEvent {
  return {
    runId: "r1",
    sequence,
    kind,
    createdAtMs: sequence,
    ...extra,
  };
}

describe("ai-events reducer", () => {
  it("appends deltas and ignores duplicates/out-of-order", () => {
    let state = createEmptyEventReplay();
    state = reduceRunEvents(state, {
      lastSequence: 2,
      items: [ev(1, "started"), ev(2, "delta", { deltaText: "Hel" })],
    });
    expect(state.proposalText).toBe("Hel");
    expect(state.lastSequence).toBe(2);

    state = reduceRunEvents(state, {
      lastSequence: 2,
      items: [
        ev(1, "delta", { deltaText: "IGNORED" }),
        ev(2, "delta", { deltaText: "x" }),
      ],
    });
    expect(state.proposalText).toBe("Hel");

    state = reduceRunEvents(state, {
      lastSequence: 4,
      items: [
        ev(4, "delta", { deltaText: "o" }),
        ev(3, "delta", { deltaText: "l" }),
      ],
    });
    expect(state.proposalText).toBe("Hello");
    expect(state.lastSequence).toBe(4);
  });

  it("records terminal messages and usage", () => {
    let state = createEmptyEventReplay();
    state = reduceRunEvents(state, {
      lastSequence: 2,
      items: [
        ev(1, "usage", {
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
          },
        }),
        ev(2, "completed", { message: "done" }),
      ],
    });
    expect(state.usageSummary).toBe("in=1 out=2");
    expect(state.statusMessage).toBe("done");
  });
});
