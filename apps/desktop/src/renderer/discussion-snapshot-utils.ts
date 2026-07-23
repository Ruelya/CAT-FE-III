import type {
  ProjectSnapshotChangeSummary,
  ProjectSnapshotPreview,
  ProjectSnapshotRestoreResult,
} from "@translunar/contracts";

export interface SnapshotChangeItem {
  key: keyof ProjectSnapshotChangeSummary;
  label: string;
  value: number;
}

const SNAPSHOT_CHANGE_LABELS: ReadonlyArray<
  readonly [keyof ProjectSnapshotChangeSummary, string]
> = [
  ["documentsAdded", "Documents added"],
  ["documentsRemoved", "Documents removed"],
  ["documentsChanged", "Documents changed"],
  ["segmentsAdded", "Segments added"],
  ["segmentsRemoved", "Segments removed"],
  ["segmentsChanged", "Segments changed"],
  ["commentsChanged", "Comments changed"],
  ["reviewsChanged", "Reviews changed"],
  ["discussionsChanged", "Discussions changed"],
  ["mountsAdded", "Mounts added"],
  ["mountsRemoved", "Mounts removed"],
  ["mountsChanged", "Mounts changed"],
];

export function previousPageOffset(offset: number, limit: number): number {
  return Math.max(0, offset - limit);
}

export function nextPageOffset(
  offset: number,
  limit: number,
  total: number,
): number {
  return offset + limit < total ? offset + limit : offset;
}

export function lastPageOffset(total: number, limit: number): number {
  return total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
}

export function pageRangeLabel(
  offset: number,
  itemCount: number,
  total: number,
): string {
  if (total === 0 || itemCount === 0) return "0 of 0";
  return `${offset + 1}-${offset + itemCount} of ${total}`;
}

export function snapshotChangeItems(
  summary: ProjectSnapshotChangeSummary,
): SnapshotChangeItem[] {
  return SNAPSHOT_CHANGE_LABELS.map(([key, label]) => ({
    key,
    label,
    value: summary[key] as number,
  }));
}

export function canRestoreSnapshot(
  preview: ProjectSnapshotPreview | null,
): boolean {
  return (
    preview?.status === "open" && preview.missingDependencyIds.length === 0
  );
}

export function applySnapshotRestoreResult(
  preview: ProjectSnapshotPreview,
  result: ProjectSnapshotRestoreResult,
): ProjectSnapshotPreview {
  return {
    ...preview,
    currentProjectRevision: result.projectRevision,
    status: result.status,
    summary: result.summary,
  };
}
