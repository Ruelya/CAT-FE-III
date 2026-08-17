import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionContext } from "./app-state";
import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { SaveCoordinator } from "./save-coordinator";
import {
  useEditorOperations,
  type EditorOpsGateway,
} from "./use-editor-operations";

function minimalCtx(): SessionContext {
  const document = {
    id: "doc-1",
    projectId: "proj-1",
    name: "Doc",
    format: "txt",
    filterId: "builtin.txt",
    relativePath: "Doc.txt",
    status: "active" as const,
    revision: 1,
    currentVersion: 1,
    segmentCount: 1,
    sourceSha256: "sha",
    importedAtMs: 1,
    updatedAtMs: 1,
    degradation: [],
  };
  return {
    session: {
      version: 1,
      projectId: "proj-1",
      documentId: "doc-1",
    },
    project: {
      id: "proj-1",
      name: "P",
      domain: "general",
      sourceLocale: "en",
      targetLocale: "zh",
      lifecycle: "active",
      revision: 1,
      createdAtMs: 1,
      updatedAtMs: 1,
      configuration: {},
    },
    document,
    documents: [document],
    rows: [
      {
        segment: {
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
          updatedAtMs: 1,
        },
        comments: [],
        sourceTags: [],
        targetTags: [],
        spellFindings: [],
        tagIssues: [],
        workflowState: "translation",
      },
    ],
    counts: {
      confirmed: 0,
      draft: 0,
      untranslated: 1,
      total: 1,
      openIssues: 0,
    },
    editorPage: {
      offset: 0,
      limit: 200,
      total: 1,
      filter: "all",
      query: "",
    },
  };
}

function makeGateway(
  overrides: Partial<EditorOpsGateway> = {},
): EditorOpsGateway {
  const saveCoordinator = new SaveCoordinator();
  return {
    generation: 1,
    mutationsEnabled: true,
    workbenchActive: true,
    ctx: minimalCtx(),
    activeSegmentId: "seg-1",
    focusSegmentId: "seg-1",
    selectedSegmentIds: [],
    saveCoordinator,
    flushOrStay: async () => true,
    commitWorkbenchRows: async () => undefined,
    refreshActiveDocumentRows: async () => undefined,
    ...overrides,
  };
}

describe("useEditorOperations keyboard ownership", () => {
  let engine: FakeEngineState;

  beforeEach(() => {
    engine = createFakeEngineState();
    window.translunar = createFakeDesktopApi(engine);
    document.body.innerHTML = `<div data-testid="workbench"><button id="focus">x</button></div>`;
    document.getElementById("focus")?.focus();
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete window.translunar;
    document.body.innerHTML = "";
  });

  it("accepts Ctrl+F on Workbench and opens find panel", async () => {
    const gw = makeGateway();
    const { result } = renderHook(() => useEditorOperations(gw));

    expect(result.current.isAvailable("editor.findReplace")).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.panel).toBe("findReplace");
    });
  });

  it("does not open find when Workbench is inactive", async () => {
    const gw = makeGateway({ workbenchActive: false, ctx: null });
    const { result } = renderHook(() => useEditorOperations(gw));

    expect(result.current.isAvailable("editor.findReplace")).toBe(false);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(result.current.panel).toBeNull();
  });

  it("does not dispatch during IME composition or keyCode 229", async () => {
    const gw = makeGateway();
    const { result } = renderHook(() => useEditorOperations(gw));

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
      const ime229 = new KeyboardEvent("keydown", {
        key: "f",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(ime229, "keyCode", { get: () => 229 });
      Object.defineProperty(ime229, "which", { get: () => 229 });
      window.dispatchEvent(ime229);
    });

    expect(result.current.panel).toBeNull();
  });

  it("does not intercept unregistered Ctrl+K palette chord", async () => {
    const gw = makeGateway();
    const { result } = renderHook(() => useEditorOperations(gw));

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(result.current.panel).toBeNull();
  });

  it("ignores Ctrl+F when focus is outside Workbench", async () => {
    document.body.innerHTML = `<div data-testid="workbench"></div><input id="outside" />`;
    document.getElementById("outside")?.focus();

    const gw = makeGateway();
    const { result } = renderHook(() => useEditorOperations(gw));

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(result.current.panel).toBeNull();
  });
});

describe("useEditorOperations preferences", () => {
  let engine: FakeEngineState;

  beforeEach(() => {
    engine = createFakeEngineState();
    window.translunar = createFakeDesktopApi(engine);
    document.body.innerHTML = `<div data-testid="workbench"><button id="focus">x</button></div>`;
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete window.translunar;
    document.body.innerHTML = "";
  });

  it("loads preferences on mount and persists a single field", async () => {
    const gw = makeGateway();
    const { result } = renderHook(() => useEditorOperations(gw));

    await waitFor(() => {
      expect(result.current.preferences?.autocomplete).toBe(true);
    });

    await act(async () => {
      await result.current.persistPreferenceField("autocomplete", false);
    });

    expect(result.current.preferences?.autocomplete).toBe(false);
    const update = engine.calls.find(
      (call) => call.method === "editor.preferences.update",
    );
    expect(update?.params).toMatchObject({
      preferences: { autocomplete: false },
    });
  });
});
