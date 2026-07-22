import type { AiRunStatus, AlignmentManualLink } from "@translunar/contracts";

interface SelectableAlignmentLink {
  id: string;
  ordinal: number;
  sourceSegmentIds: readonly string[];
  targetSegmentIds: readonly string[];
}

export function orderedSelectedLinks<T extends SelectableAlignmentLink>(
  links: readonly T[],
  selectedIds: ReadonlySet<string>,
): T[] {
  return links
    .filter((link) => selectedIds.has(link.id))
    .sort((left, right) => left.ordinal - right.ordinal);
}

export function areLinksContiguous(
  links: readonly SelectableAlignmentLink[],
): boolean {
  return links.every((link, index) => {
    if (index === 0) return true;
    const previous = links[index - 1];
    return previous !== undefined && link.ordinal === previous.ordinal + 1;
  });
}

export function mergedAlignmentReplacement(
  links: readonly SelectableAlignmentLink[],
): AlignmentManualLink[] {
  if (links.length === 0) return [];
  return [
    {
      sourceSegmentIds: links.flatMap((link) => link.sourceSegmentIds),
      targetSegmentIds: links.flatMap((link) => link.targetSegmentIds),
    },
  ];
}

export function unlinkedAlignmentReplacement(
  link: SelectableAlignmentLink,
): AlignmentManualLink[] {
  return [
    {
      sourceSegmentIds: [...link.sourceSegmentIds],
      targetSegmentIds: [],
    },
    {
      sourceSegmentIds: [],
      targetSegmentIds: [...link.targetSegmentIds],
    },
  ].filter(
    (replacement) =>
      replacement.sourceSegmentIds.length > 0 ||
      replacement.targetSegmentIds.length > 0,
  );
}

export function splitAlignmentReplacement(
  link: SelectableAlignmentLink,
): AlignmentManualLink[] {
  const count = Math.max(
    link.sourceSegmentIds.length,
    link.targetSegmentIds.length,
  );
  return Array.from({ length: count }, (_, index) => ({
    sourceSegmentIds:
      link.sourceSegmentIds[index] === undefined
        ? []
        : [link.sourceSegmentIds[index]],
    targetSegmentIds:
      link.targetSegmentIds[index] === undefined
        ? []
        : [link.targetSegmentIds[index]],
  }));
}

export function formatCorpusProvenance(value: unknown): string {
  if (value === null || value === undefined) return "No additional provenance";
  if (typeof value === "string") return value || "No additional provenance";
  try {
    return JSON.stringify(value) || "No additional provenance";
  } catch {
    return "Provenance is unavailable";
  }
}

export function isTerminalAiRunStatus(status: AiRunStatus): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "interrupted" ||
    status === "canceled"
  );
}
