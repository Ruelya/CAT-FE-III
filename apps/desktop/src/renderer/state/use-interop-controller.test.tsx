import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { useInteropController } from "./use-interop-controller";

function gateway(overrides: Partial<{ mutationsEnabled: boolean }> = {}) {
  return {
    generation: 1,
    mutationsEnabled: overrides.mutationsEnabled ?? true,
    projectId: "proj-1",
    projectRevision: 1,
    documentId: "doc-1",
    documentRevision: 1,
    sourceLocale: "en",
    targetLocale: "zh",
    flushOrStay: async () => true,
    onReviewApplied: async () => undefined,
    onTableApplied: async () => undefined,
  };
}

describe("useInteropController", () => {
  let engine: FakeEngineState;

  beforeEach(() => {
    engine = createFakeEngineState({
      projects: [
        {
          id: "proj-1",
          name: "P",
          domain: "g",
          sourceLocale: "en",
          targetLocale: "zh",
          lifecycle: "active",
          revision: 1,
          createdAtMs: 1,
          updatedAtMs: 1,
          configuration: {},
        },
      ],
      documents: [
        {
          id: "doc-1",
          projectId: "proj-1",
          name: "d.txt",
          format: "txt",
          filterId: "builtin.txt",
          relativePath: "d.txt",
          status: "active",
          revision: 1,
          currentVersion: 1,
          segmentCount: 1,
          sourceSha256: "s",
          importedAtMs: 1,
          updatedAtMs: 1,
          degradation: [],
        },
      ],
      segments: [
        {
          id: "seg-1",
          documentId: "doc-1",
          ordinal: 1,
          revision: 1,
          sourceText: "Hello",
          targetText: "",
          state: "draft",
          contextHash: "c",
          sourceHash: "s",
          structuralPath: "1",
          updatedAtMs: 1,
        },
      ],
      exportPath: "C:/tmp/review.docx",
      interopReviewPath: "C:/tmp/review.docx",
      interopTablePath: "C:/tmp/table.xlsx",
    });
    window.translunar = createFakeDesktopApi(engine);
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("exports, previews, and applies a changed review row", async () => {
    const { result } = renderHook(() => useInteropController(gateway()));

    await act(async () => {
      await result.current.exportReview();
    });
    await waitFor(() => {
      expect(result.current.state.exportPath).toBe("C:/tmp/review.docx");
    });

    await act(async () => {
      await result.current.pickInput();
    });
    expect(result.current.state.path).toBe("C:/tmp/review.docx");

    await act(async () => {
      await result.current.preview(0);
    });
    await waitFor(() => {
      expect(result.current.state.reviewPreview?.status).toBe("open");
    });
    expect(result.current.state.selectedRowIds.has("rr-1")).toBe(true);
    expect(result.current.state.selectedRowIds.has("rr-2")).toBe(false);

    await act(async () => {
      await result.current.apply();
    });
    await waitFor(() => {
      expect(result.current.state.reviewPreview?.status).toBe("applied");
    });
    expect(result.current.canApply).toBe(false);
  });

  it("clears preview state when mode switches", async () => {
    const { result } = renderHook(() => useInteropController(gateway()));
    await act(async () => {
      await result.current.pickInput();
      await result.current.preview(0);
    });
    await waitFor(() => {
      expect(result.current.state.reviewPreview).not.toBeNull();
    });

    await act(async () => {
      result.current.setMode("table");
    });
    expect(result.current.state.reviewPreview).toBeNull();
    expect(result.current.state.path).toBeNull();
    expect(result.current.state.mode).toBe("table");
  });

  it("cancel dialog makes no RPC", async () => {
    engine.exportPath = null;
    engine.interopReviewPath = null;
    const { result } = renderHook(() => useInteropController(gateway()));
    await waitFor(() => {
      // project.get on mount may have completed
      expect(true).toBe(true);
    });
    const before = engine.calls.filter((c) =>
      String(c.method).startsWith("interop."),
    ).length;
    await act(async () => {
      await result.current.exportReview();
      await result.current.pickInput();
    });
    const after = engine.calls.filter((c) =>
      String(c.method).startsWith("interop."),
    ).length;
    expect(after).toBe(before);
  });

  it("paging preview retains prior-page selection", async () => {
    const { result } = renderHook(() => useInteropController(gateway()));
    await act(async () => {
      await result.current.pickInput();
      await result.current.preview(0);
    });
    await waitFor(() => {
      expect(result.current.state.reviewPreview).not.toBeNull();
    });
    const firstPageSelected = [...result.current.state.selectedRowIds];
    expect(firstPageSelected.length).toBeGreaterThan(0);

    // Simulate a multi-page preview by forcing a second page fetch.
    // Fake returns the same page rows; merge must not wipe prior selection.
    await act(async () => {
      await result.current.preview(50);
    });
    await waitFor(() => {
      expect(result.current.state.pending).toBe(false);
    });
    for (const id of firstPageSelected) {
      expect(result.current.state.selectedRowIds.has(id)).toBe(true);
    }
  });
});
