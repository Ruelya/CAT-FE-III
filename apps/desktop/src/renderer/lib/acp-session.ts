/**
 * ACP session shapes copied from the Agent Client Protocol (Zed / official
 * TypeScript SDK). This file is a local adapter surface — it does not open a
 * new Engine method. Prompts still travel through `ai.conversation.*` and
 * `ai.run.start`.
 *
 * Source of truth: https://github.com/agentclientprotocol/typescript-sdk
 */

export type AcpSessionId = string;

export type AcpStopReason = "end_turn" | "cancelled" | "max_tokens" | "refusal";

export interface AcpTextContent {
  type: "text";
  text: string;
}

export type AcpContentBlock = AcpTextContent;

export interface AcpPromptRequest {
  sessionId: AcpSessionId;
  prompt: AcpContentBlock[];
}

export interface AcpPromptResponse {
  stopReason: AcpStopReason;
}

export interface AcpSessionUpdate {
  sessionId: AcpSessionId;
  update:
    | { sessionUpdate: "agent_message_chunk"; content: AcpContentBlock }
    | { sessionUpdate: "agent_thought_chunk"; content: AcpContentBlock };
}

export interface AcpChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export function acpPromptText(prompt: readonly AcpContentBlock[]): string {
  return prompt
    .filter((block): block is AcpTextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function textPrompt(text: string): AcpContentBlock[] {
  return [{ type: "text", text }];
}
