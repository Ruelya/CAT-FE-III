import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Document, Project } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { ImportDocumentDialog } from "./ImportDocumentDialog.js";

const project: Project = {
  id: "p1",
  name: "演示项目",
  sourceLocale: "en-US",
  targetLocale: "zh-CN",
  domain: "general",
  lifecycle: "active",
  revision: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
  configuration: {},
};

function projectWith(configuration: Project["configuration"]): Project {
  return { ...project, configuration };
}

const importedDocument: Document = {
  id: "d1",
  projectId: "p1",
  name: "manual.docx",
  relativePath: "manual.docx",
  format: "docx",
  filterId: "docx",
  status: "active",
  currentVersion: 1,
  revision: 1,
  segmentCount: 3,
  sourceSha256: "abc",
  degradation: [],
  importedAtMs: 1,
  updatedAtMs: 1,
};

interface BridgeOptions {
  sourcePath?: string | null;
  srxPath?: string | null;
  invoke?: (method: string, params: unknown) => Promise<EngineInvokeResponse>;
}

function installBridge(options: BridgeOptions = {}): ReturnType<typeof vi.fn> {
  const spy = vi.fn(
    options.invoke ??
      (() =>
        Promise.resolve<EngineInvokeResponse>({
          ok: true,
          result: { document: importedDocument, segmentCount: 3 },
        })),
  );
  const api: Partial<DesktopApi> = {
    invoke: spy,
    chooseSourceFile: () => Promise.resolve(options.sourcePath ?? null),
    chooseSrxFile: () => Promise.resolve(options.srxPath ?? null),
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return spy;
}

describe("ImportDocumentDialog", () => {
  it("keeps submit disabled until a source file is chosen", async () => {
    installBridge({ sourcePath: null });
    render(
      <ImportDocumentDialog
        open
        project={project}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    expect(screen.getByText("未选择文件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入" })).toBeDisabled();
    // A canceled pick keeps the honest empty state.
    await userEvent.click(screen.getByRole("button", { name: "选择文件…" }));
    expect(screen.getByText("未选择文件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入" })).toBeDisabled();
  });

  it("imports with sentence segmentation and no SRX by default", async () => {
    const spy = installBridge({ sourcePath: "/tmp/manual.docx" });
    const onImported = vi.fn();
    const onClose = vi.fn();
    render(
      <ImportDocumentDialog
        open
        project={project}
        onClose={onClose}
        onImported={onImported}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "选择文件…" }));
    expect(await screen.findByText("manual.docx")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith({
        document: importedDocument,
        segmentCount: 3,
      });
    });
    // 自动 (the default) sends no filterId at all: the engine probes.
    expect(spy).toHaveBeenCalledWith("document.import", {
      projectId: "p1",
      sourcePath: "/tmp/manual.docx",
      segmentation: "sentence",
      srxPath: null,
    });
    // The successful choice is auto-saved as the project default; a
    // sentence import without SRX resets a stored ruleset to built-in.
    expect(spy).toHaveBeenCalledWith("project.update", {
      projectId: "p1",
      segmentation: "sentence",
      clearSrxPath: true,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("sends the exact bilingual filterId when a 双栏 format is picked", async () => {
    for (const [option, filterId] of [
      ["双栏 XLSX", "builtin.bilingual-xlsx"],
      ["双栏 DOCX", "builtin.bilingual-docx"],
    ] as const) {
      const spy = installBridge({ sourcePath: "/tmp/bilingual-file" });
      const { unmount } = render(
        <ImportDocumentDialog
          open
          project={project}
          onClose={vi.fn()}
          onImported={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "选择文件…" }));
      await userEvent.selectOptions(screen.getByLabelText("格式"), option);
      await userEvent.click(screen.getByRole("button", { name: "导入" }));
      await waitFor(() => {
        expect(spy).toHaveBeenCalledWith("document.import", {
          projectId: "p1",
          sourcePath: "/tmp/bilingual-file",
          filterId,
          segmentation: "sentence",
          srxPath: null,
        });
      });
      unmount();
    }
  });

  it("offers exactly 自动 and the two bilingual filters as formats", () => {
    installBridge({ sourcePath: null });
    render(
      <ImportDocumentDialog
        open
        project={project}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("格式");
    const options = Array.from(select.querySelectorAll("option")).map(
      (option) => option.textContent,
    );
    // Probe already covers docx/txt/md/html/xliff/xlsx/pptx — no builtin
    // catalog is repeated here.
    expect(options).toEqual(["自动", "双栏 XLSX", "双栏 DOCX"]);
    expect(select).toHaveValue("auto");
  });

  it("sends the chosen SRX ruleset in sentence mode", async () => {
    const spy = installBridge({
      sourcePath: "/tmp/manual.docx",
      srxPath: "/tmp/rules.srx",
    });
    render(
      <ImportDocumentDialog
        open
        project={project}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "选择文件…" }));
    await userEvent.click(
      screen.getByRole("button", { name: "选择 SRX 规则…" }),
    );
    expect(await screen.findByText("rules.srx")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("document.import", {
        projectId: "p1",
        sourcePath: "/tmp/manual.docx",
        segmentation: "sentence",
        srxPath: "/tmp/rules.srx",
      });
    });
    // The chosen ruleset becomes the project default for the next import.
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("project.update", {
        projectId: "p1",
        segmentation: "sentence",
        srxPath: "/tmp/rules.srx",
      });
    });
  });

  it("imports in paragraph mode and never sends an inert SRX path", async () => {
    const spy = installBridge({
      sourcePath: "/tmp/manual.docx",
      srxPath: "/tmp/rules.srx",
    });
    render(
      <ImportDocumentDialog
        open
        project={project}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "选择文件…" }));
    await userEvent.click(
      screen.getByRole("button", { name: "选择 SRX 规则…" }),
    );
    await userEvent.selectOptions(
      screen.getByLabelText("分段方式"),
      "paragraph",
    );
    // Paragraph mode ignores SRX, so the picker is disabled to say so.
    expect(
      screen.getByRole("button", { name: "选择 SRX 规则…" }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("document.import", {
        projectId: "p1",
        sourcePath: "/tmp/manual.docx",
        segmentation: "paragraph",
        srxPath: null,
      });
    });
    // Paragraph auto-save keeps the stored SRX default untouched: only the
    // segmentation is sent (the engine rejects paragraph + srxPath).
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("project.update", {
        projectId: "p1",
        segmentation: "paragraph",
      });
    });
  });

  it("pre-fills from the project's stored import defaults", () => {
    installBridge({ sourcePath: null });
    render(
      <ImportDocumentDialog
        open
        project={projectWith({
          segmentation: "paragraph",
          srxPath: "/tmp/stored-rules.srx",
        })}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("分段方式")).toHaveValue("paragraph");
    // The stored ruleset is shown (kept for a switch back to sentence),
    // but the picker stays disabled while paragraph mode is selected.
    expect(screen.getByText("stored-rules.srx")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "选择 SRX 规则…" }),
    ).toBeDisabled();
  });

  it("reports the auto-saved project back through onProjectUpdated", async () => {
    const updatedProject: Project = {
      ...project,
      revision: 2,
      configuration: { segmentation: "sentence", srxPath: null },
    };
    installBridge({
      sourcePath: "/tmp/manual.docx",
      invoke: (method) => {
        if (method === "project.update") {
          return Promise.resolve({ ok: true, result: updatedProject });
        }
        return Promise.resolve({
          ok: true,
          result: { document: importedDocument, segmentCount: 3 },
        });
      },
    });
    const onProjectUpdated = vi.fn();
    render(
      <ImportDocumentDialog
        open
        project={project}
        onClose={vi.fn()}
        onImported={vi.fn()}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "选择文件…" }));
    await userEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => {
      expect(onProjectUpdated).toHaveBeenCalledWith(updatedProject);
    });
  });

  it("stays open with an honest warning when the defaults save fails", async () => {
    installBridge({
      sourcePath: "/tmp/manual.docx",
      invoke: (method) => {
        if (method === "project.update") {
          return Promise.resolve({
            ok: false,
            error: { code: "internal", message: "store went away" },
          });
        }
        return Promise.resolve({
          ok: true,
          result: { document: importedDocument, segmentCount: 3 },
        });
      },
    });
    const onImported = vi.fn();
    const onClose = vi.fn();
    render(
      <ImportDocumentDialog
        open
        project={project}
        onClose={onClose}
        onImported={onImported}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "选择文件…" }));
    await userEvent.click(screen.getByRole("button", { name: "导入" }));
    // The import itself succeeded, so the parent still gets the result;
    // the dialog stays open and says which half failed.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /文档已导入，但保存项目默认分段设置失败/,
      );
    });
    expect(onImported).toHaveBeenCalledWith({
      document: importedDocument,
      segmentCount: 3,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the engine error and stays open on failure", async () => {
    installBridge({
      sourcePath: "/tmp/manual.docx",
      invoke: (method) => {
        if (method === "document.import") {
          return Promise.resolve({
            ok: false,
            error: {
              code: "invalidParams",
              message: "invalid SRX ruleset /tmp/rules.srx",
            },
          });
        }
        return Promise.resolve({ ok: true, result: {} });
      },
    });
    const onImported = vi.fn();
    const onClose = vi.fn();
    render(
      <ImportDocumentDialog
        open
        project={project}
        onClose={onClose}
        onImported={onImported}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "选择文件…" }));
    await userEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "invalid SRX ruleset /tmp/rules.srx",
      );
    });
    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
