import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  fakeAiProfile,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import {
  OCR_CORRECT_PROMPT,
  pickSuggestAiProfile,
  suggestModelScore,
  useOcrAi,
} from "./use-ocr-ai";

function seedEngine(profiles = [fakeAiProfile()]): FakeEngineState {
  return createFakeEngineState({
    aiProfiles: profiles,
    segments: [
      {
        id: "seg-1",
        documentId: "doc-1",
        ordinal: 1,
        revision: 1,
        sourceText: "INV-2048",
        targetText: "",
        state: "untranslated",
        contextHash: "c",
        sourceHash: "s",
        structuralPath: "pdf:p=1;b=0;s=ocr;c=80",
        updatedAtMs: 1,
      },
    ],
  });
}

describe("useOcrAi", () => {
  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("stays honest when no credential-backed profile exists", async () => {
    const engine = seedEngine([]);
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useOcrAi({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );

    await waitFor(() => expect(result.current.profilesLoaded).toBe(true));
    expect(result.current.runnable).toBe(false);

    await act(async () => {
      await result.current.generate();
    });
    expect(result.current.error?.code).toBe("NO_PROFILE");
    expect(engine.calls.some((c) => c.method === "ai.run.start")).toBe(false);
  });

  it("starts a freeform OCR correction and exposes the proposal", async () => {
    const engine = seedEngine();
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useOcrAi({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );

    await waitFor(() => expect(result.current.runnable).toBe(true));
    await act(async () => {
      await result.current.generate();
    });
    await waitFor(() => {
      expect(result.current.proposal).toBe("Corrected: INV-2048");
    });

    const start = engine.calls.find((c) => c.method === "ai.run.start");
    expect(start?.params).toMatchObject({
      action: "freeform",
      prompt: OCR_CORRECT_PROMPT,
      segmentId: "seg-1",
      projectId: "proj-1",
      expectedRevision: 1,
    });
  });

  it("ignores a profile that has no credential", async () => {
    const engine = seedEngine([
      fakeAiProfile({ credentialPresent: false, enabled: true }),
    ]);
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() =>
      useOcrAi({
        enabled: true,
        projectId: "proj-1",
        segmentId: "seg-1",
        segmentRevision: 1,
      }),
    );
    await waitFor(() => expect(result.current.profilesLoaded).toBe(true));
    expect(result.current.runnable).toBe(false);
  });
});

describe("pickSuggestAiProfile", () => {
  it("prefers a flash-lite model over a reasoning profile", () => {
    const grok = fakeAiProfile({
      id: "grok",
      name: "Grok",
      model: "grok-4.6",
    });
    const flash = fakeAiProfile({
      id: "flash",
      name: "Flash",
      model: "gemini-3.5-flash-lite",
    });
    expect(suggestModelScore(flash.model)).toBeGreaterThan(suggestModelScore(grok.model));
    expect(pickSuggestAiProfile([grok, flash])?.id).toBe("flash");
  });

  it("falls back to the first runnable profile when none are fast", () => {
    const only = fakeAiProfile({ id: "only", model: "grok-4.6" });
    expect(pickSuggestAiProfile([only])?.id).toBe("only");
  });
});
