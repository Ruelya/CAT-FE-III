import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { textPrompt } from "../lib/acp-session";
import {
  createFakeDesktopApi,
  createFakeEngineState,
  fakeAiProfile,
} from "../test/fake-desktop-api";
import { useAcpChat } from "./use-acp-chat";

describe("useAcpChat", () => {
  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("opens an ACP session and prompts through ai.run.start", async () => {
    const engine = createFakeEngineState({
      aiProfiles: [fakeAiProfile()],
      segments: [
        {
          id: "seg-1",
          documentId: "doc-1",
          ordinal: 1,
          revision: 1,
          sourceText: "Power station",
          targetText: "",
          state: "untranslated",
          contextHash: "c",
          sourceHash: "s",
          structuralPath: "p=1",
          updatedAtMs: 1,
        },
      ],
    });
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useAcpChat({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );
    await waitFor(() => expect(result.current.runnable).toBe(true));
    await act(async () => {
      result.current.setDraft("What is the term for power station?");
    });
    await act(async () => {
      await result.current.prompt(textPrompt(result.current.draft));
    });
    expect(engine.calls.some((call) => call.method === "ai.conversation.create")).toBe(
      true,
    );
    const start = engine.calls.find((call) => call.method === "ai.run.start");
    expect(start?.params).toMatchObject({
      action: "freeform",
      conversationId: "conv-1",
      segmentId: "seg-1",
    });
    expect(result.current.messages.some((message) => message.role === "assistant")).toBe(
      true,
    );
  });
});
