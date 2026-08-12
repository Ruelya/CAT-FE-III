import { describe, expect, it } from "vitest";

import {
  filterCommands,
  fuzzyScore,
  groupCommands,
  nextIndex,
  type PaletteCommand,
} from "./command-palette-model";

const noop = () => undefined;

const command = (
  id: string,
  label: string,
  group: PaletteCommand["group"],
  keywords?: string,
): PaletteCommand => ({
  id,
  label,
  group,
  ...(keywords ? { keywords } : {}),
  run: noop,
});

const catalog: PaletteCommand[] = [
  command("go.home", "Go to Projects", "Navigate", "home project list"),
  command("go.search", "Search segments", "Navigate", "find global"),
  command("go.export", "Open Export", "Navigate", "deliver output docx"),
  command("project.create", "Create project", "Project", "new"),
  command("editor.findReplace", "Find", "Editor"),
  command("view.appearance", "Change theme and accent", "View", "dark light"),
];

describe("fuzzyScore", () => {
  it("matches a subsequence and rejects a non-subsequence", () => {
    expect(fuzzyScore("Open Export", "opex")).not.toBeNull();
    expect(fuzzyScore("Open Export", "zzz")).toBeNull();
  });

  it("treats an empty query as a match", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });

  it("prefers word-boundary matches over scattered ones", () => {
    const boundary = fuzzyScore("Search segments", "ss")!;
    const scattered = fuzzyScore("Assets snapshot", "ss")!;
    expect(boundary).toBeLessThan(scattered);
  });

  it("is case insensitive", () => {
    expect(fuzzyScore("Create project", "CREATE")).not.toBeNull();
  });
});

describe("filterCommands", () => {
  it("returns every enabled command for an empty query", () => {
    expect(filterCommands(catalog, "   ")).toHaveLength(catalog.length);
  });

  it("omits disabled commands", () => {
    const withDisabled = [
      ...catalog,
      { ...command("x", "Unavailable", "Navigate"), disabled: true },
    ];
    expect(filterCommands(withDisabled, "").map((c) => c.id)).not.toContain(
      "x",
    );
    expect(filterCommands(withDisabled, "unav")).toHaveLength(0);
  });

  it("matches on keywords that are not in the label", () => {
    const ids = filterCommands(catalog, "docx").map((c) => c.id);
    expect(ids).toContain("go.export");
  });

  it("ranks the closest label first", () => {
    expect(filterCommands(catalog, "find")[0]!.id).toBe("editor.findReplace");
    expect(filterCommands(catalog, "create")[0]!.id).toBe("project.create");
  });

  it("returns nothing when no command matches", () => {
    expect(filterCommands(catalog, "qqqq")).toHaveLength(0);
  });
});

describe("groupCommands", () => {
  it("keeps a stable group order and drops empty groups", () => {
    const sections = groupCommands(catalog);
    expect(sections.map((s) => s.group)).toEqual([
      "Navigate",
      "Project",
      "Editor",
      "View",
    ]);
    expect(groupCommands([catalog[4]!]).map((s) => s.group)).toEqual([
      "Editor",
    ]);
  });
});

describe("nextIndex", () => {
  it("wraps in both directions", () => {
    expect(nextIndex(0, 3, -1)).toBe(2);
    expect(nextIndex(2, 3, 1)).toBe(0);
    expect(nextIndex(0, 3, 1)).toBe(1);
  });

  it("stays at zero for an empty list", () => {
    expect(nextIndex(0, 0, 1)).toBe(0);
  });
});
