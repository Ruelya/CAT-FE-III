import { EMPTY_SEGMENT_INTEL } from "./segment-intel";
import { describe, expect, it } from "vitest";

import type { AppSurface } from "./app-state";
import {
  aiSectionAvailable,
  collaborationAvailable,
  defaultAiSection,
  resolveP4ReturnTarget,
  resolveP4RouteContext,
} from "./p4-route-context";
import type { SessionIdentity } from "./session";

const session: SessionIdentity = {
  version: 1,
  projectId: "p1",
  documentId: "d1",
};

function workbench(activeSegmentId: string | null = "s1"): AppSurface {
  return {
    kind: "workbench",
    ctx: {
      session,
      project: {
        id: "p1",
        name: "Alpha",
        domain: "general",
        sourceLocale: "en",
        targetLocale: "zh",
        lifecycle: "active",
        revision: 1,
        createdAtMs: 0,
        updatedAtMs: 0,
        configuration: {},
      },
      document: {
        id: "d1",
        projectId: "p1",
        name: "Doc",
        revision: 1,
        updatedAtMs: 0,
        filterId: "plain",
        format: "txt",
        relativePath: "Doc.txt",
        sourceSha256: "abc",
        status: "active",
        segmentCount: 1,
        currentVersion: 1,
        importedAtMs: 0,
        degradation: [],
      },
      documents: [],
      rows: [],
      counts: null,
    },
    activeSegmentId,
    focusSegmentId: null,
    intel: EMPTY_SEGMENT_INTEL,
    tmCollapsed: false,
    transitionError: null,
    pendingConfirm: false,
  };
}

describe("p4-route-context", () => {
  it("extracts project context from workbench/qa/export", () => {
    const wb = workbench("seg-9");
    expect(resolveP4RouteContext(wb)).toEqual({
      projectId: "p1",
      projectName: "Alpha",
      documentId: "d1",
      activeSegmentId: "seg-9",
      session,
    });
    const qa: AppSurface = {
      kind: "qa",
      ctx: (wb as Extract<AppSurface, { kind: "workbench" }>).ctx,
      issues: [],
      issuesLoaded: false,
      run: null,
      loading: false,
      error: null,
      scope: "file",
    };
    expect(resolveP4RouteContext(qa)?.activeSegmentId).toBeNull();
  });

  it("retains context on P4 surfaces and clears home routes", () => {
    expect(resolveP4RouteContext({ kind: "welcome" })).toBeNull();
    expect(
      resolveP4RouteContext({
        kind: "projects",
        projects: [],
        lifecycle: "active",
        total: 0,
        offset: 0,
        limit: 50,
      }),
    ).toBeNull();
    const ctx = {
      projectId: "p1",
      projectName: "Alpha",
      documentId: "d1",
      activeSegmentId: null as string | null,
      session,
    };
    expect(
      resolveP4RouteContext({
        kind: "ai-control",
        returnTarget: { kind: "projects" },
        context: ctx,
        section: "providers",
      }),
    ).toEqual(ctx);
  });

  it("builds return targets for workbench and insights", () => {
    expect(resolveP4ReturnTarget(workbench("s2"))).toEqual({
      kind: "workbench",
      session,
      activeSegmentId: "s2",
    });
    expect(
      resolveP4ReturnTarget({
        kind: "insights",
        projectId: "p1",
        projectName: "Alpha",
        returnTo: "projects",
        session: null,
        analytics: null,
        documents: [],
        loading: false,
        error: null,
      }),
    ).toEqual({ kind: "projects" });
  });

  it("gates collaboration and AI sections", () => {
    expect(collaborationAvailable(null)).toBe(false);
    const ctx = {
      projectId: "p1",
      projectName: "A",
      documentId: "d1",
      activeSegmentId: "s1",
      session,
    };
    expect(collaborationAvailable(ctx)).toBe(true);
    expect(aiSectionAvailable("providers", null)).toBe(true);
    expect(aiSectionAvailable("batch", null)).toBe(false);
    expect(aiSectionAvailable("batch", ctx)).toBe(true);
    expect(
      aiSectionAvailable("interactive", { ...ctx, documentId: null }),
    ).toBe(false);
    expect(
      aiSectionAvailable("interactive", { ...ctx, activeSegmentId: null }),
    ).toBe(false);
    expect(aiSectionAvailable("interactive", ctx)).toBe(true);
    expect(
      aiSectionAvailable("quality", { ...ctx, activeSegmentId: null }),
    ).toBe(true);
    expect(defaultAiSection(null)).toBe("providers");
    expect(defaultAiSection(ctx)).toBe("interactive");
    expect(defaultAiSection({ ...ctx, activeSegmentId: null })).toBe("batch");
  });
});
