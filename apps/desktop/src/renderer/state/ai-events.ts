import type { AiRunEvent } from "@translunar/contracts";

export interface AiEventReplayState {
  lastSequence: number;
  proposalText: string;
  statusMessage: string | null;
  usageSummary: string | null;
  events: AiRunEvent[];
}

export function createEmptyEventReplay(): AiEventReplayState {
  return {
    lastSequence: 0,
    proposalText: "",
    statusMessage: null,
    usageSummary: null,
    events: [],
  };
}

/**
 * Pure run-event reducer. Ignores duplicate/out-of-order events at or below the
 * committed sequence; appends delta text only from Engine events.
 */
export function reduceRunEvents(
  state: AiEventReplayState,
  page: { items: AiRunEvent[]; lastSequence: number },
): AiEventReplayState {
  let lastSequence = state.lastSequence;
  let proposalText = state.proposalText;
  let statusMessage = state.statusMessage;
  let usageSummary = state.usageSummary;
  const events = [...state.events];

  const ordered = [...page.items].sort((a, b) => a.sequence - b.sequence);
  for (const event of ordered) {
    if (event.sequence <= lastSequence) continue;
    lastSequence = event.sequence;
    events.push(event);
    switch (event.kind) {
      case "delta":
        if (typeof event.deltaText === "string") {
          proposalText += event.deltaText;
        }
        break;
      case "failed":
        statusMessage = event.message ?? "Run failed";
        break;
      case "completed":
        statusMessage = event.message ?? "Completed";
        break;
      case "canceled":
      case "canceling":
        statusMessage = event.message ?? "Canceled";
        break;
      case "interrupted":
        statusMessage = event.message ?? "Interrupted";
        break;
      case "usage":
        if (event.usage) {
          usageSummary = `in=${event.usage.inputTokens} out=${event.usage.outputTokens}`;
        }
        break;
      default:
        break;
    }
  }

  if (page.lastSequence > lastSequence) {
    lastSequence = page.lastSequence;
  }

  return {
    lastSequence,
    proposalText,
    statusMessage,
    usageSummary,
    events,
  };
}
