import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { useLocale } from "../../i18n/LocaleProvider";
import { ActiveAxis } from "./ActiveAxis";

/** Status chips owned by the rail (tagged/commented stay secondary). */
export type RailStatusFilter =
  | "all"
  | "untranslated"
  | "draft"
  | "confirmed"
  | "issues";

/** Design vocabulary; only `all` is a live projection in Phase 2. */
export type MatchBucket =
  | "all"
  | "101"
  | "100"
  | "95-99"
  | "85-94"
  | "75-84"
  | "50-74"
  | "none"
  | "mt";

export const MATCH_BUCKET_OPTIONS: readonly {
  value: MatchBucket;
  label: string;
  live: boolean;
}[] = [
  { value: "all", label: "All", live: true },
  { value: "101", label: "101%", live: false },
  { value: "100", label: "100%", live: false },
  { value: "95-99", label: "95–99%", live: false },
  { value: "85-94", label: "85–94%", live: false },
  { value: "75-84", label: "75–84%", live: false },
  { value: "50-74", label: "50–74%", live: false },
  { value: "none", label: "No match", live: false },
  { value: "mt", label: "MT-only", live: false },
] as const;

export interface FilterRailCounts {
  total: number;
  untranslated: number;
  draft: number;
  confirmed: number;
  openIssues: number;
}

export interface FilterRailProps {
  counts: FilterRailCounts;
  filter: RailStatusFilter | string;
  onFilterChange(value: RailStatusFilter): void;
  /** Presentation-only; non-`all` values must not drive Engine filters. */
  matchBucket: MatchBucket;
  onMatchBucketChange(value: MatchBucket): void;
  issuePosition: number;
  issueTotal: number;
  onNavigateIssue(direction: -1 | 1): void;
  /** When true, render ActiveAxis under the selected status chip. */
  showChipAxis?: boolean;
  compact?: boolean;
  /** Optional trailing slot (e.g. tagged/commented secondary select). */
  secondaryFilters?: ReactNode;
}

/**
 * Three-group filter rail: status chips · match selector · issue navigation.
 * Search / Exact TM / command strip / Confirm are intentionally absent.
 */
export function FilterRail({
  counts,
  filter,
  onFilterChange,
  matchBucket,
  onMatchBucketChange,
  issuePosition,
  issueTotal,
  onNavigateIssue,
  showChipAxis = false,
  compact = false,
  secondaryFilters,
}: FilterRailProps) {
  const { t } = useLocale();
  const issuesDisabled = issueTotal === 0;

  const chips: readonly {
    value: RailStatusFilter;
    label: string;
    count: number;
  }[] = [
    {
      value: "all",
      label: t("workbench.filterAll"),
      count: counts.total,
    },
    {
      value: "untranslated",
      label: t("workbench.filterUntranslated"),
      count: counts.untranslated,
    },
    {
      value: "draft",
      label: t("workbench.filterDraft"),
      count: counts.draft,
    },
    {
      value: "confirmed",
      label: t("workbench.filterConfirmed"),
      count: counts.confirmed,
    },
    {
      value: "issues",
      label: t("workbench.filterIssues"),
      count: counts.openIssues,
    },
  ];

  return (
    <div
      className={compact ? "filter editor-toolbar is-compact" : "filter editor-toolbar"}
      data-compact={compact ? "true" : "false"}
    >
      {compact ? (
        <div
          className="filter-group filter-group--compact"
          data-toolbar-item="filters"
        >
          <label className="filter-compact">
            <span className="visually-hidden">
              {t("workbench.segmentFilters")}
            </span>
            <select
              value={isRailStatus(filter) ? filter : "all"}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (isRailStatus(next)) onFilterChange(next);
              }}
              aria-label={t("workbench.segmentFilters")}
            >
              {chips.map((chip) => (
                <option key={chip.value} value={chip.value}>
                  {chip.label} ({chip.count})
                </option>
              ))}
            </select>
          </label>
          {secondaryFilters}
        </div>
      ) : (
        <div
          className="filter-group"
          role="group"
          aria-label={t("workbench.segmentFilters")}
          data-toolbar-item="filters"
        >
          {chips.map((chip) => {
            const selected = filter === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                className="chip filter-button"
                data-selected={selected || undefined}
                aria-pressed={selected}
                onClick={() => onFilterChange(chip.value)}
              >
                {chip.label}
                <span className="chip__count count">{chip.count}</span>
                {selected && showChipAxis ? <ActiveAxis variant="chip" /> : null}
              </button>
            );
          })}
          {secondaryFilters}
        </div>
      )}

      <span className="filter__div" aria-hidden="true" />

      <label className="filter-match" data-toolbar-item="match">
        <span className="visually-hidden">{t("workbench.matchFilter")}</span>
        <select
          className="select field filter-match__select"
          value={matchBucket}
          aria-label={t("workbench.matchFilter")}
          onChange={(event) => {
            const next = event.currentTarget.value as MatchBucket;
            // Non-live buckets stay presentation-only: accept selection for
            // vocabulary continuity but never claim an Engine match filter.
            onMatchBucketChange(next);
          }}
        >
          {MATCH_BUCKET_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={!option.live}
              title={
                option.live ? undefined : t("workbench.matchFilterDeferred")
              }
            >
              {option.live
                ? `${t("workbench.matchFilter")} · ${option.label}`
                : `${option.label} · ${t("workbench.matchFilterDeferred")}`}
            </option>
          ))}
        </select>
      </label>

      <span className="filter__div" aria-hidden="true" />

      <div
        className="issuenav issue-nav"
        aria-label={t("workbench.issueNav")}
        data-toolbar-item="issues"
      >
        <button
          type="button"
          className="issuenav__btn icon-button"
          onClick={() => onNavigateIssue(-1)}
          disabled={issuesDisabled}
          title={t("workbench.prevIssue")}
          aria-label={t("workbench.prevIssue")}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <span className="issue-position num">
          {issuesDisabled
            ? t("workbench.noOpenQaState")
            : t("common.positionOf", {
                position: issuePosition,
                total: issueTotal,
              })}
        </span>
        <button
          type="button"
          className="issuenav__btn icon-button"
          onClick={() => onNavigateIssue(1)}
          disabled={issuesDisabled}
          title={t("workbench.nextIssue")}
          aria-label={t("workbench.nextIssue")}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function isRailStatus(value: string): value is RailStatusFilter {
  return (
    value === "all" ||
    value === "untranslated" ||
    value === "draft" ||
    value === "confirmed" ||
    value === "issues"
  );
}
