import type {
  ProjectSnapshotChangeSummary,
  ProjectSnapshotPreview,
  ProjectSnapshotRestoreResult,
} from "@translunar/contracts";
import type { MessageKey } from "./i18n/messages";

export interface SnapshotChangeItem {
  key: keyof ProjectSnapshotChangeSummary;
  label: string;
  value: number;
}

const SNAPSHOT_CHANGE_LABELS: ReadonlyArray<
  readonly [keyof ProjectSnapshotChangeSummary, MessageKey, string]
> = [
  ["documentsAdded", "snapshot.documentsAdded", "Documents added"],
  ["documentsRemoved", "snapshot.documentsRemoved", "Documents removed"],
  ["documentsChanged", "snapshot.documentsChanged", "Documents changed"],
  ["segmentsAdded", "snapshot.segmentsAdded", "Segments added"],
  ["segmentsRemoved", "snapshot.segmentsRemoved", "Segments removed"],
  ["segmentsChanged", "snapshot.segmentsChanged", "Segments changed"],
  ["commentsChanged", "snapshot.commentsChanged", "Comments changed"],
  ["reviewsChanged", "snapshot.reviewsChanged", "Reviews changed"],
  ["discussionsChanged", "snapshot.discussionsChanged", "Discussions changed"],
  ["mountsAdded", "snapshot.mountsAdded", "Mounts added"],
  ["mountsRemoved", "snapshot.mountsRemoved", "Mounts removed"],
  ["mountsChanged", "snapshot.mountsChanged", "Mounts changed"],
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
  format?: (start: number, end: number, total: number) => string,
): string {
  if (total === 0 || itemCount === 0) {
    return format ? format(0, 0, 0) : "0 of 0";
  }
  const start = offset + 1;
  const end = offset + itemCount;
  return format ? format(start, end, total) : `${start}-${end} of ${total}`;
}

export function snapshotChangeItems(
  summary: ProjectSnapshotChangeSummary,
  translate?: (key: MessageKey) => string,
): SnapshotChangeItem[] {
  return SNAPSHOT_CHANGE_LABELS.map(([key, labelKey, fallback]) => ({
    key,
    label: translate?.(labelKey) ?? fallback,
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
