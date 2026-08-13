import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { useReimportController } from "./use-reimport-controller";

describe("useReimportController", () => {
  let engine: FakeEngineState;

  beforeEach(() => {
    engine = createFakeEngineState({
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
      sourcePath: "C:/tmp/source.txt",
    });
    window.translunar = createFakeDesktopApi(engine);
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  function gateway() {
    return {
      generation: 1,
      mutationsEnabled: true,
      documentId: "doc-1",
      documentRevision: 1,
      flushOrStay: async () => true,
      onApplied: async () => undefined,
    };
  }

  it("previews plan and applies after confirmation", async () => {
    const { result } = renderHook(() => useReimportController(gateway()));

    await act(async () => {
      result.current.open();
      await result.current.pickAndPreview();
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("planReady");
    });
    expect(result.current.canApply).toBe(true);
    expect(result.current.state.preview?.plan.items.length).toBeGreaterThan(0);

    await act(async () => {
      await result.current.apply();
    });
    await waitFor(() => {
      expect(result.current.state.open).toBe(false);
    });
    expect(engine.documents[0]?.revision).toBe(2);
  });

  it("cancel path pick makes no reimport RPC", async () => {
    engine.sourcePath = null;
    const { result } = renderHook(() => useReimportController(gateway()));
    await act(async () => {
      result.current.open();
      await result.current.pickAndPreview();
    });
    expect(
      engine.calls.some((c) =>
        String(c.method).startsWith("document.reimport"),
      ),
    ).toBe(false);
  });

  it("failed apply keeps planReady so Apply can retry", async () => {
    const { result } = renderHook(() => useReimportController(gateway()));
    await act(async () => {
      result.current.open();
      await result.current.pickAndPreview();
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("planReady");
    });

    // Force revision conflict on first apply
    engine.documents[0]!.revision = 99;
    await act(async () => {
      await result.current.apply();
    });
    await waitFor(() => {
      expect(result.current.state.error).not.toBeNull();
    });
    expect(result.current.state.status).toBe("planReady");
    expect(result.current.state.preview).not.toBeNull();
    expect(result.current.canApply).toBe(true);

    // Align revision and retry
    engine.documents[0]!.revision =
      result.current.state.preview!.expectedDocumentRevision;
    await act(async () => {
      await result.current.apply();
    });
    await waitFor(() => {
      expect(result.current.state.open).toBe(false);
    });
  });
});
