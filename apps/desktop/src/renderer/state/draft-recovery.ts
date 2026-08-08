import type { Segment, SegmentEditorRow } from "@translunar/contracts";

import type {
  DraftJournalRecord,
  DraftJournalSnapshot,
} from "../../shared/product-shell";

import type { SessionIdentity } from "./session";

export type DraftClassification =
  | { kind: "empty" }
  | {
      kind: "recoverable";
      records: DraftJournalRecord[];
      session: SessionIdentity;
      staleRecords: DraftJournalRecord[];
    }
  | { kind: "stale"; records: DraftJournalRecord[]; reason: string };

export interface SegmentRevisionProbe {
  id: string;
  revision: number;
  documentId: string;
}

/**
 * Classify draft journal against a candidate or validated session.
 * When segment probes are provided, every record must reference an existing
 * segment in the document whose Engine revision still matches the journaled
 * expectedRevision — never force-accept by rewriting to the current revision.
 */
export function classifyDraftJournal(
  snapshot: DraftJournalSnapshot | null | undefined,
  candidateSession: SessionIdentity | null,
  segmentProbes?: readonly SegmentRevisionProbe[] | null,
): DraftClassification {
  const records = snapshot?.records ?? [];
  if (records.length === 0) return { kind: "empty" };

  const projectId = records[0]!.projectId;
  const documentId = records[0]!.documentId;
  const consistent = records.every(
    (r) => r.projectId === projectId && r.documentId === documentId,
  );
  if (!consistent) {
    return {
      kind: "stale",
      records: [...records],
      reason: "Draft journal spans multiple documents.",
    };
  }

  if (
    !projectId ||
    !documentId ||
    records.some((r) => !r.segmentId || r.targetText === undefined)
  ) {
    return {
      kind: "stale",
      records: [...records],
      reason: "Draft journal is incomplete.",
    };
  }

  // Prefer journal identity; optional candidate must match when present.
  if (
    candidateSession &&
    (candidateSession.projectId !== projectId ||
      candidateSession.documentId !== documentId)
  ) {
    return {
      kind: "stale",
      records: [...records],
      reason: "Draft journal does not match stored session.",
    };
  }

  if (segmentProbes) {
    const byId = new Map(segmentProbes.map((s) => [s.id, s]));
    const valid: DraftJournalRecord[] = [];
    const staleRecords: DraftJournalRecord[] = [];
    for (const record of records) {
      const probe = byId.get(record.segmentId);
      if (!probe || probe.documentId !== documentId) {
        staleRecords.push(record);
        continue;
      }
      // Safe only when the journaled expectedRevision still matches Engine.
      if (probe.revision !== record.expectedRevision) {
        staleRecords.push(record);
        continue;
      }
      valid.push(record);
    }

    if (valid.length === 0) {
      return {
        kind: "stale",
        records: [...records],
        reason:
          staleRecords.length === records.length
            ? "Draft journal no longer matches Engine segment revisions."
            : "Draft journal references missing segments.",
      };
    }

    return {
      kind: "recoverable",
      records: valid,
      staleRecords,
      session: {
        version: 1,
        projectId,
        documentId,
      },
    };
  }

  return {
    kind: "recoverable",
    records: [...records],
    staleRecords: [],
    session: {
      version: 1,
      projectId,
      documentId,
    },
  };
}

export function probesFromRows(
  rows: readonly SegmentEditorRow[],
): SegmentRevisionProbe[] {
  return rows.map((row) => ({
    id: row.segment.id,
    revision: row.segment.revision,
    documentId: row.segment.documentId,
  }));
}

export function probesFromSegments(
  segments: readonly Segment[],
): SegmentRevisionProbe[] {
  return segments.map((segment) => ({
    id: segment.id,
    revision: segment.revision,
    documentId: segment.documentId,
  }));
}

export function draftForSegment(
  records: readonly DraftJournalRecord[],
  segmentId: string,
): DraftJournalRecord | undefined {
  return records.find((r) => r.segmentId === segmentId);
}
