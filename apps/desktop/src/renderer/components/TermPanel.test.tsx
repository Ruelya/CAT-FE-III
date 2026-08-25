import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Segment } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { TermPanel } from "./TermPanel.js";

const SEGMENT: Segment = {
  id: "s1",
  documentId: "d1",
  ordinal: 0,
  structuralPath: "p:0",
  sourceText: "The retention period is 30 days.",
  targetText: "",
  state: "untranslated",
  revision: 1,
  sourceHash: "hash",
  contextHash: "context",
  updatedAtMs: 1,
};

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

const MOUNT = {
  projectId: "p1",
  termbaseId: "tb1",
  priority: 0,
  enabled: true,
  writable: true,
  revision: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
};

const TERM_MATCH = {
  entryId: "te1",
  termbaseId: "tb1",
  sourceTerm: "retention period",
  start: 4,
  end: 20,
  translations: [
    {
      id: "tt1",
      entryId: "te1",
      locale: "zh-CN",
      term: "保留期",
      preferred: true,
      forbidden: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    },
  ],
};

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

describe("TermPanel", () => {
  it("points at project settings when no termbase is mounted", async () => {
    installBridge((method) => {
      if (method === "termbase.list") {
        return Promise.resolve({
          ok: true,
          result: { termbases: [], mounts: [] },
        });
      }
      return Promise.resolve({ ok: true, result: { matches: [] } });
    });
    render(
      <TermPanel
        projectId="p1"
        targetLocale="zh-CN"
        activeSegment={SEGMENT}
        onInsert={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("尚未挂载术语库")).toBeInTheDocument();
    });
  });

  it("lists term hits for the active segment and inserts a translation", async () => {
    const onInsert = vi.fn();
    installBridge((method) => {
      if (method === "termbase.list") {
        return Promise.resolve({
          ok: true,
          result: { termbases: [TERMBASE], mounts: [MOUNT] },
        });
      }
      if (method === "term.lookup") {
        return Promise.resolve({
          ok: true,
          result: { matches: [TERM_MATCH] },
        });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "notFound", message: "?" },
      });
    });
    render(
      <TermPanel
        projectId="p1"
        targetLocale="zh-CN"
        activeSegment={SEGMENT}
        onInsert={onInsert}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("retention period")).toBeInTheDocument();
    });
    expect(screen.getByText("保留期")).toBeInTheDocument();
    expect(screen.getByText("首选")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "插入" }));
    expect(onInsert).toHaveBeenCalledWith("保留期");
  });

  it("adds a quick term into the writable mounted termbase", async () => {
    const calls: Array<[string, unknown]> = [];
    installBridge((method, params) => {
      calls.push([method, params]);
      if (method === "termbase.list") {
        return Promise.resolve({
          ok: true,
          result: { termbases: [TERMBASE], mounts: [MOUNT] },
        });
      }
      if (method === "term.add") {
        return Promise.resolve({
          ok: true,
          result: { entry: { id: "te-new" } },
        });
      }
      return Promise.resolve({ ok: true, result: { matches: [] } });
    });
    render(
      <TermPanel
        projectId="p1"
        targetLocale="zh-CN"
        activeSegment={SEGMENT}
        onInsert={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/源术语/)).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText(/源术语/), "retention period");
    await userEvent.type(screen.getByLabelText("目标术语"), "保留期");
    await userEvent.click(screen.getByRole("button", { name: "添加术语" }));
    await waitFor(() => {
      expect(calls.some(([method]) => method === "term.add")).toBe(true);
    });
    const addCall = calls.find(([method]) => method === "term.add");
    expect(addCall?.[1]).toMatchObject({
      termbaseId: "tb1",
      sourceTerm: "retention period",
      targetTerm: "保留期",
      targetLocale: "zh-CN",
    });
  });
});
