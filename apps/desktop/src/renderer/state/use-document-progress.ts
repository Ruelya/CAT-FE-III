import { useEffect, useState } from "react";
import type { Document, SegmentCounts } from "@translunar/contracts";

import { invokeEngine } from "../lib/rpc";

export type DocumentProgressMap = Readonly<Record<string, SegmentCounts>>;

async function countsForDocument(documentId: string): Promise<SegmentCounts> {
  const [all, confirmed, draft] = await Promise.all([
    invokeEngine("segment.editor.list", {
      documentId,
      offset: 0,
      limit: 1,
      filter: "all",
    }),
    invokeEngine("segment.editor.list", {
      documentId,
      offset: 0,
      limit: 1,
      filter: "confirmed",
    }),
    invokeEngine("segment.editor.list", {
      documentId,
      offset: 0,
      limit: 1,
      filter: "draft",
    }),
  ]);
  const total = all.total;
  const confirmedCount = confirmed.total;
  const draftCount = draft.total;
  return {
    total,
    confirmed: confirmedCount,
    draft: draftCount,
    untranslated: Math.max(0, total - confirmedCount - draftCount),
    openIssues: 0,
  };
}

/**
 * Per-file confirmation counts for the job rail.
 *
 * The active document already has live counts on the session; the others are
 * fetched with filtered editor lists so we do not pull every row just to draw
 * a progress chip.
 */
export function useDocumentProgress(
  documents: readonly Document[],
  activeDocumentId: string,
  activeCounts: SegmentCounts | null,
): DocumentProgressMap {
  const [map, setMap] = useState<DocumentProgressMap>({});

  useEffect(() => {
    let cancelled = false;
    const next: Record<string, SegmentCounts> = {};
    if (activeCounts) next[activeDocumentId] = activeCounts;

    const others = documents.filter((doc) => doc.id !== activeDocumentId);
    void Promise.all(
      others.map(async (doc) => {
        try {
          next[doc.id] = await countsForDocument(doc.id);
        } catch {
          next[doc.id] = {
            total: doc.segmentCount,
            confirmed: 0,
            draft: 0,
            untranslated: doc.segmentCount,
            openIssues: 0,
          };
        }
      }),
    ).then(() => {
      if (!cancelled) setMap({ ...next });
    });

    return () => {
      cancelled = true;
    };
  }, [documents, activeDocumentId, activeCounts]);

  return map;
}
