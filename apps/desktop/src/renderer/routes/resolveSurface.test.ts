import { describe, expect, it } from "vitest";

import {
  resolveHomeSurface,
  resolveOpenProjectRoute,
  resolveStartupDestination,
} from "./resolveSurface";
import { makeSession } from "../state/session";

const project = {
  id: "p1",
  name: "Demo",
  domain: "general",
  sourceLocale: "en-US",
  targetLocale: "zh-CN",
  lifecycle: "active" as const,
  revision: 1,
  createdAtMs: 0,
  updatedAtMs: 0,
  configuration: {},
};

describe("resolveSurface", () => {
  it("routes empty projects to welcome and non-empty to projects", () => {
    expect(resolveHomeSurface([])).toBe("welcome");
    expect(resolveHomeSurface([project])).toBe("projects");
  });

  it("prefers validated session workbench over home", () => {
    const session = makeSession("p1", "d1");
    expect(
      resolveStartupDestination({ validatedSession: session, projects: [] }),
    ).toEqual({ kind: "workbench", session });
    expect(
      resolveStartupDestination({ validatedSession: null, projects: [] }),
    ).toEqual({ kind: "home", home: "welcome", projects: [] });
    expect(
      resolveStartupDestination({
        validatedSession: null,
        projects: [project],
      }),
    ).toEqual({ kind: "home", home: "projects", projects: [project] });
  });

  it("opens empty projects to import and otherwise first document", () => {
    expect(resolveOpenProjectRoute([])).toEqual({ kind: "import" });
    expect(resolveOpenProjectRoute([{ id: "a" }, { id: "b" }])).toEqual({
      kind: "document",
      documentId: "a",
    });
  });
});
