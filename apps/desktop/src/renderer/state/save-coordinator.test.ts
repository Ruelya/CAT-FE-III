import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { SaveCoordinator } from "./save-coordinator";

describe("SaveCoordinator", () => {
  let state: FakeEngineState;

  beforeEach(() => {
    vi.useFakeTimers();
    state = createFakeEngineState({
      segments: [
        {
          id: "seg-1",
          documentId: "doc-1",
          ordinal: 1,
          revision: 1,
          sourceText: "Hello",
          targetText: "",
          state: "untranslated",
          contextHash: "c",
          sourceHash: "s",
          structuralPath: "1",
          updatedAtMs: 0,
        },
      ],
    });
    window.translunar = createFakeDesktopApi(state);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function attach(coordinator: SaveCoordinator) {
    coordinator.attachSegment({
      segmentId: "seg-1",
      documentId: "doc-1",
      projectId: "proj-1",
      engineTarget: "",
      expectedRevision: 1,
    });
  }

  it("does not call segment.updateTarget while composing beyond debounce", async () => {
    const coordinator = new SaveCoordinator({
      journalDebounceMs: 10,
      saveDebounceMs: 50,
    });
    attach(coordinator);
    coordinator.setComposing(true);
    coordinator.updateDraft("中");
    await vi.advanceTimersByTimeAsync(500);
    expect(
      state.calls.filter((c) => c.method === "segment.updateTarget"),
    ).toHaveLength(0);
    expect(coordinator.active?.draftTarget).toBe("中");

    coordinator.setComposing(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(state.calls.some((c) => c.method === "segment.updateTarget")).toBe(
      true,
    );
  });

  it("flush returns one-shot updated segment and does not sticky-reapply", async () => {
    const coordinator = new SaveCoordinator({
      journalDebounceMs: 1,
      saveDebounceMs: 1,
    });
    attach(coordinator);
    coordinator.updateDraft("hello");
    const first = await coordinator.flush();
    expect(first.updatedSegment?.targetText).toBe("hello");
    expect(coordinator.takeLastUpdatedSegment()).toBeNull();
    const second = await coordinator.flush();
    expect(second.updatedSegment).toBeNull();
  });

  it("preserves newer draft when an older in-flight save resolves", async () => {
    vi.useRealTimers();
    let resolveUpdate!: () => void;
    let updateEntered = false;
    let updateCount = 0;
    const deferred = new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    });
    const originalInvoke = window.translunar.invoke.bind(window.translunar);
    window.translunar.invoke = async (method, params) => {
      if (method === "segment.updateTarget") {
        updateCount += 1;
        updateEntered = true;
        // Only hold the first generation so we can type a newer draft mid-flight.
        if (updateCount === 1) {
          await deferred;
        }
        return originalInvoke(method, params);
      }
      return originalInvoke(method, params);
    };

    const coordinator = new SaveCoordinator({
      journalDebounceMs: 10_000,
      saveDebounceMs: 10_000,
    });
    attach(coordinator);
    coordinator.updateDraft("first");
    const savePromise = coordinator.flush();
    // Wait until Engine mutation is actually in flight, then type newer text.
    await vi.waitFor(() => {
      expect(updateEntered).toBe(true);
    });
    coordinator.updateDraft("second");
    expect(coordinator.active?.draftTarget).toBe("second");
    // Mid-flight: newer generation is dirty relative to the in-flight save.
    expect(coordinator.active?.editGeneration).toBeGreaterThan(
      coordinator.active?.savedGeneration ?? -1,
    );
    resolveUpdate();
    await savePromise;
    // Flush serializes until the typed generation is saved — no data loss.
    expect(coordinator.active?.draftTarget).toBe("second");
    expect(coordinator.active?.editGeneration).toBe(
      coordinator.active?.savedGeneration,
    );
    expect(coordinator.isDirty()).toBe(false);
  });

  it("surfaces journal write failure without failing domain save", async () => {
    window.translunar.writeDraftJournal = () => {
      return Promise.reject(new Error("disk full"));
    };
    const coordinator = new SaveCoordinator({
      journalDebounceMs: 1,
      saveDebounceMs: 1,
    });
    attach(coordinator);
    coordinator.updateDraft("saved");
    const result = await coordinator.flush();
    expect(result.updatedSegment?.targetText).toBe("saved");
    expect(result.journalError).not.toBeNull();
    expect(result.journalError?.message).toMatch(/disk full|journal/i);
  });

  it("flush serializes a newer draft typed while updateTarget is in flight", async () => {
    vi.useRealTimers();
    let resolveFirst!: () => void;
    let updateCount = 0;
    const firstEntered = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const originalInvoke = window.translunar.invoke.bind(window.translunar);
    window.translunar.invoke = async (method, params) => {
      if (method === "segment.updateTarget") {
        updateCount += 1;
        if (updateCount === 1) {
          await new Promise<void>((r) => {
            resolveFirst();
            // Hold first save until test types the second value.
            (
              window as unknown as { __releaseFirstSave?: () => void }
            ).__releaseFirstSave = r;
          });
        }
        return originalInvoke(method, params);
      }
      return originalInvoke(method, params);
    };

    const coordinator = new SaveCoordinator({
      journalDebounceMs: 10_000,
      saveDebounceMs: 10_000,
    });
    attach(coordinator);
    coordinator.updateDraft("first");
    const flushPromise = coordinator.flush();
    await firstEntered;
    coordinator.updateDraft("second");
    (
      window as unknown as { __releaseFirstSave: () => void }
    ).__releaseFirstSave();
    const result = await flushPromise;
    expect(result.updatedSegment?.targetText).toBe("second");
    expect(coordinator.active?.draftTarget).toBe("second");
    expect(coordinator.active?.editGeneration).toBe(
      coordinator.active?.savedGeneration,
    );
    expect(coordinator.isDirty()).toBe(false);
    const updates = state.calls.filter(
      (c) => c.method === "segment.updateTarget",
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(
      (updates[updates.length - 1]?.params as { targetText: string })
        .targetText,
    ).toBe("second");
  });

  it("surfaces journal clear failure without rolling back Engine save", async () => {
    window.translunar.clearDraftJournal = () => {
      return Promise.reject(new Error("clear denied"));
    };
    const coordinator = new SaveCoordinator({
      journalDebounceMs: 1,
      saveDebounceMs: 1,
    });
    attach(coordinator);
    coordinator.updateDraft("kept-on-engine");
    const result = await coordinator.flush();
    expect(result.updatedSegment?.targetText).toBe("kept-on-engine");
    expect(state.segments[0]?.targetText).toBe("kept-on-engine");
    expect(coordinator.active?.journalError).not.toBeNull();
    expect(coordinator.active?.journalError?.message).toMatch(
      /clear denied|journal clear/i,
    );
    // Domain save remains successful; draft is clean against engine.
    expect(coordinator.active?.editGeneration).toBe(
      coordinator.active?.savedGeneration,
    );
    expect(coordinator.active?.draftTarget).toBe("kept-on-engine");
  });
});
