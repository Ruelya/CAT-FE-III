import type {
  CurationEvidence,
  CurationFinding,
  CurationFindingKind,
  CurationPolicy,
  CurationRunStatus,
  CurationSeverity,
} from "@translunar/contracts";
import type { MessageKey } from "./i18n/messages";

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

export const CURATION_CATALOG_PAGE_LIMIT = 25;
export const CURATION_FINDING_PAGE_LIMIT = 25;
export const CURATION_RUN_PAGE_LIMIT = 25;

export const DEFAULT_CURATION_POLICY: CurationPolicy = {
  minimumChars: 2,
  minimumLengthRatioPercent: 20,
  maximumLengthRatioPercent: 500,
  nearDuplicateThreshold: 80,
  semanticAlignmentThresholdBasisPoints: 3500,
  quarantineThresholdBasisPoints: 5000,
  minimumTermFrequency: 2,
  createdAfterMs: null,
  createdBeforeMs: null,
};

const FINDING_KIND_LABELS: Record<CurationFindingKind, string> = {
  exactDuplicate: "Exact duplicate",
  nearDuplicate: "Near duplicate",
  competingTranslation: "Competing translation",
  sourceEqualsTarget: "Source equals target",
  minimumLength: "Minimum length",
  lengthRatio: "Length ratio",
  numberMismatch: "Number mismatch",
  dateMismatch: "Date mismatch",
  placeholderMismatch: "Placeholder mismatch",
  createdOutsideRange: "Created outside range",
  likelyWrongLanguage: "Likely wrong language",
  semanticMismatch: "Semantic mismatch",
};

const SEVERITY_LABELS: Record<CurationSeverity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

const FINDING_KIND_KEYS: Record<CurationFindingKind, MessageKey> = {
  exactDuplicate: "curation.findingExactDuplicate",
  nearDuplicate: "curation.findingNearDuplicate",
  competingTranslation: "curation.findingCompetingTranslation",
  sourceEqualsTarget: "curation.findingSourceEqualsTarget",
  minimumLength: "curation.findingMinimumLength",
  lengthRatio: "curation.findingLengthRatio",
  numberMismatch: "curation.findingNumberMismatch",
  dateMismatch: "curation.findingDateMismatch",
  placeholderMismatch: "curation.findingPlaceholderMismatch",
  createdOutsideRange: "curation.findingCreatedOutsideRange",
  likelyWrongLanguage: "curation.findingLikelyWrongLanguage",
  semanticMismatch: "curation.findingSemanticMismatch",
};

const SEVERITY_KEYS: Record<CurationSeverity, MessageKey> = {
  error: "curation.severityError",
  warning: "curation.severityWarning",
  info: "curation.severityInfo",
};

export function findingKindLabel(
  kind: CurationFindingKind,
  translate?: Translate,
): string {
  return translate?.(FINDING_KIND_KEYS[kind]) ?? FINDING_KIND_LABELS[kind];
}

export function severityLabel(
  severity: CurationSeverity,
  translate?: Translate,
): string {
  return translate?.(SEVERITY_KEYS[severity]) ?? SEVERITY_LABELS[severity];
}

export function recommendationLabel(
  disposition: CurationFinding["disposition"],
  translate?: Translate,
): string {
  switch (disposition) {
    case "keep":
      return translate?.("curation.dispositionKeep") ?? "Keep";
    case "review":
      return translate?.("curation.dispositionReview") ?? "Review";
    case "quarantine":
      return translate?.("curation.dispositionQuarantine") ?? "Quarantine";
  }
}

export function formatBasisPoints(
  value: number | null | undefined,
  formatNumber?: (value: number, options?: Intl.NumberFormatOptions) => string,
  translate?: Translate,
): string {
  if (value === null || value === undefined) {
    return translate?.("curation.scoreNotAvailable") ?? "Not scored";
  }
  const formatted = formatNumber
    ? formatNumber(value / 100, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      })
    : (value / 100).toFixed(1);
  return `${formatted}%`;
}

export function formatEvidence(
  evidence: CurationEvidence,
  translate?: Translate,
): string[] {
  const values: string[] = [];
  for (const value of evidence.sourceValues ?? []) {
    values.push(
      translate?.("curation.evidenceSource", {
        value: boundedEvidence(value),
      }) ?? `Source: ${boundedEvidence(value)}`,
    );
  }
  for (const value of evidence.targetValues ?? []) {
    values.push(
      translate?.("curation.evidenceTarget", {
        value: boundedEvidence(value),
      }) ?? `Target: ${boundedEvidence(value)}`,
    );
  }
  for (const value of evidence.relatedUnitIds ?? []) {
    values.push(
      translate?.("curation.evidenceRelatedUnit", {
        value: boundedEvidence(value),
      }) ?? `Related unit: ${boundedEvidence(value)}`,
    );
  }
  for (const [key, value] of Object.entries(evidence.metrics ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    values.push(`${key}: ${value}`);
  }
  return values.length > 0
    ? values.slice(0, 8)
    : [
        translate?.("curation.noAdditionalEvidence") ??
          "No additional evidence",
      ];
}

export function findingIsSelectable(
  finding: CurationFinding,
  status: CurationRunStatus | null,
): boolean {
  return status === "open" && finding.disposition === "quarantine";
}

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

export function dateInputToMs(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const timestamp = Date.parse(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`,
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function msToDateInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function engineErrorCode(reason: unknown): string | null {
  if (!reason || typeof reason !== "object") return null;
  const code = (reason as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isRevisionConflict(reason: unknown): boolean {
  return engineErrorCode(reason) === "conflict";
}

function boundedEvidence(value: string): string {
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  return normalized.length > 180
    ? `${normalized.slice(0, 177)}...`
    : normalized || "(empty)";
}
