import type {
  AssetCatalogItem,
  AssetDiagnostic,
  TmLibrary,
  TmLibraryMount,
  Termbase,
  TermbaseMount,
} from "@translunar/contracts";

export function joinLibraryMount(
  library: TmLibrary,
  mounts: readonly TmLibraryMount[],
): TmLibraryMount | null {
  return mounts.find((m) => m.libraryId === library.id) ?? null;
}

export function joinTermbaseMount(
  termbase: Termbase,
  mounts: readonly TermbaseMount[],
): TermbaseMount | null {
  return mounts.find((m) => m.termbaseId === termbase.id) ?? null;
}

/** Format quality score basis points as percent when non-null. */
export function formatBasisPoints(
  basisPoints: number | null | undefined,
): string {
  if (basisPoints === null || basisPoints === undefined) return "—";
  return `${(basisPoints / 100).toFixed(1)}%`;
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "—";
  if (!Number.isFinite(score)) return "—";
  return score.toFixed(3);
}

export function formatTimestamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export function formatDiagnostics(
  diagnostics: readonly AssetDiagnostic[] | null | undefined,
): string {
  if (!diagnostics || diagnostics.length === 0) return "";
  return diagnostics.map((d) => `R${d.row}: ${d.message}`).join("; ");
}

export function catalogSectionJump(
  item: AssetCatalogItem,
): "tm" | "termbase" | "corpus" | null {
  if (item.kind === "tm") return "tm";
  if (item.kind === "termbase") return "termbase";
  if (item.kind === "corpus") return "corpus";
  return null;
}

export function pageLabel(
  offset: number,
  limit: number,
  total: number,
): string {
  if (total <= 0) return "0";
  const start = offset + 1;
  const end = Math.min(offset + limit, total);
  return `${start}–${end} / ${total}`;
}

export const DEFAULT_CURATION_POLICY = {
  maximumLengthRatioPercent: 300,
  minimumChars: 1,
  minimumLengthRatioPercent: 20,
  minimumTermFrequency: 2,
  nearDuplicateThreshold: 0.9,
  quarantineThresholdBasisPoints: 4000,
  semanticAlignmentThresholdBasisPoints: 5000,
  createdAfterMs: null as number | null,
  createdBeforeMs: null as number | null,
};

export const DEFAULT_ALIGNMENT_OPTIONS = {
  bandWidth: 5,
  maxEvidenceValues: 8,
  maxGroupSize: 4,
  maxSegmentsPerSide: 4,
  maxTagsPerSegment: 32,
  maxTotalInputChars: 200_000,
  maxWorkUnits: 50_000,
};
