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
    expect(spy).toHaveBeenCalledWith("document.import", {
      projectId: "p1",
      sourcePath: "/tmp/manual.docx",
      segmentation: "sentence",
      srxPath: null,
    });
    expect(onClose).toHaveBeenCalled();
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
