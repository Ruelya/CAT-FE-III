import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SegmentEditorRow } from "@translunar/contracts";

import { useAiController } from "./use-ai-controller";

const invokeEngine = vi.fn();
const setAiCredential = vi.fn();

vi.mock("../lib/rpc", () => ({
  invokeEngine: (...args: unknown[]) => invokeEngine(...args) as unknown,
  desktopApi: () => ({
    setAiCredential: (...args: unknown[]) => setAiCredential(...args) as unknown,
  }),
}));

function segmentRow(id: string, revision: number): SegmentEditorRow {
  return {
    segment: {
      id,
      documentId: "d1",
      revision,
      sourceText: "s",
      targetText: "t",
      status: "draft",
      ordinal: 0,
      updatedAtMs: 0,
      contextHash: "c",
      sourceHash: "s",
      state: "draft",
      structuralPath: "/",
    },
    sourceTags: [],
    targetTags: [],
    comments: [],
    spellFindings: [],
    tagIssues: [],
    workflowState: { state: "draft", locked: false },
  } as unknown as SegmentEditorRow;
}

describe("useAiController segment revision ownership", () => {
  beforeEach(() => {
    invokeEngine.mockReset();
    setAiCredential.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns validated revision from Engine for first grounding use", async () => {
    invokeEngine.mockImplementation((method: string) => {
      if (method === "ai.provider.catalog") return Promise.resolve({ items: [] });
      if (method === "ai.provider.list") {
        return Promise.resolve({ items: [], total: 0, offset: 0, limit: 100 });
      }
      if (method === "ai.settings.get") {
        return Promise.resolve({
          enabled: true,
          allowInteractive: true,
          allowBatch: true,
          allowedOrigins: [],
          revision: 1,
          updatedAtMs: 0,
        });
      }
      if (method === "segment.editor.list") {
        return Promise.resolve({
          items: [segmentRow("seg-1", 7)],
          total: 1,
          offset: 0,
          limit: 200,
        });
      }
      if (method === "ai.grounding.preview") {
        return Promise.resolve({
          bundle: {
            truncated: false,
            promptHash: "h",
            sections: [],
            totalChars: 0,
          },
        });
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    });

    const gateway = {
      generation: 1,
      mutationsEnabled: true,
      active: true,
      context: {
        projectId: "p1",
        projectName: "P",
        documentId: "d1",
        activeSegmentId: "seg-1",
        session: { version: 1 as const, projectId: "p1", documentId: "d1" },
      },
      section: "interactive",
    };

    const { result } = renderHook(() => useAiController(gateway));

    let snapshot: { segmentId: string; revision: number } | null = null;
    await act(async () => {
      snapshot = await result.current.hydrateSegmentRevision();
    });
    expect(snapshot).toEqual({ segmentId: "seg-1", revision: 7 });
    expect(result.current.state.segmentRevision).toBe(7);

    await act(async () => {
      await result.current.previewGrounding();
    });
    await waitFor(() => {
      expect(result.current.state.groundingPreview).toContain('"hash": "h"');
    });
    const groundingCall = invokeEngine.mock.calls.find(
      (c) => c[0] === "ai.grounding.preview",
    );
    expect(groundingCall?.[1]).toMatchObject({
      segmentId: "seg-1",
      expectedRevision: 7,
    });
  });

  it("invalidate clears mutationPending presentation", () => {
    invokeEngine.mockImplementation((method: string) => {
      if (method === "ai.provider.catalog") return Promise.resolve({ items: [] });
      if (method === "ai.provider.list") {
        return Promise.resolve({ items: [], total: 0, offset: 0, limit: 100 });
      }
      if (method === "ai.settings.get") {
        return Promise.resolve({
          enabled: true,
          allowInteractive: true,
          allowBatch: true,
          allowedOrigins: [],
          revision: 1,
          updatedAtMs: 0,
        });
      }
      return Promise.resolve({});
    });

    const gateway = {
      generation: 1,
      mutationsEnabled: true,
      active: true,
      context: null,
      section: "providers",
    };
    const { result } = renderHook(() => useAiController(gateway));
    act(() => {
      result.current.invalidate();
    });
    expect(result.current.state.mutationPending).toBe(false);
  });
});
