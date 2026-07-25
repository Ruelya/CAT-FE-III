import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checksumTarget, DraftJournal } from "./draft-journal.js";

describe("draft journal", () => {
  it("atomically upserts, checksums, and clears drafts outside localStorage", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-draft-"));
    const journal = new DraftJournal(root);
    await journal.upsert({
      projectId: "p1",
      documentId: "d1",
      segmentId: "s1",
      expectedRevision: 3,
      targetText: "初稿",
    });
    const listed = await journal.list();
    expect(listed.records).toHaveLength(1);
    expect(listed.records[0]?.checksum).toBe(checksumTarget("初稿"));
    expect(listed.path.includes(".desktop")).toBe(true);
    const raw = await readFile(listed.path, "utf8");
    expect(raw).toContain("初稿");
    await journal.clear(["s1"]);
    expect((await journal.list()).records).toHaveLength(0);
  });

  it("rejects oversized target text", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-draft-big-"));
    const journal = new DraftJournal(root);
    await expect(
      journal.upsert({
        projectId: "p",
        documentId: "d",
        segmentId: "s",
        expectedRevision: 1,
        targetText: "x".repeat(200_001),
      }),
    ).rejects.toThrow(/size limit/i);
  });

  it("serializes concurrent upserts and clears without losing distinct drafts", async () => {
    const root = await mkdtemp(join(tmpdir(), "tl-draft-race-"));
    const journal = new DraftJournal(root);
    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        journal.upsert({
          projectId: "p1",
          documentId: "d1",
          segmentId: `s${index}`,
          expectedRevision: index + 1,
          targetText: `稿件-${index}`,
        }),
      ),
    );

    const listed = await journal.list();
    expect(listed.records).toHaveLength(24);
    expect(new Set(listed.records.map((item) => item.segmentId)).size).toBe(24);
    for (const record of listed.records) {
      expect(record.checksum).toBe(checksumTarget(record.targetText));
    }

    await Promise.all([
      journal.upsert({
        projectId: "p1",
        documentId: "d1",
        segmentId: "s0",
        expectedRevision: 99,
        targetText: "并发覆盖",
      }),
      journal.clear(["s1", "s2"]),
    ]);

    const after = await journal.list();
    expect(after.records.some((item) => item.segmentId === "s1")).toBe(false);
    expect(after.records.some((item) => item.segmentId === "s2")).toBe(false);
    const updated = after.records.find((item) => item.segmentId === "s0");
    expect(updated).toMatchObject({
      expectedRevision: 99,
      targetText: "并发覆盖",
      checksum: checksumTarget("并发覆盖"),
    });
  });
});
