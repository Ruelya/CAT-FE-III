import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Segment, TmMatchItem } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { ConcordancePanel, searchConcordance } from "./ConcordancePanel.js";

function segment(
  id: string,
  ordinal: number,
  source: string,
  target = "",
): Segment {
  return {
    id,
    documentId: "d1",
    ordinal,
    structuralPath: `p:${ordinal}`,
    sourceText: source,
    targetText: target,
    state: target ? "draft" : "untranslated",
    revision: 1,
    sourceHash: "hash",
    contextHash: "context",
    updatedAtMs: 1,
  };
}

const SEGMENTS = [
  segment("s1", 0, "The retention period is 30 days.", "保留期为 30 天。"),
  segment("s2", 1, "Retention matters.", ""),
  segment("s3", 2, "Nothing here.", "这里没有。"),
];

const TM_MATCH: TmMatchItem = {
  entry: {
    id: "tm-1",
    memoryId: "tm-p1",
    sourceText: "The retention policy is 30 days.",
    targetText: "保留策略为 30 天。",
    sourceHash: "hash",
    originProjectId: "p1",
    originDocumentId: "d0",
    originSegmentId: "s0",
    confirmedAtMs: 1,
  },
  score: 82,
  grade: "fuzzy",
};

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
): void {
  const api: Partial<DesktopApi> = { invoke };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
}

describe("searchConcordance", () => {
  it("finds case-insensitive hits in source and target", () => {
    const hits = searchConcordance(SEGMENTS, "retention");
    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.field === "source")).toBe(true);
    const targetHits = searchConcordance(SEGMENTS, "保留期");
    expect(targetHits).toHaveLength(1);
    expect(targetHits[0]?.field).toBe("target");
  });

  it("returns nothing for a blank query", () => {
    expect(searchConcordance(SEGMENTS, "   ")).toHaveLength(0);
  });
});

/** Bridge with empty-but-valid results for every method the panel calls. */
function emptyBridge(method: string): Promise<EngineInvokeResponse> {
  if (method === "memory.list") {
    return Promise.resolve({
      ok: true,
      result: { memories: [], mounts: [] },
    });
  }
  if (method === "tm.list") {
    return Promise.resolve({ ok: true, result: { entries: [], total: 0 } });
  }
  return Promise.resolve({
    ok: true,
    result: { matches: [], totalMatches: 0 },
  });
}

function mount(memoryId: string, enabled: boolean) {
  return {
    projectId: "p1",
    memoryId,
    priority: 0,
    enabled,
    writable: false,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function memory(id: string, name: string) {
  return {
    id,
    name,
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

describe("ConcordancePanel", () => {
  beforeEach(() => {
    installBridge(emptyBridge);
  });

  it("seeds the query from the F3 selection and lists hits", () => {
    render(
      <ConcordancePanel
        projectId="p1"
        segments={SEGMENTS}
        initialQuery="retention"
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/检索词/)).toHaveValue("retention");
    expect(screen.getByText("2 命中")).toBeInTheDocument();
    // Substring highlighting wraps the matched chunk in a mark.
    expect(screen.getAllByText(/retention/i).length).toBeGreaterThan(0);
  });

  it("jumps to the hit segment", async () => {
    const onJump = vi.fn();
    render(
      <ConcordancePanel
        projectId="p1"
        segments={SEGMENTS}
        initialQuery="保留期"
        onJump={onJump}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "定位句段" }));
    expect(onJump).toHaveBeenCalledWith("s1");
  });

  it("shows fuzzy TM concordance hits from the engine", async () => {
    installBridge((method) => {
      if (method === "tm.lookup") {
        return Promise.resolve({
          ok: true,
          result: { matches: [TM_MATCH], totalMatches: 1 },
        });
      }
      return emptyBridge(method);
    });
    render(
      <ConcordancePanel
        projectId="p1"
        segments={SEGMENTS}
        initialQuery="retention period"
        onJump={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("82%")).toBeInTheDocument();
    });
    expect(screen.getByText(/保留策略为 30 天/)).toBeInTheDocument();
  });

  it("supports typing a new query", async () => {
    render(
      <ConcordancePanel
        projectId="p1"
        segments={SEGMENTS}
        initialQuery=""
        onJump={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/检索词/), "nothing");
    expect(screen.getByText("1 命中")).toBeInTheDocument();
  });

  it("surfaces target-side substring hits from tm.list with a 译文 badge", async () => {
    installBridge((method) => {
      if (method === "memory.list") {
        return Promise.resolve({
          ok: true,
          result: {
            memories: [memory("mem-1", "主记忆库")],
            mounts: [mount("mem-1", true)],
          },
        });
      }
      if (method === "tm.list") {
        return Promise.resolve({
          ok: true,
          result: {
            entries: [
              {
                id: "tm-t1",
                memoryId: "mem-1",
                sourceText: "The retention policy is 30 days.",
                targetText: "保留策略为 30 天。",
                sourceHash: "hash",
                originProjectId: "p1",
                originDocumentId: "d0",
                originSegmentId: "s0",
                confirmedAtMs: 5,
              },
            ],
            total: 1,
          },
        });
      }
      return emptyBridge(method);
    });
    render(
      <ConcordancePanel
        projectId="p1"
        segments={SEGMENTS}
        initialQuery="保留策略"
        onJump={vi.fn()}
      />,
    );
    const section = await screen.findByRole("region", {
      name: "TM 双侧子串命中",
    });
    await waitFor(() => {
      expect(section).toHaveTextContent("译文");
    });
    // Target-only hit: the badge names the matched side and skips 源文.
    expect(section).not.toHaveTextContent("源文");
    expect(section).toHaveTextContent("主记忆库");
    // The matched chunk in the target line is marked, verbatim from the entry.
    const marks = Array.from(section.querySelectorAll("mark")).map(
      (node) => node.textContent,
    );
    expect(marks).toContain("保留策略");
  });

  it("queries tm.list only for enabled mounts", async () => {
    const listedMemoryIds: string[] = [];
    installBridge((method, params) => {
      if (method === "memory.list") {
        return Promise.resolve({
          ok: true,
          result: {
            memories: [memory("mem-on", "启用库"), memory("mem-off", "停用库")],
            mounts: [mount("mem-on", true), mount("mem-off", false)],
          },
        });
      }
      if (method === "tm.list") {
        listedMemoryIds.push((params as { memoryId: string }).memoryId);
        return Promise.resolve({ ok: true, result: { entries: [], total: 0 } });
      }
      return emptyBridge(method);
    });
    render(
      <ConcordancePanel
        projectId="p1"
        segments={SEGMENTS}
        initialQuery="retention"
        onJump={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(listedMemoryIds).toEqual(["mem-on"]);
    });
  });
});
