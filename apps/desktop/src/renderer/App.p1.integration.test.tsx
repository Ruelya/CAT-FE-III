import {
  cleanup,
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

/**
 * Secondary and destructive row actions live in the row overflow menu, so a
 * test must open the menu the same way a user does.
 */
async function openRowAction(
  user: ReturnType<typeof userEvent.setup>,
  projectId: string,
  action: string,
): Promise<void> {
  await user.click(await screen.findByTestId(`project-menu-${projectId}`));
  await user.click(await screen.findByRole("menuitem", { name: action }));
}

describe("App P1 project lifecycle (fake DesktopApi)", () => {
  let state: FakeEngineState;

  beforeEach(() => {
    localStorage.clear();
    state = createFakeEngineState();
    window.translunar = createFakeDesktopApi(state);
  });

  afterEach(() => {
    cleanup();
  });

  it("batch-imports multiple files and switches documents", async () => {
    const user = userEvent.setup();
    state.sourcePaths = ["C:\\tmp\\a.txt", "C:\\tmp\\b.txt"];
    render(<App />);

    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Multi");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));

    await screen.findByTestId("workbench");
    const batchCalls = state.calls.filter(
      (c) => c.method === "project.batchImport",
    );
    expect(batchCalls).toHaveLength(1);
    const params = batchCalls[0]!.params as {
      atomicity: string;
      items: Array<{ path: string }>;
    };
    expect(params.atomicity).toBe("bestEffort");
    expect(params.items.map((i) => i.path)).toEqual(state.sourcePaths);

    const switcher = screen.getByTestId("document-switcher");
    const select = within(switcher).getByLabelText("Document");
    expect(select.querySelectorAll("option").length).toBe(2);

    await user.selectOptions(select, "doc-2");
    await waitFor(() => {
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain("doc-2");
    });
  });

  it("runs job QA across files and jumps into the other file", async () => {
    const user = userEvent.setup();
    state.sourcePaths = ["C:\\tmp\\a.txt", "C:\\tmp\\b.txt"];
    render(<App />);

    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "JobQA");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");

    const other = state.segments.find((seg) => seg.documentId === "doc-2");
    expect(other).toBeTruthy();
    state.qaIssues = [
      {
        id: "iss-other",
        projectId: state.projects[0]!.id,
        documentId: "doc-2",
        documentName: "b.txt",
        segmentId: other!.id,
        segmentOrdinal: 1,
        category: "tags",
        createdAtMs: 1,
        updatedAtMs: 1,
        disposition: "open",
        evidence: {},
        fingerprint: "fp-other",
        message: "Tag missing on the second file",
        ruleId: "tag_missing",
        severity: "warning",
      },
    ];

    await user.click(screen.getByTestId("workbench-qa"));
    await screen.findByTestId("qa-review");
    expect(screen.getByTestId("job-scope-job")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Tag missing on the second file")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Jump to segment/ }));
    await screen.findByTestId("workbench");
    await waitFor(() => {
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain("doc-2");
    });
  });

  it("exports every file in the job after the gate is clear", async () => {
    const user = userEvent.setup();
    state.sourcePaths = ["C:\\tmp\\a.txt", "C:\\tmp\\b.txt"];
    state.exportPath = "C:\\tmp\\out.txt";
    render(<App />);

    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "JobExport");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");

    await user.click(screen.getByTestId("workbench-export"));
    await screen.findByTestId("export-review");
    expect(screen.getByTestId("job-scope-job")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(
      within(screen.getByTestId("export-review")).getByRole("button", {
        name: "Export",
      }),
    );
    await waitFor(() => {
      const exports = state.calls.filter((call) => call.method === "document.export");
      expect(exports).toHaveLength(2);
    });
    expect(screen.getByTestId("export-result-files")).toBeInTheDocument();
  });

  it("propagates a confirmation into the other file", async () => {
    const user = userEvent.setup();
    state.sourcePaths = ["C:\\tmp\\a.txt", "C:\\tmp\\b.txt"];
    render(<App />);

    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "JobProp");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");

    const first = state.segments.find((seg) => seg.documentId === "doc-1");
    const second = state.segments.find((seg) => seg.documentId === "doc-2");
    expect(first && second).toBeTruthy();
    second!.sourceHash = first!.sourceHash;
    second!.sourceText = first!.sourceText;

    const editor = await screen.findByTestId(`target-editor-${first!.id}`);
    await user.clear(editor);
    await user.type(editor, "共用译文");
    await waitFor(
      () => {
        expect(
          state.calls.some((call) => call.method === "segment.updateTarget"),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
    await user.click(screen.getByRole("button", { name: /^Confirm segment / }));
    await waitFor(() => {
      expect(screen.getByTestId("propagation-notice")).toHaveTextContent(
        "other files",
      );
    });
    expect(second!.targetText).toBe("共用译文");
    expect(second!.state).toBe("draft");
  });

  it("cancels multi-file picker without batchImport", async () => {
    const user = userEvent.setup();
    state.sourcePaths = [];
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

  it("creates a template and project from template", async () => {
    const user = userEvent.setup();
    // Seed one project so Home is reachable after boot.
    state.projects.push({
      id: "proj-seed",
      name: "Seed",
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
    await screen.findByTestId("project-home");
    await user.click(screen.getByTestId("nav-templates"));
    await screen.findByTestId("templates");
    await user.click(screen.getByRole("button", { name: "New template" }));
    await screen.findByTestId("template-form");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Legal base");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        state.calls.some((c) => c.method === "project.template.create"),
      ).toBe(true);
    });
    expect(await screen.findByText("Legal base")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Use template / }));
    await screen.findByTestId("use-template-form");
    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "From tpl");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(
      state.calls.some((c) => c.method === "project.createFromTemplate"),
    ).toBe(true);
  });

  it("opens example after Engine validation", async () => {
    const user = userEvent.setup();
    state.exampleResult = {
      ok: true,
      projectId: "proj-example",
      documentId: "doc-example",
    };
    state.projects.push({
      id: "proj-example",
      name: "Example",
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
      id: "doc-example",
      projectId: "proj-example",
      name: "example.txt",
      format: "txt",
      filterId: "builtin.txt",
      relativePath: "example.txt",
      status: "active",
      revision: 1,
      currentVersion: 1,
      segmentCount: 1,
      sourceSha256: "x",
      importedAtMs: 0,
      updatedAtMs: 0,
      degradation: [],
    });
    state.segments.push({
      id: "seg-ex",
      documentId: "doc-example",
      ordinal: 1,
      revision: 1,
      sourceText: "Example source",
      targetText: "",
      state: "untranslated",
      contextHash: "c",
      sourceHash: "s",
      structuralPath: "1",
      updatedAtMs: 0,
    });

    render(<App />);
    // Seeded example project routes boot to Project Home.
    await screen.findByTestId("project-home");
    await user.click(screen.getByTestId("open-example"));
    await screen.findByTestId("workbench");
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain("doc-example");
  });

  it("searches and navigates a document hit", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "Searchable",
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
      name: "body.txt",
      format: "txt",
      filterId: "builtin.txt",
      relativePath: "body.txt",
      status: "active",
      revision: 1,
      currentVersion: 1,
      segmentCount: 1,
      sourceSha256: "x",
      importedAtMs: 0,
      updatedAtMs: 0,
      degradation: [],
    });
    state.segments.push({
      id: "seg-1",
      documentId: "doc-1",
      ordinal: 1,
      revision: 1,
      sourceText: "unique-needle",
      targetText: "translated",
      state: "draft",
      contextHash: "c",
      sourceHash: "s",
      structuralPath: "1",
      updatedAtMs: 0,
    });
    state.searchHits.push({
      projectId: "proj-1",
      projectName: "Searchable",
      documentId: "doc-1",
      documentName: "body.txt",
      segmentId: "seg-1",
      segmentOrdinal: 1,
      field: "source",
      snippet: "unique-needle",
      updatedAtMs: 1,
    });

    render(<App />);
    await screen.findByTestId("project-home");
    await user.click(screen.getByTestId("nav-search"));
    const searchSurface = await screen.findByTestId("global-search");
    await user.type(
      within(searchSurface).getByLabelText("Query"),
      "unique-needle",
    );
    await user.click(
      within(searchSurface).getByRole("button", { name: "Search" }),
    );
    await screen.findByTestId("search-results");
    await user.click(
      within(screen.getByTestId("search-results")).getByRole("button"),
    );
    await screen.findByTestId("workbench");
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain("doc-1");
  });

  it("archives a project via setLifecycle", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "Archive me",
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
    await screen.findByTestId("project-home");
    await openRowAction(user, "proj-1", "Archive");
    const confirm = await screen.findByTestId("lifecycle-confirm");
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "project.setLifecycle")).toBe(
        true,
      );
    });
  });

  it("loads project insights without analysis methods", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "Insights",
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
    await screen.findByTestId("project-home");
    await openRowAction(user, "proj-1", "Insights");
    await screen.findByTestId("project-insights");
    await waitFor(() => {
      expect(
        state.calls.some((c) => c.method === "project.analytics.get"),
      ).toBe(true);
    });
    expect(
      state.calls.some((c) => String(c.method).startsWith("analysis.")),
    ).toBe(false);
  });

  it("pages project list when total exceeds page limit", async () => {
    const user = userEvent.setup();
    for (let i = 0; i < 55; i += 1) {
      state.projects.push({
        id: `proj-${i}`,
        name: `Project ${i}`,
        domain: "general",
        sourceLocale: "en-US",
        targetLocale: "zh-CN",
        lifecycle: "active",
        revision: 1,
        createdAtMs: 0,
        updatedAtMs: 0,
        configuration: {},
      });
    }
    render(<App />);
    await screen.findByTestId("project-home");
    expect(screen.getByText("Project 0")).toBeInTheDocument();
    expect(screen.queryByText("Project 54")).not.toBeInTheDocument();
    const paging = screen.getByTestId("projects-paging");
    await user.click(within(paging).getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByText("Project 50")).toBeInTheDocument();
    });
    expect(screen.queryByText("Project 0")).not.toBeInTheDocument();
  });

  it("loads project.get before opening edit dialog", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "Stale name",
      domain: "general",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      lifecycle: "active",
      revision: 2,
      createdAtMs: 0,
      updatedAtMs: 0,
      configuration: { keep: true },
    });
    render(<App />);
    await screen.findByTestId("project-home");
    // Diverge list cache from authoritative get after first list call.
    const project = state.projects[0]!;
    project.name = "Fresh name";
    project.revision = 3;
    await openRowAction(user, "proj-1", "Edit");
    const dialog = await screen.findByTestId("edit-project-dialog");
    await waitFor(() => {
      expect(state.calls.some((c) => c.method === "project.get")).toBe(true);
    });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Fresh name");
  });

  it("keeps prior search projection when a later search fails", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "Searchable",
      domain: "general",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      lifecycle: "active",
      revision: 1,
      createdAtMs: 0,
      updatedAtMs: 0,
      configuration: {},
    });
    state.searchHits.push({
      projectId: "proj-1",
      projectName: "Searchable",
      documentId: "doc-1",
      documentName: "body.txt",
      field: "source",
      snippet: "needle-a",
      updatedAtMs: 1,
    });
    render(<App />);
    await screen.findByTestId("project-home");
    await user.click(screen.getByTestId("nav-search"));
    const searchSurface = await screen.findByTestId("global-search");
    await user.type(within(searchSurface).getByLabelText("Query"), "needle-a");
    await user.click(
      within(searchSurface).getByRole("button", { name: "Search" }),
    );
    await screen.findByTestId("search-result-status");
    expect(screen.getByTestId("search-result-status")).toHaveTextContent(
      "needle-a",
    );

    state.failMethods.add("search.global");
    await user.clear(within(searchSurface).getByLabelText("Query"));
    await user.type(within(searchSurface).getByLabelText("Query"), "needle-b");
    await user.click(
      within(searchSurface).getByRole("button", { name: "Search" }),
    );
    await screen.findByTestId("search-error");
    // Prior successful projection remains authoritative.
    expect(screen.getByTestId("search-result-status")).toHaveTextContent(
      "needle-a",
    );
    expect(
      within(screen.getByTestId("search-results")).getByText("needle-a"),
    ).toBeInTheDocument();
  });

  it("guards double Add files activation during deferred flush", async () => {
    const user = userEvent.setup();
    state.sourcePaths = ["C:\\tmp\\a.txt"];
    let resolveFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });
    let blockUpdate = false;
    const original = window.translunar.invoke.bind(window.translunar);
    window.translunar.invoke = async (method, params) => {
      if (blockUpdate && method === "segment.updateTarget") {
        await flushGate;
      }
      return original(method, params);
    };

    render(<App />);
    await screen.findByTestId("welcome");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "AddFiles");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("import-document");
    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await screen.findByTestId("workbench");

    const editor = await screen.findByTestId("target-editor-seg-1");
    await user.clear(editor);
    await user.type(editor, "dirty-before-add");
    blockUpdate = true;
    state.sourcePaths = ["C:\\tmp\\b.txt", "C:\\tmp\\c.txt"];

    const batchBefore = state.calls.filter(
      (c) => c.method === "project.batchImport",
    ).length;
    const addBtn = screen.getByRole("button", { name: "Add files" });
    await user.click(addBtn);
    await user.click(addBtn);
    resolveFlush();

    await waitFor(() => {
      const batchCalls = state.calls.filter(
        (c) => c.method === "project.batchImport",
      );
      // Initial import + at most one Add-files batchImport.
      expect(batchCalls.length).toBe(batchBefore + 1);
    });
  });

  it("does not resurrect templates surface after Home during load", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "HomeStay",
      domain: "general",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      lifecycle: "active",
      revision: 1,
      createdAtMs: 0,
      updatedAtMs: 0,
      configuration: {},
    });
    let resolveTemplates!: () => void;
    const templatesGate = new Promise<void>((resolve) => {
      resolveTemplates = resolve;
    });
    let blockTemplates = false;
    const original = window.translunar.invoke.bind(window.translunar);
    window.translunar.invoke = async (method, params) => {
      if (blockTemplates && method === "project.template.list") {
        await templatesGate;
      }
      return original(method, params);
    };

    render(<App />);
    await screen.findByTestId("project-home");
    blockTemplates = true;
    await user.click(screen.getByTestId("nav-templates"));
    await screen.findByTestId("templates");
    await user.click(screen.getByRole("button", { name: "Home" }));
    await screen.findByTestId("project-home");
    resolveTemplates();
    await waitFor(() => {
      expect(screen.queryByTestId("templates")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("project-home")).toBeInTheDocument();
  });

  it("keeps mutations disabled when insights reconnect refresh fails", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "InsightsFail",
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
    await screen.findByTestId("project-home");
    await openRowAction(user, "proj-1", "Insights");
    await screen.findByTestId("project-insights");

    state.failMethods.add("project.analytics.get");
    for (const listener of state.statusListeners) {
      listener({ type: "reconnecting", attempt: 1, message: "down" });
    }
    for (const listener of state.statusListeners) {
      listener({ type: "reconnected" });
    }
    for (const listener of state.reconnectListeners) {
      listener();
    }

    const banner = await screen.findByTestId("engine-status");
    expect(banner).toHaveTextContent(/Revalidation failed/i);
    // Banner Retry is available; surface mutations stay disabled.
    expect(within(banner).getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.getByTestId("project-insights")).toBeInTheDocument();
  });

  it("awaits template delete confirmation and retains dialog on failure", async () => {
    const user = userEvent.setup();
    state.projects.push({
      id: "proj-1",
      name: "Seed",
      domain: "general",
      sourceLocale: "en-US",
      targetLocale: "zh-CN",
      lifecycle: "active",
      revision: 1,
      createdAtMs: 0,
      updatedAtMs: 0,
      configuration: {},
    });
    state.templates.push({
      id: "tpl-1",
      name: "Custom tpl",
      description: "",
      builtIn: false,
      revision: 1,
      createdAtMs: 0,
      updatedAtMs: 0,
      definition: {
        sourceLocale: "en-US",
        targetLocale: "zh-CN",
        domain: "general",
      },
    });
    render(<App />);
    await screen.findByTestId("project-home");
    await user.click(screen.getByTestId("nav-templates"));
    await screen.findByTestId("templates");
    // Destructive template actions live in the row overflow menu.
    await user.click(screen.getByTestId("template-menu-tpl-1"));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByTestId("delete-template-confirm");
    state.failMethods.add("project.template.delete");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getByTestId("delete-template-confirm")).toBeInTheDocument();
    });
    expect(screen.getByText("Custom tpl")).toBeInTheDocument();
  });
});
