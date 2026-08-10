import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { useTaskPackageController } from "./use-task-package-controller";

function gateway() {
  return {
    generation: 1,
    mutationsEnabled: true,
    projectId: "proj-1",
    projectRevision: 1,
    hasDocuments: true,
    hasTaskPackageRef: false,
    flushOrStay: async () => true,
    onApplied: async () => undefined,
    onImported: async () => undefined,
  };
}

describe("useTaskPackageController", () => {
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
      exportPath: "C:/tmp/assignment.tltask",
      taskPackagePath: "C:/tmp/assignment.tltask",
    });
    window.translunar = createFakeDesktopApi(engine);
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("exports assignment, previews, selects safe rows only, applies", async () => {
    const { result } = renderHook(() => useTaskPackageController(gateway()));

    await waitFor(() => {
      expect(result.current.state.documentIds.length).toBeGreaterThan(0);
    });

    await act(async () => {
      result.current.setReason("export");
      await result.current.exportPackage("assignment");
    });
    await waitFor(() => {
      expect(result.current.state.exportNotice).toContain("assignment.tltask");
    });

    await act(async () => {
      await result.current.pickPackage();
      result.current.setReason("merge");
      await result.current.preview(0);
    });
    await waitFor(() => {
      expect(result.current.state.preview?.status).toBe("open");
    });
    expect(result.current.state.selectedRowIds.has("tp-1")).toBe(true);
    expect(result.current.state.selectedRowIds.has("tp-2")).toBe(false);

    await act(async () => {
      result.current.toggleRow("tp-2", true);
    });
    expect(result.current.state.selectedRowIds.has("tp-2")).toBe(false);

    await act(async () => {
      await result.current.apply();
    });
    await waitFor(() => {
      expect(result.current.state.preview?.status).toBe("applied");
    });
    expect(result.current.canApply).toBe(false);
  });

  it("cancel package dialog makes no package RPC", async () => {
    engine.taskPackagePath = null;
    const { result } = renderHook(() => useTaskPackageController(gateway()));
    const before = engine.calls.filter((c) =>
      String(c.method).startsWith("taskPackage"),
    ).length;
    await act(async () => {
      await result.current.pickPackage();
    });
    const after = engine.calls.filter((c) =>
      String(c.method).startsWith("taskPackage"),
    ).length;
    expect(after).toBe(before);
  });
});
