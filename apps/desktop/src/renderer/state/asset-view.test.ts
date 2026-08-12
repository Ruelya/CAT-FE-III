import { describe, expect, it } from "vitest";
import type { TmLibrary, TmLibraryMount } from "@translunar/contracts";

import {
  catalogSectionJump,
  formatBasisPoints,
  formatDiagnostics,
  formatScore,
  joinLibraryMount,
  pageLabel,
} from "./asset-view";

describe("asset-view", () => {
  it("joins mounts by library id only", () => {
    const lib: TmLibrary = {
      id: "lib-1",
      name: "L",
      revision: 1,
      sourceLocale: "en",
      targetLocale: "zh",
      writable: true,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const mounts: TmLibraryMount[] = [
      {
        libraryId: "lib-2",
        projectId: "p",
        mode: "write",
        enabled: true,
        priority: 0,
        revision: 1,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        libraryId: "lib-1",
        projectId: "p",
        mode: "reference",
        enabled: true,
        priority: 1,
        revision: 3,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ];
    expect(joinLibraryMount(lib, mounts)?.mode).toBe("reference");
    expect(joinLibraryMount(lib, mounts)?.revision).toBe(3);
  });

  it("formats scores and basis points without inventing values", () => {
    expect(formatBasisPoints(null)).toBe("-");
    expect(formatBasisPoints(5050)).toBe("50.5%");
    expect(formatScore(undefined)).toBe("-");
    expect(formatScore(0.9123)).toBe("0.912");
  });

  it("formats diagnostics and paging", () => {
    expect(formatDiagnostics([{ row: 2, message: "bad" }])).toBe("R2: bad");
    expect(pageLabel(0, 25, 0)).toBe("0");
    expect(pageLabel(25, 25, 60)).toBe("26-50 / 60");
  });

  it("maps catalog kinds to sections", () => {
    expect(
      catalogSectionJump({
        id: "1",
        kind: "tm",
        collectionId: "c",
        collectionName: "C",
        createdAtMs: 1,
        updatedAtMs: 1,
        sourceLocale: "en",
        sourceText: "s",
        targetText: "t",
      }),
    ).toBe("tm");
    expect(
      catalogSectionJump({
        id: "1",
        kind: "all",
        collectionId: "c",
        collectionName: "C",
        createdAtMs: 1,
        updatedAtMs: 1,
        sourceLocale: "en",
        sourceText: "s",
        targetText: "t",
      }),
    ).toBe(null);
  });
});
