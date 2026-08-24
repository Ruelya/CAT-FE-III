import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  fakeAiProfile,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { AI_SUGGEST_GROUNDING, isCompletePrompt } from "../lib/inline-completion";
import { useAiSuggest } from "./use-ai-suggest";

function seedEngine(profiles = [fakeAiProfile()]): FakeEngineState {
  return createFakeEngineState({
    aiProfiles: profiles,
    segments: [
      {
        id: "seg-1",
        documentId: "doc-1",
        ordinal: 1,
        revision: 1,
        sourceText: "Press the power button.",
        targetText: "",
        state: "untranslated",
        contextHash: "c",
        sourceHash: "s",
        structuralPath: "p=1",
        updatedAtMs: 1,
      },
    ],
  });
}

describe("useAiSuggest", () => {
  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("stays silent when no credential-backed profile exists", async () => {
    const engine = seedEngine([]);
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useAiSuggest({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );

    await waitFor(() => expect(result.current.runnable).toBe(false));
    await act(async () => {
      result.current.request("pow", 3);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(engine.calls.some((call) => call.method === "ai.run.start")).toBe(
      false,
    );
    expect(result.current.suffix).toBe("");
  });

  it("starts a grounded freeform run and exposes an attachable suffix", async () => {
    const engine = seedEngine();
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useAiSuggest({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );

    await waitFor(() => expect(result.current.runnable).toBe(true));
    await act(async () => {
      result.current.request("pow", 3);
    });
    await waitFor(() => {
      expect(result.current.suffix).toBe(" completed");
    });

    const start = engine.calls.find((call) => call.method === "ai.run.start");
    expect(start?.params).toMatchObject({
      action: "freeform",
      segmentId: "seg-1",
      projectId: "proj-1",
      expectedRevision: 1,
      options: {
        includeContext: true,
        includeTerms: true,
        includeTm: true,
        maxChars: AI_SUGGEST_GROUNDING.maxChars,
      },
    });
    const prompt = (start?.params as { prompt?: string }).prompt ?? "";
    expect(isCompletePrompt(prompt)).toBe(true);
    expect(prompt).toContain("pow⌂");
  });

  it("starts the run on a flash-lite profile when one exists", async () => {
    const engine = seedEngine([
      fakeAiProfile({ id: "grok", name: "Grok", model: "grok-4.6" }),
      fakeAiProfile({
        id: "flash",
        name: "Flash",
        model: "gemini-3.5-flash-lite",
      }),
    ]);
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useAiSuggest({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );
    await waitFor(() => expect(result.current.runnable).toBe(true));
    await act(async () => {
      result.current.request("pow", 3);
    });
    await waitFor(() => {
      expect(result.current.suffix).toBe(" completed");
    });
    const start = engine.calls.find((call) => call.method === "ai.run.start");
    expect((start?.params as { profileId?: string }).profileId).toBe("flash");
  });

  it("drops a stale run after the caret moves", async () => {
    const engine = seedEngine();
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useAiSuggest({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );
    await waitFor(() => expect(result.current.runnable).toBe(true));
    await act(async () => {
      result.current.request("po", 2);
      result.current.request("pow", 3);
    });
    await waitFor(() => {
      expect(result.current.suffix).toBe(" completed");
    });
    const starts = engine.calls.filter((call) => call.method === "ai.run.start");
    expect(starts).toHaveLength(1);
    const prompt = (starts[0]?.params as { prompt?: string }).prompt ?? "";
    expect(prompt).toContain("pow⌂");
  });

  it("replays the last caret after profiles become ready", async () => {
    const engine = seedEngine();
    const api = createFakeDesktopApi(engine);
    const invoke = api.invoke.bind(api);
    api.invoke = async (method, params) => {
      if (method === "ai.provider.list") {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return invoke(method, params);
    };
    window.translunar = api;
    const { result } = renderHook(() =>
      useAiSuggest({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );

    await act(async () => {
      result.current.request("pow", 3);
    });
    expect(engine.calls.some((call) => call.method === "ai.run.start")).toBe(
      false,
    );

    await waitFor(() => {
      expect(result.current.suffix).toBe(" completed");
    });
    expect(
      engine.calls.filter((call) => call.method === "ai.run.start"),
    ).toHaveLength(1);
  });

  it("consumes an accepted word from the live suffix", async () => {
    const engine = seedEngine();
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useAiSuggest({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );
    await waitFor(() => expect(result.current.runnable).toBe(true));
    await act(async () => {
      result.current.request("pow", 3);
    });
    await waitFor(() => {
      expect(result.current.suffix).toBe(" completed");
    });

    act(() => {
      result.current.consume(" com");
    });
    expect(result.current.suffix).toBe("pleted");
    act(() => {
      result.current.consume("nope");
    });
    expect(result.current.suffix).toBe("");
  });
});
