import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { TermManagePanel } from "./TermManagePanel.js";

const TERMBASE = {
  id: "tb1",
  name: "产品术语",
  sourceLocale: "en-US",
  domain: null,
  writable: true,
  revision: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
};

function translation(
  id: string,
  term: string,
  options: { forbidden?: boolean } = {},
) {
  return {
    id,
    entryId: "te1",
    locale: "zh-CN",
    term,
    preferred: !(options.forbidden ?? false),
    forbidden: options.forbidden ?? false,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function entry(
  id: string,
  sourceTerm: string,
  translations: ReturnType<typeof translation>[],
) {
  return {
    id,
    termbaseId: "tb1",
    sourceLocale: "en-US",
    sourceTerm,
    partOfSpeech: null,
    definition: null,
    example: null,
    domain: null,
    status: "active",
    revision: 1,
    translations,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(invoke);
  const api: Partial<DesktopApi> = { invoke: spy };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return spy;
}

describe("TermManagePanel", () => {
  it("lists the termbase entries from term.list", async () => {
    installBridge(() =>
      Promise.resolve({
        ok: true,
        result: {
          entries: [
            entry("te1", "actuator", [
              translation("tt1", "执行器"),
              translation("tt2", "作动器", { forbidden: true }),
            ]),
            entry("te2", "gasket", [translation("tt3", "垫片")]),
          ],
        },
      }),
    );
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByText("actuator")).toBeInTheDocument();
    });
    expect(screen.getByText("2 条术语")).toBeInTheDocument();
    expect(screen.getByText("gasket")).toBeInTheDocument();
    expect(screen.getByText("执行器")).toBeInTheDocument();
    expect(screen.getByText("禁用")).toBeInTheDocument();
  });

  it("shows an honest empty state for an empty termbase", async () => {
    installBridge(() => Promise.resolve({ ok: true, result: { entries: [] } }));
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByText("术语库为空")).toBeInTheDocument();
    });
    expect(screen.getByText("0 条术语")).toBeInTheDocument();
  });

  it("surfaces term.list errors instead of pretending", async () => {
    installBridge(() =>
      Promise.resolve({
        ok: false,
        error: { code: "notFound", message: "termbase tb1" },
      }),
    );
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("termbase tb1");
    });
    expect(screen.queryByText("术语库为空")).not.toBeInTheDocument();
  });

  it("edits source and target through term.update and reloads", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "term.update") {
        return Promise.resolve({ ok: true, result: { entry: {} } });
      }
      return Promise.resolve({
        ok: true,
        result: {
          entries: [entry("te1", "actuator", [translation("tt1", "执行器")])],
        },
      });
    });
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByText("actuator")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "编辑译文 执行器" }),
    );
    const sourceField = screen.getByLabelText("源术语");
    const targetField = screen.getByLabelText("目标术语");
    expect(sourceField).toHaveValue("actuator");
    expect(targetField).toHaveValue("执行器");
    await userEvent.clear(sourceField);
    await userEvent.type(sourceField, "sensor");
    await userEvent.clear(targetField);
    await userEvent.type(targetField, "传感器");
    const listCallsBeforeSave = calls.filter(
      ([method]) => method === "term.list",
    ).length;
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => {
      expect(calls.some(([method]) => method === "term.update")).toBe(true);
    });
    const updateCall = calls.find(([method]) => method === "term.update");
    expect(updateCall?.[1]).toEqual({
      entryId: "te1",
      sourceTerm: "sensor",
      translationId: "tt1",
      targetTerm: "传感器",
    });
    await waitFor(() => {
      expect(
        calls.filter(([method]) => method === "term.list").length,
      ).toBeGreaterThan(listCallsBeforeSave);
    });
  });

  it("keeps the edit form open and shows the engine error on conflict", async () => {
    installBridge((method) => {
      if (method === "term.update") {
        return Promise.resolve({
          ok: false,
          error: {
            code: "conflict",
            message: 'term "sensor" already exists in this termbase',
          },
        });
      }
      return Promise.resolve({
        ok: true,
        result: {
          entries: [entry("te1", "actuator", [translation("tt1", "执行器")])],
        },
      });
    });
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByText("actuator")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "编辑译文 执行器" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        'term "sensor" already exists in this termbase',
      );
    });
    expect(screen.getByLabelText("源术语")).toBeInTheDocument();
  });

  it("deletes a whole entry only after confirmation", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "term.delete") {
        return Promise.resolve({ ok: true, result: { entry: null } });
      }
      return Promise.resolve({
        ok: true,
        result: {
          entries: [entry("te1", "actuator", [translation("tt1", "执行器")])],
        },
      });
    });
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByText("actuator")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "删除术语 actuator" }),
    );
    expect(calls.some(([method]) => method === "term.delete")).toBe(false);
    await userEvent.click(
      screen.getByRole("button", { name: "确认删除术语 actuator" }),
    );
    await waitFor(() => {
      expect(calls.some(([method]) => method === "term.delete")).toBe(true);
    });
    const deleteCall = calls.find(([method]) => method === "term.delete");
    expect(deleteCall?.[1]).toEqual({ entryId: "te1" });
  });

  it("cancels a pending entry deletion without calling the engine", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      return Promise.resolve({
        ok: true,
        result: {
          entries: [entry("te1", "actuator", [translation("tt1", "执行器")])],
        },
      });
    });
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByText("actuator")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "删除术语 actuator" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(calls.some(([method]) => method === "term.delete")).toBe(false);
    expect(
      screen.getByRole("button", { name: "删除术语 actuator" }),
    ).toBeInTheDocument();
  });

  it("removes a single translation when the entry keeps others", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "term.delete") {
        return Promise.resolve({ ok: true, result: { entry: {} } });
      }
      return Promise.resolve({
        ok: true,
        result: {
          entries: [
            entry("te1", "actuator", [
              translation("tt1", "执行器"),
              translation("tt2", "作动器", { forbidden: true }),
            ]),
          ],
        },
      });
    });
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByText("actuator")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "删除译文 作动器" }),
    );
    expect(calls.some(([method]) => method === "term.delete")).toBe(false);
    await userEvent.click(
      screen.getByRole("button", { name: "确认删除译文 作动器" }),
    );
    await waitFor(() => {
      expect(calls.some(([method]) => method === "term.delete")).toBe(true);
    });
    const deleteCall = calls.find(([method]) => method === "term.delete");
    expect(deleteCall?.[1]).toEqual({ entryId: "te1", translationId: "tt2" });
  });

  it("hides the translation delete button for a single-translation entry", async () => {
    installBridge(() =>
      Promise.resolve({
        ok: true,
        result: {
          entries: [entry("te1", "actuator", [translation("tt1", "执行器")])],
        },
      }),
    );
    render(<TermManagePanel termbase={TERMBASE} />);
    await waitFor(() => {
      expect(screen.getByText("actuator")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /删除译文/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "删除术语 actuator" }),
    ).toBeInTheDocument();
  });
});
