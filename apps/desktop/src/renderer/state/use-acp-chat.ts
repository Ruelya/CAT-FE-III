import { useCallback, useEffect, useRef, useState } from "react";
import type { AiConversation, AiProviderProfile } from "@translunar/contracts";

import {
  acpPromptText,
  textPrompt,
  type AcpChatMessage,
  type AcpContentBlock,
  type AcpPromptResponse,
  type AcpSessionId,
} from "../lib/acp-session";
import { invokeEngine } from "../lib/rpc";
import { pickRunnableAiProfile } from "./use-ocr-ai";

const CHAT_GROUNDING = {
  includeTerms: true,
  includeTm: true,
  includeCorpus: true,
  includeContext: true,
  includeStyle: true,
  tmTopN: 5,
  corpusTopN: 3,
  contextBefore: 2,
  contextAfter: 2,
  maxChars: 16_000,
  styleInstruction: "",
  systemInstruction:
    "You are a CAT workbench assistant. Answer about the current segment, terms, and memory. Do not invent tags. Prefer concise translator-facing answers.",
};

export interface AcpChatState {
  sessionId: AcpSessionId | null;
  messages: AcpChatMessage[];
  draft: string;
  pending: boolean;
  runnable: boolean;
  error: string | null;
}

/**
 * ACP-shaped chat session over existing Engine conversation + ai.run.start.
 *
 * `session/new` → `ai.conversation.create`
 * `session/prompt` → `ai.run.start` (freeform, conversationId)
 * assistant chunks are the completed proposal text (Engine does not stream).
 */
export function useAcpChat(input: {
  enabled: boolean;
  projectId: string | null;
  segmentId: string | null;
  segmentRevision: number | null;
}): AcpChatState & {
  setDraft: (text: string) => void;
  prompt: (blocks?: AcpContentBlock[]) => Promise<AcpPromptResponse | null>;
} {
  const [sessionId, setSessionId] = useState<AcpSessionId | null>(null);
  const [messages, setMessages] = useState<AcpChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [runnable, setRunnable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profilesRef = useRef<AiProviderProfile[]>([]);
  const conversationRef = useRef<AiConversation | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!input.enabled || !input.projectId) {
      profilesRef.current = [];
      setRunnable(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const page = await invokeEngine("ai.provider.list", {
          offset: 0,
          limit: 50,
        });
        if (cancelled) return;
        profilesRef.current = page.items;
        setRunnable(pickRunnableAiProfile(page.items) !== undefined);
      } catch {
        if (!cancelled) setRunnable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.projectId]);

  const ensureSession = useCallback(async (): Promise<AcpSessionId | null> => {
    if (sessionId) return sessionId;
    if (!input.projectId) return null;
    const created = await invokeEngine("ai.conversation.create", {
      projectId: input.projectId,
      title: "Workbench chat",
    });
    conversationRef.current = created;
    setSessionId(created.id);
    return created.id;
  }, [input.projectId, sessionId]);

  const prompt = useCallback(
    async (blocks?: AcpContentBlock[]): Promise<AcpPromptResponse | null> => {
      const text = acpPromptText(blocks ?? textPrompt(draft));
      if (!text || !input.enabled || !input.projectId || !input.segmentId) {
        return null;
      }
      if (input.segmentRevision === null) return null;
      const profile = pickRunnableAiProfile(profilesRef.current);
      if (!profile) {
        setError("No AI profile with a stored key.");
        return null;
      }
      const token = (generation.current += 1);
      setPending(true);
      setError(null);
      setDraft("");
      const userMessage: AcpChatMessage = {
        id: `user-${token}`,
        role: "user",
        text,
      };
      setMessages((current) => [...current, userMessage]);
      try {
        const id = await ensureSession();
        if (!id || token !== generation.current) return null;
        const started = await invokeEngine("ai.run.start", {
          action: "freeform",
          prompt: text,
          expectedRevision: input.segmentRevision,
          profileId: profile.id,
          projectId: input.projectId,
          segmentId: input.segmentId,
          conversationId: id,
          options: CHAT_GROUNDING,
        });
        let run = started;
        while (
          run.status === "queued" ||
          run.status === "running" ||
          run.status === "retrying"
        ) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          if (token !== generation.current) return { stopReason: "cancelled" };
          run = await invokeEngine("ai.run.get", { runId: run.id });
        }
        if (token !== generation.current) return { stopReason: "cancelled" };
        setPending(false);
        if (run.status !== "succeeded" || !run.proposalText) {
          setError("The assistant did not return a reply.");
          return { stopReason: "refusal" };
        }
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${run.id}`,
            role: "assistant",
            text: run.proposalText ?? "",
          },
        ]);
        return { stopReason: "end_turn" };
      } catch {
        if (token === generation.current) {
          setPending(false);
          setError("The assistant request failed.");
        }
        return { stopReason: "refusal" };
      }
    },
    [
      draft,
      ensureSession,
      input.enabled,
      input.projectId,
      input.segmentId,
      input.segmentRevision,
    ],
  );

  return {
    sessionId,
    messages,
    draft,
    pending,
    runnable,
    error,
    setDraft,
    prompt,
  };
}
