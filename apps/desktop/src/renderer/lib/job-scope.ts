export type JobScope = "file" | "job";

/** A one-file job has no useful "all files" distinction. */
export function defaultJobScope(documentCount: number): JobScope {
  return documentCount > 1 ? "job" : "file";
}

/** Engine QA list/run take an optional documentId; omit it for the whole job. */
export function qaDocumentFilter(
  scope: JobScope,
  documentId: string,
): string | undefined {
  return scope === "file" ? documentId : undefined;
}

export function documentsForScope<T extends { id: string }>(
  scope: JobScope,
  documents: readonly T[],
  active: T,
): readonly T[] {
  if (scope === "file" || documents.length <= 1) return [active];
  return documents;
}
