import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isDriveRelativePath,
  isPathInside,
  isSameOrRelatedCanonicalPath,
  isSameOrRelatedPath,
  resolveCanonicalPath,
  validateAbsoluteCandidate,
} from "./path-safety.js";

const tempRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function tryDirLink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(
      target,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch {
    return false;
  }
}

describe("path safety", () => {
  it("detects ancestor and descendant relationships", () => {
    const parent = resolve(tmpdir(), "tl-path-parent");
    const child = join(parent, "child");
    const other = resolve(tmpdir(), "tl-path-other");
    expect(isPathInside(parent, child)).toBe(true);
    expect(isSameOrRelatedPath(parent, child)).toBe(true);
    expect(isSameOrRelatedPath(child, parent)).toBe(true);
    expect(isSameOrRelatedPath(parent, other)).toBe(false);
  });

  it("classifies Windows drive-relative forms", () => {
    expect(isDriveRelativePath("C:foo")).toBe(true);
    expect(isDriveRelativePath("D:bar\\baz")).toBe(true);
    expect(isDriveRelativePath("C:/foo")).toBe(false);
    expect(isDriveRelativePath("C:\\foo")).toBe(false);
    expect(isDriveRelativePath("foo/bar")).toBe(false);
  });

  it("rejects empty targets", () => {
    const live = resolve(tmpdir(), "tl-live-data");
    const result = validateAbsoluteCandidate("   ", live);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("empty_path");
  });

  it("rejects relative and drive-relative targets before resolve", () => {
    const live = resolve(tmpdir(), "tl-live-data");
    for (const target of [
      "foo/bar",
      "./rel",
      "relative\\path",
      "C:foo",
      "D:bar\\baz",
    ]) {
      const result = validateAbsoluteCandidate(target, live);
      expect(result.ok, target).toBe(false);
      if (!result.ok) expect(result.code).toBe("not_absolute");
    }
  });

  it("rejects live-related migration targets", () => {
    const live = resolve(tmpdir(), "tl-live-data");
    const related = validateAbsoluteCandidate(join(live, "nested"), live);
    expect(related.ok).toBe(false);
    if (!related.ok) expect(related.code).toBe("related_to_live");

    const self = validateAbsoluteCandidate(live, live);
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe("related_to_live");

    const ancestor = validateAbsoluteCandidate(dirname(live), live);
    expect(ancestor.ok).toBe(false);
    if (!ancestor.ok) expect(ancestor.code).toBe("related_to_live");

    const other = resolve(tmpdir(), "tl-unrelated-data");
    const ok = validateAbsoluteCandidate(other, live);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.path).toBe(other);
  });

  it("accepts a missing absolute target outside the live tree", async () => {
    const root = await makeTempRoot("tl-path-missing-");
    const live = join(root, "live");
    await mkdir(live);
    const missing = join(root, "new-data", "nested");
    const result = validateAbsoluteCandidate(missing, live);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(resolve(missing));
  });

  it("rejects a target symlink that resolves into the live directory", async () => {
    const root = await makeTempRoot("tl-path-symlink-target-");
    const live = join(root, "live");
    const outside = join(root, "outside");
    await mkdir(live);
    await mkdir(outside);
    const link = join(outside, "alias-live");
    if (!(await tryDirLink(live, link))) return;
    const result = validateAbsoluteCandidate(link, live);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("related_to_live");
  });

  it("rejects a missing nested path under a symlink to the live directory", async () => {
    const root = await makeTempRoot("tl-path-symlink-nested-");
    const live = join(root, "live");
    const outside = join(root, "outside");
    await mkdir(live);
    await mkdir(outside);
    const link = join(outside, "alias-live");
    if (!(await tryDirLink(live, link))) return;
    const result = validateAbsoluteCandidate(join(link, "child"), live);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("related_to_live");
  });

  it("rejects when live is presented via a symlink alias", async () => {
    const root = await makeTempRoot("tl-path-symlink-live-");
    const realLive = join(root, "real-live");
    await mkdir(realLive);
    const liveLink = join(root, "live-link");
    if (!(await tryDirLink(realLive, liveLink))) return;
    const result = validateAbsoluteCandidate(realLive, liveLink);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("related_to_live");
  });

  it("preserves a missing tail under the longest real ancestor", async () => {
    const root = await makeTempRoot("tl-path-canonical-");
    const existing = join(root, "exists");
    await mkdir(existing);
    const missing = join(existing, "nope", "yet");
    expect(resolveCanonicalPath(missing)).toBe(
      join(resolveCanonicalPath(existing), "nope", "yet"),
    );
  });

  it("detects symlink equivalence with canonical comparison", async () => {
    const root = await makeTempRoot("tl-path-canonical-rel-");
    const realDir = join(root, "real");
    await mkdir(realDir);
    const link = join(root, "link");
    if (!(await tryDirLink(realDir, link))) return;
    expect(isSameOrRelatedCanonicalPath(realDir, link)).toBe(true);
    expect(isSameOrRelatedPath(realDir, link)).toBe(false);
  });
});
