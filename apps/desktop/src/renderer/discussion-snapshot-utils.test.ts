import type {
  ProjectSnapshotChangeSummary,
  ProjectSnapshotPreview,
  ProjectSnapshotRestoreResult,
} from "@translunar/contracts";
import { describe, expect, it } from "vitest";

import {
  applySnapshotRestoreResult,
  canRestoreSnapshot,
  lastPageOffset,
  nextPageOffset,
  pageRangeLabel,
  previousPageOffset,
  snapshotChangeItems,
} from "./discussion-snapshot-utils";

const summary: ProjectSnapshotChangeSummary = {
  documentsAdded: 1,
  documentsRemoved: 2,
  documentsChanged: 3,
  segmentsAdded: 4,
  segmentsRemoved: 5,
  segmentsChanged: 6,
  commentsChanged: 7,
  reviewsChanged: 8,
  discussionsChanged: 9,
  mountsAdded: 10,
  mountsRemoved: 11,
  mountsChanged: 12,
};

const preview: ProjectSnapshotPreview = {
  previewId: "preview-1",
  snapshotId: "snapshot-1",
  projectId: "project-1",
  expectedProjectRevision: 4,
  currentProjectRevision: 4,
  currentStateHash: "current-state",
  status: "open",
  summary,
  missingDependencyIds: [],
};

describe("discussion and snapshot pagination", () => {
  it("keeps page offsets bounded and reports the visible range", () => {
    expect(previousPageOffset(20, 20)).toBe(0);
    expect(previousPageOffset(0, 20)).toBe(0);
    expect(nextPageOffset(0, 20, 41)).toBe(20);
    expect(nextPageOffset(40, 20, 41)).toBe(40);
    expect(lastPageOffset(41, 20)).toBe(40);
    expect(pageRangeLabel(20, 20, 41)).toBe("21-40 of 41");
    expect(pageRangeLabel(0, 0, 0)).toBe("0 of 0");
  });
});

describe("snapshot restore state", () => {
  it("requires an open preview with every dependency available", () => {
    expect(canRestoreSnapshot(preview)).toBe(true);
    expect(
      canRestoreSnapshot({
        ...preview,
        missingDependencyIds: ["tm-library-missing"],
      }),
    ).toBe(false);
    expect(canRestoreSnapshot({ ...preview, status: "applied" })).toBe(false);
  });

  it("uses the authoritative restore revision, status, and summary", () => {
    const result: ProjectSnapshotRestoreResult = {
      previewId: preview.previewId,
      snapshotId: preview.snapshotId,
      status: "applied",
      projectRevision: 5,
      summary: { ...summary, segmentsChanged: 13 },
      operationId: "operation-1",
    };

    expect(applySnapshotRestoreResult(preview, result)).toEqual({
      ...preview,
      currentProjectRevision: 5,
      status: "applied",
      summary: result.summary,
    });
  });

  it("keeps every Engine summary field in a stable display order", () => {
    const items = snapshotChangeItems(summary);
    expect(items).toHaveLength(12);
    expect(items[0]).toEqual({
      key: "documentsAdded",
      label: "Documents added",
      value: 1,
    });
    expect(items.at(-1)).toEqual({
      key: "mountsChanged",
      label: "Mounts changed",
      value: 12,
    });
  });
});
