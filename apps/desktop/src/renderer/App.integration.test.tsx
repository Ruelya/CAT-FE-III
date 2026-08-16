import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "./App";
import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "./test/fake-desktop-api";
import { SESSION_STORAGE_KEY } from "./state/session";

describe("App P0 vertical slice (fake DesktopApi)", () => {
  let state: FakeEngineState;

  beforeEach(() => {
    localStorage.clear();
    state = createFakeEngineState();
    window.translunar = createFakeDesktopApi(state);
  });

  afterEach(() => {
    cleanup();
  });

  it("boots to Welcome when there are no projects", async () => {
    render(<App />);
    expect(await screen.findByTestId("welcome")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeEnabled();
  });

  it("creates a project, imports, edits, confirms, runs QA, and exports", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    state.exportPath = "C:\\tmp\\out.txt";
    render(<App />);

    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByTestId("create-project");

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Demo");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));

    await screen.findByTestId("workbench");
    expect(state.calls.some((c) => c.method === "project.batchImport")).toBe(
      true,
    );
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain("doc-");

    const editor = await screen.findByTestId("target-editor-seg-1");
    await user.clear(editor);
    await user.type(editor, "你好世界");

    await waitFor(
      () => {
        expect(
          state.calls.some((c) => c.method === "segment.updateTarget"),
        ).toBe(true);
      },
      { timeout: 2000 },
    );

    await user.click(screen.getByRole("button", { name: /^Confirm segment / }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "segment.confirm")).toBe(
        true,
      );
    });

    await user.click(screen.getByTestId("workbench-qa"));
    await screen.findByTestId("qa-review");
    // Entry loads authoritative list before claiming empty.
    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "qa.issue.list")).toBe(true);
    });
    expect(await screen.findByText("No issues")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run QA" }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "qa.run")).toBe(true);
    });
    expect(await screen.findByText("No issues")).toBeInTheDocument();

    const qaReview = screen.getByTestId("qa-review");
    await user.click(within(qaReview).getByRole("button", { name: "Export" }));
    await screen.findByTestId("export-review");
    await user.click(
      within(screen.getByTestId("export-review")).getByRole("button", {
        name: "Export",
      }),
    );
    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "qa.gate.check")).toBe(true);
      expect(state.calls.some((c) => c.method === "document.export")).toBe(
        true,
      );
    });
    expect(await screen.findByTestId("export-result")).toHaveTextContent(
      "C:\\tmp\\out.txt",
    );
  });

  it("blocks export when QA gate fails", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    state.exportPath = "C:\\tmp\\out.txt";
    state.gateClear = false;
    render(<App />);

    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Gate");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");

    await user.click(screen.getByTestId("workbench-export"));
    await screen.findByTestId("export-review");
    await user.click(
      within(screen.getByTestId("export-review")).getByRole("button", {
        name: "Export",
      }),
    );

    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "qa.gate.check")).toBe(true);
    });
    expect(state.calls.some((c) => c.method === "document.export")).toBe(false);
    expect(await screen.findByText(/Blocked/i)).toBeInTheDocument();
  });

  it("treats picker cancellation as no-op on import", async () => {
    const user = userEvent.setup();
    state.sourcePath = null;
    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Cancel");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "project.batchImport")).toBe(
        false,
      );
    });
    expect(screen.getByTestId("import-document")).toBeInTheDocument();
  });

  it("routes existing projects to Project Home", async () => {
    state.projects.push({
      id: "p-existing",
      name: "Existing",
      domain: "general",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      lifecycle: "active",
      revision: 1,
      createdAtMs: 0,
      updatedAtMs: 0,
      configuration: {},
    });
    render(<App />);
    expect(await screen.findByTestId("project-home")).toBeInTheDocument();
    expect(screen.getByText("Existing")).toBeInTheDocument();
  });

  it("clears malformed session and opens Home", async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "{not-json");
    render(<App />);
    expect(await screen.findByTestId("welcome")).toBeInTheDocument();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("does not invent empty QA before list returns", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    let resolveList!: () => void;
    const deferred = new Promise<void>((resolve) => {
      resolveList = resolve;
    });
    const original = window.translunar.invoke.bind(window.translunar);
    window.translunar.invoke = async (method, params) => {
      if (method === "qa.issue.list") {
        await deferred;
        return original(method, params);
      }
      return original(method, params);
    };

    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "QA");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");
    await user.click(screen.getByTestId("workbench-qa"));
    await screen.findByTestId("qa-review");
    expect(screen.queryByText("No issues")).not.toBeInTheDocument();
    expect(screen.getByTestId("qa-loading")).toBeInTheDocument();
    resolveList();
    expect(await screen.findByText("No issues")).toBeInTheDocument();
  });

  it("keeps draft after failed save and does not leave workbench", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    state.failMethods.add("segment.updateTarget");
    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "SaveFail");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");
    const editor = await screen.findByTestId("target-editor-seg-1");
    await user.clear(editor);
    await user.type(editor, "keep-me");
    await user.click(screen.getByTestId("workbench-qa"));
    await waitFor(() => {
      expect(screen.getByTestId("workbench")).toBeInTheDocument();
    });
    expect(screen.getByTestId("target-editor-seg-1")).toHaveValue("keep-me");
  });

  it("activates inactive segment via keyboard focusable control", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    state.segments = [
      {
        id: "seg-1",
        documentId: "doc-pending",
        ordinal: 1,
        revision: 1,
        sourceText: "One",
        targetText: "a",
        state: "draft",
        contextHash: "c",
        sourceHash: "s",
        structuralPath: "1",
        updatedAtMs: 0,
      },
      {
        id: "seg-2",
        documentId: "doc-pending",
        ordinal: 2,
        revision: 1,
        sourceText: "Two",
        targetText: "b",
        state: "draft",
        contextHash: "c",
        sourceHash: "s",
        structuralPath: "2",
        updatedAtMs: 0,
      },
    ];
    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Keys");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");
    const activate = await screen.findByTestId("segment-activate-seg-2");
    activate.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByTestId("target-editor-seg-2"),
    ).toBeInTheDocument();
  });

  it("opens project from home with pending guard", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "p-existing",
      name: "Existing",
      domain: "general",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      lifecycle: "active",
      revision: 1,
      createdAtMs: 0,
      updatedAtMs: 0,
      configuration: {},
    });
    state.documents.push({
      id: "doc-existing",
      projectId: "p-existing",
      name: "src.txt",
      format: "txt",
      filterId: "builtin.txt",
      relativePath: "src.txt",
      status: "active",
      revision: 1,
      currentVersion: 1,
      segmentCount: 1,
      sourceSha256: "abc",
      importedAtMs: 0,
      updatedAtMs: 0,
      degradation: [],
    });
    state.segments.push({
      id: "seg-ex",
      documentId: "doc-existing",
      ordinal: 1,
      revision: 1,
      sourceText: "Hi",
      targetText: "",
      state: "untranslated",
      contextHash: "c",
      sourceHash: "s",
      structuralPath: "1",
      updatedAtMs: 0,
    });
    render(<App />);
    await screen.findByTestId("project-home");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByTestId("workbench")).toBeInTheDocument();
  });

  it("keeps newer draft when typing during deferred update flush under confirm", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    let releaseUpdate!: () => void;
    let updateEntered = false;
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    const original = window.translunar.invoke.bind(window.translunar);
    window.translunar.invoke = async (method, params) => {
      if (method === "segment.updateTarget") {
        updateEntered = true;
        await updateGate;
        return original(method, params);
      }
      return original(method, params);
    };

    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "ConfirmRace");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");
    const editor = await screen.findByTestId("target-editor-seg-1");
    await user.clear(editor);
    await user.type(editor, "first");

    const confirmClick = user.click(
      screen.getByRole("button", { name: /^Confirm segment / }),
    );
    await waitFor(() => {
      expect(updateEntered).toBe(true);
    });
    // Type newer draft while confirm is awaiting the older flush save.
    await user.clear(editor);
    await user.type(editor, "second-draft");
    releaseUpdate();
    await confirmClick;

    await waitFor(() => {
      expect(screen.getByTestId("target-editor-seg-1")).toHaveValue(
        "second-draft",
      );
    });
    // Must not confirm stale first draft as the only update, and must not leave dirty second lost.
    const confirms = state.calls.filter((c) => c.method === "segment.confirm");
    // Either confirm aborted (0) or confirmed after serializing second — never stuck on first-only.
    if (confirms.length > 0) {
      const lastUpdate = [...state.calls]
        .reverse()
        .find((c) => c.method === "segment.updateTarget");
      expect(
        (lastUpdate?.params as { targetText?: string } | undefined)?.targetText,
      ).toBe("second-draft");
    }
    expect(screen.getByTestId("target-editor-seg-1")).toHaveValue(
      "second-draft",
    );
  });

  it("blocks confirm and focus side effects during composition lifecycle", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "IME");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");
    const editor = await screen.findByTestId("target-editor-seg-1");
    const beforeUpdates = state.calls.filter(
      (c) => c.method === "segment.updateTarget",
    ).length;
    const beforeConfirms = state.calls.filter(
      (c) => c.method === "segment.confirm",
    ).length;

    editor.focus();
    // compositionstart → input while composing past debounce → blocked Ctrl+Enter
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: "中" } });
    await new Promise((r) => setTimeout(r, 500));
    fireEvent.keyDown(editor, {
      key: "Enter",
      ctrlKey: true,
      keyCode: 229,
      which: 229,
      isComposing: true,
    });
    // Confirm button path also blocked while composing.
    await user.click(screen.getByRole("button", { name: /^Confirm segment / }));
    expect(
      state.calls.filter((c) => c.method === "segment.updateTarget").length,
    ).toBe(beforeUpdates);
    expect(
      state.calls.filter((c) => c.method === "segment.confirm").length,
    ).toBe(beforeConfirms);
    expect(screen.getByTestId("target-editor-seg-1")).toBeInTheDocument();
    expect(screen.getByTestId("target-editor-seg-1")).toHaveValue("中");

    fireEvent.compositionEnd(editor);
    fireEvent.change(editor, { target: { value: "done-ime" } });
    await waitFor(
      () => {
        expect(
          state.calls.some((c) => c.method === "segment.updateTarget"),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
    await user.click(screen.getByRole("button", { name: /^Confirm segment / }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "segment.confirm")).toBe(
        true,
      );
    });
  });

  it("restores every valid multi-record journal draft when visiting segments", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "Recover",
      domain: "general",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      lifecycle: "active",
      revision: 1,
      createdAtMs: 0,
      updatedAtMs: 0,
      configuration: {},
    });
    state.documents.push({
      id: "doc-1",
      projectId: "proj-1",
      name: "src.txt",
      format: "txt",
      filterId: "builtin.txt",
      relativePath: "src.txt",
      status: "active",
      revision: 1,
      currentVersion: 1,
      segmentCount: 2,
      sourceSha256: "abc",
      importedAtMs: 0,
      updatedAtMs: 0,
      degradation: [],
    });
    state.segments = [
      {
        id: "seg-1",
        documentId: "doc-1",
        ordinal: 1,
        revision: 1,
        sourceText: "One",
        targetText: "",
        state: "untranslated",
        contextHash: "c",
        sourceHash: "s",
        structuralPath: "1",
        updatedAtMs: 0,
      },
      {
        id: "seg-2",
        documentId: "doc-1",
        ordinal: 2,
        revision: 1,
        sourceText: "Two",
        targetText: "",
        state: "untranslated",
        contextHash: "c",
        sourceHash: "s",
        structuralPath: "2",
        updatedAtMs: 0,
      },
    ];
    state.journal = [
      {
        projectId: "proj-1",
        documentId: "doc-1",
        segmentId: "seg-1",
        expectedRevision: 1,
        targetText: "draft-one",
        updatedAtMs: 1,
        checksum: "c1",
      },
      {
        projectId: "proj-1",
        documentId: "doc-1",
        segmentId: "seg-2",
        expectedRevision: 1,
        targetText: "draft-two",
        updatedAtMs: 2,
        checksum: "c2",
      },
    ];
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        projectId: "proj-1",
        documentId: "doc-1",
      }),
    );

    render(<App />);
    expect(await screen.findByTestId("recovery-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("recovery-primary"));
    await screen.findByTestId("workbench");
    expect(await screen.findByTestId("target-editor-seg-1")).toHaveValue(
      "draft-one",
    );

    const activate = await screen.findByTestId("segment-activate-seg-2");
    activate.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByTestId("target-editor-seg-2")).toHaveValue(
      "draft-two",
    );

    // Saving seg-2 should clear only that journal record eventually.
    await waitFor(
      () => {
        expect(
          state.calls.some((c) => c.method === "segment.updateTarget"),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
    await waitFor(() => {
      expect(state.journal.some((r) => r.segmentId === "seg-2")).toBe(false);
    });
    // Unvisited/prior record for seg-1 remains until its own save completes.
    // After we left seg-1, flush should have saved it too.
    await waitFor(() => {
      expect(state.journal.some((r) => r.segmentId === "seg-1")).toBe(false);
    });
  });

  it("retains dirty draft and disables mutations across reconnect rehydrate", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    let resolveHydrate!: () => void;
    const hydrateGate = new Promise<void>((resolve) => {
      resolveHydrate = resolve;
    });
    let hydrateBlocked = false;
    const original = window.translunar.invoke.bind(window.translunar);
    window.translunar.invoke = async (method, params) => {
      if (hydrateBlocked && method === "segment.editor.list") {
        await hydrateGate;
      }
      return original(method, params);
    };

    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Reconnect");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");
    const editor = await screen.findByTestId("target-editor-seg-1");
    await user.clear(editor);
    await user.type(editor, "dirty-across-reconnect");

    hydrateBlocked = true;
    for (const listener of state.statusListeners) {
      listener({ type: "reconnecting", attempt: 1, message: "down" });
    }
    await waitFor(() => {
      expect(screen.getByTestId("target-editor-seg-1")).toBeDisabled();
    });
    expect(screen.getByTestId("workbench")).toBeInTheDocument();
    expect(screen.getByTestId("target-editor-seg-1")).toHaveValue(
      "dirty-across-reconnect",
    );

    for (const listener of state.statusListeners) {
      listener({ type: "reconnected" });
    }
    for (const listener of state.reconnectListeners) {
      listener();
    }

    // Still disabled while rehydrate list is deferred.
    await waitFor(() => {
      expect(screen.getByTestId("target-editor-seg-1")).toBeDisabled();
    });
    expect(screen.getByTestId("target-editor-seg-1")).toHaveValue(
      "dirty-across-reconnect",
    );

    resolveHydrate();
    await waitFor(() => {
      expect(screen.getByTestId("target-editor-seg-1")).not.toBeDisabled();
    });
    expect(screen.getByTestId("target-editor-seg-1")).toHaveValue(
      "dirty-across-reconnect",
    );
    expect(screen.getByTestId("workbench")).toBeInTheDocument();
  });

  it("shows journal clear failure without losing Engine save", async () => {
    const user = userEvent.setup();
    state.sourcePath = "C:\\tmp\\source.txt";
    window.translunar.clearDraftJournal = () =>
      Promise.reject(new Error("clear denied"));
    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "JournalClear");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");
    const editor = await screen.findByTestId("target-editor-seg-1");
    await user.clear(editor);
    await user.type(editor, "engine-kept");
    await waitFor(
      () => {
        expect(
          state.calls.some((c) => c.method === "segment.updateTarget"),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(await screen.findByTestId("journal-error")).toBeInTheDocument();
    expect(screen.getByTestId("journal-error").textContent).toMatch(
      /clear denied|journal clear/i,
    );
    expect(state.segments[0]?.targetText).toBe("engine-kept");
    expect(screen.getByTestId("target-editor-seg-1")).toHaveValue(
      "engine-kept",
    );
  });
});
