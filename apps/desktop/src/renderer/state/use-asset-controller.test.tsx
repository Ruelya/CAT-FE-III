import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { useAssetController } from "./use-asset-controller";

function gateway(overrides: Partial<{ mutationsEnabled: boolean }> = {}) {
  return {
    generation: 1,
    mutationsEnabled: overrides.mutationsEnabled ?? true,
    projectId: "proj-1",
    projectName: "P",
    sourceLocale: "en",
    targetLocale: "zh",
    section: "tm" as const,
  };
}

describe("useAssetController current-state capture", () => {
  let engine: FakeEngineState;

  beforeEach(() => {
    engine = createFakeEngineState();
    window.translunar = createFakeDesktopApi(engine);
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete window.translunar;
  });

  it("issues TM search with controlled query/threshold and later offsets", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));

    await act(async () => {
      result.current.setTmSearchQuery("hello");
      result.current.setTmSearchThreshold(0.85);
    });

    await act(async () => {
      await result.current.runTmSearch(0);
    });

    await waitFor(() => {
      expect(result.current.state.tm.search.status).toBe("ready");
    });

    const first = engine.calls.filter((c) => c.method === "tm.search");
    expect(first).toHaveLength(1);
    expect(first[0]?.params).toMatchObject({
      projectId: "proj-1",
      query: "hello",
      threshold: 0.85,
      offset: 0,
      limit: 25,
    });

    await act(async () => {
      await result.current.runTmSearch(25);
    });
    await waitFor(() => {
      expect(result.current.state.tm.search.offset).toBe(25);
    });
    const searches = engine.calls.filter((c) => c.method === "tm.search");
    expect(searches).toHaveLength(2);
    expect(searches[1]?.params).toMatchObject({ query: "hello", offset: 25 });
  });

  it("suppresses blank TM/concordance/term/corpus searches", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));

    await act(async () => {
      await result.current.runTmSearch(0);
      await result.current.runConcordance(0);
      await result.current.runTermSearch(0);
      await result.current.runCorpusSearch(0);
    });

    expect(engine.calls.some((c) => c.method === "tm.search")).toBe(false);
    expect(engine.calls.some((c) => c.method === "tm.concordance")).toBe(false);
    expect(engine.calls.some((c) => c.method === "term.search")).toBe(false);
    expect(engine.calls.some((c) => c.method === "corpus.search")).toBe(false);
  });

  it("runs concordance, term, and corpus searches with current queries", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));

    await act(async () => {
      result.current.setConcordanceQuery("conc");
      result.current.setTermSearchText("term-q");
      result.current.setCorpusSearchQuery("corp");
    });

    await act(async () => {
      await result.current.runConcordance(0);
      await result.current.runTermSearch(10);
      await result.current.runCorpusSearch(5);
    });

    await waitFor(() => {
      expect(result.current.state.tm.concordance.status).toBe("ready");
      expect(result.current.state.termbase.search.status).toBe("ready");
      expect(result.current.state.corpus.search.status).toBe("ready");
    });

    expect(
      engine.calls.find((c) => c.method === "tm.concordance")?.params,
    ).toMatchObject({ query: "conc", offset: 0 });
    expect(
      engine.calls.find((c) => c.method === "term.search")?.params,
    ).toMatchObject({ text: "term-q", offset: 10 });
    expect(
      engine.calls.find((c) => c.method === "corpus.search")?.params,
    ).toMatchObject({ query: "corp", offset: 5 });
  });

  it("lists catalog with current filters and page offset", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));

    await act(async () => {
      result.current.setCatalogQuery("q");
      result.current.setCatalogKind("tm");
      result.current.setCatalogFilter({
        sourceLocale: "en",
        domain: "legal",
      });
    });

    await act(async () => {
      await result.current.loadCatalog(25);
    });

    await waitFor(() => {
      expect(result.current.state.catalog.page.status).toBe("ready");
      expect(result.current.state.catalog.page.offset).toBe(25);
    });

    const call = engine.calls.find((c) => c.method === "asset.catalog.list");
    expect(call?.params).toMatchObject({
      query: "q",
      kind: "tm",
      sourceLocale: "en",
      domain: "legal",
      offset: 25,
    });
  });

  it("pages alignment links from the selected session", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));

    await act(async () => {
      await result.current.selectAlignmentSession("align-sess-1");
    });
    await waitFor(() => {
      expect(result.current.state.alignment.selectedSessionId).toBe(
        "align-sess-1",
      );
      expect(result.current.state.alignment.links.status).toBe("ready");
    });

    await act(async () => {
      await result.current.loadAlignmentLinks(50);
    });
    await waitFor(() => {
      expect(result.current.state.alignment.links.offset).toBe(50);
    });

    const gets = engine.calls.filter(
      (c) => c.method === "alignment.session.get",
    );
    expect(gets.length).toBeGreaterThanOrEqual(2);
    expect(gets[gets.length - 1]?.params).toMatchObject({
      sessionId: "align-sess-1",
      offset: 50,
    });
  });

  it("does not page alignment links without a selected session", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));
    const before = engine.calls.length;
    await act(async () => {
      await result.current.loadAlignmentLinks(50);
    });
    expect(
      engine.calls
        .slice(before)
        .some((c) => c.method === "alignment.session.get"),
    ).toBe(false);
  });

  it("starts curation with current library/reason and rolls back with revisions", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));

    await act(async () => {
      result.current.setCurationLibraryId("tm-1");
      result.current.setCurationReason("seed run");
    });

    await act(async () => {
      await result.current.startCuration();
    });

    await waitFor(() => {
      expect(result.current.state.curation.snapshot).not.toBeNull();
      expect(result.current.state.curation.runPending).toBe(false);
    });

    const runCall = engine.calls.find((c) => c.method === "curation.run");
    expect(runCall?.params).toMatchObject({
      projectId: "proj-1",
      libraryId: "tm-1",
      reason: "seed run",
      expectedLibraryRevision: 1,
    });

    const beforeRollback = engine.calls.filter(
      (c) => c.method === "curation.rollback",
    ).length;

    let ok = false;
    await act(async () => {
      ok = await result.current.rollbackCuration("undo run");
    });
    expect(ok).toBe(true);

    const rollbacks = engine.calls.filter(
      (c) => c.method === "curation.rollback",
    );
    expect(rollbacks.length).toBe(beforeRollback + 1);
    expect(rollbacks[rollbacks.length - 1]?.params).toMatchObject({
      reason: "undo run",
      expectedRunRevision: 1,
      expectedLibraryRevision: 1,
    });
  });

  it("suppresses blank curation start and rollback without snapshot", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));

    await act(async () => {
      await result.current.startCuration();
    });
    expect(engine.calls.some((c) => c.method === "curation.run")).toBe(false);

    let ok = true;
    await act(async () => {
      ok = await result.current.rollbackCuration("no snap");
    });
    expect(ok).toBe(false);
    expect(engine.calls.some((c) => c.method === "curation.rollback")).toBe(
      false,
    );
  });

  it("blocks duplicate curation rollback while pending", async () => {
    const { result } = renderHook(() => useAssetController(gateway()));

    await act(async () => {
      result.current.setCurationLibraryId("tm-1");
      result.current.setCurationReason("seed");
    });
    await act(async () => {
      await result.current.startCuration();
    });
    await waitFor(() => {
      expect(result.current.state.curation.snapshot).not.toBeNull();
    });

    engine.failMethods.add("curation.rollback");

    let first = true;
    let second = true;
    await act(async () => {
      const p1 = result.current.rollbackCuration("r1");
      const p2 = result.current.rollbackCuration("r2");
      first = await p1;
      second = await p2;
    });

    expect(first).toBe(false);
    expect(second).toBe(false);
    const rollbacks = engine.calls.filter(
      (c) => c.method === "curation.rollback",
    );
    // Second call hits beginMut while first is pending → no second RPC.
    expect(rollbacks.length).toBe(1);
    expect(result.current.state.curation.actionError).not.toBeNull();
  });
});
