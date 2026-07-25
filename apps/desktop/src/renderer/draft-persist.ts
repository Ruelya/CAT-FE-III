/** Helpers for the durable desktop draft journal (main-process owned). */

export async function writeSegmentDraft(input: {
  projectId: string;
  documentId: string;
  segmentId: string;
  expectedRevision: number;
  targetText: string;
}): Promise<void> {
  await window.translunar.writeDraftJournal(input);
}

export async function clearSegmentDrafts(segmentIds: string[]): Promise<void> {
  await window.translunar.clearDraftJournal(segmentIds);
}
