import type { QaCategory, QaProfile, QaSeverity } from "@translunar/contracts";
import { PencilLine } from "lucide-react";

import { ActiveAxis } from "../workbench/ActiveAxis";
import { LiveMatrix } from "./LiveMatrix";
import type { MatrixCellState } from "./qa-presenters";

export interface QaSeverityCounts {
  error: number;
  warning: number;
  info: number;
  waived: number;
}

export interface QaDistributionColumnProps {
  cells: readonly MatrixCellState[];
  counts: QaSeverityCounts;
  severityFilter: "all" | QaSeverity;
  categoryFilter: "all" | QaCategory;
  scope: "document" | "project";
  categories: readonly QaCategory[];
  profiles: readonly QaProfile[];
  profileId: string;
  selectedOrdinal: number | null;
  matrixTitle: string;
  matrixCaption: string;
  matrixAria: string;
  legend: {
    none: string;
    warn: string;
    error: string;
    waived: string;
  };
  labels: {
    distribution: string;
    errors: string;
    warnings: string;
    info: string;
    waived: string;
    scope: string;
    documentScope: string;
    projectScope: string;
    category: string;
    all: string;
    profile: string;
    editProfile: string;
    builtIn: string;
  };
  dispositionFilter: "all" | "open" | "waived" | "resolved";
  onSeverityFilter(value: "all" | QaSeverity): void;
  onDispositionFilter(value: "all" | "open" | "waived" | "resolved"): void;
  onCategoryFilter(value: "all" | QaCategory): void;
  onScope(value: "document" | "project"): void;
  onProfileId(id: string): void;
  onSelectOrdinal(ordinal: number): void;
  onEditProfile(): void;
}

export function QaDistributionColumn({
  cells,
  counts,
  severityFilter,
  categoryFilter,
  scope,
  categories,
  profiles,
  profileId,
  selectedOrdinal,
  matrixTitle,
  matrixCaption,
  matrixAria,
  legend,
  dispositionFilter,
  labels,
  onSeverityFilter,
  onDispositionFilter,
  onCategoryFilter,
  onScope,
  onProfileId,
  onSelectOrdinal,
  onEditProfile,
}: QaDistributionColumnProps) {
  const chips: { key: QaSeverity; label: string; count: number }[] = [
    { key: "error", label: labels.errors, count: counts.error },
    { key: "warning", label: labels.warnings, count: counts.warning },
    { key: "info", label: labels.info, count: counts.info },
  ];
  const waivedSelected = dispositionFilter === "waived";

  return (
    <aside className="qa-ortho__dist" aria-label={labels.distribution}>
      <LiveMatrix
        title={matrixTitle}
        cells={cells}
        caption={matrixCaption}
        ariaLabel={matrixAria}
        selectedOrdinal={selectedOrdinal}
        onSelectOrdinal={onSelectOrdinal}
        legend={[
          { state: "none", label: legend.none },
          { state: "warn", label: legend.warn },
          { state: "error", label: legend.error },
          { state: "waived", label: legend.waived },
        ]}
      />

      <div
        className="qa-ortho__sev-chips"
        role="group"
        aria-label={labels.errors}
      >
        {chips.map((chip) => {
          const isSelected = severityFilter === chip.key && !waivedSelected;
          return (
            <button
              key={chip.key}
              type="button"
              className="qa-ortho__sev-chip"
              data-severity={chip.key}
              aria-pressed={isSelected}
              onClick={() => {
                onDispositionFilter("open");
                onSeverityFilter(isSelected ? "all" : chip.key);
              }}
            >
              <span>{chip.label}</span>
              <strong className="num">{chip.count}</strong>
              {isSelected ? <ActiveAxis variant="chip" /> : null}
            </button>
          );
        })}
        <button
          type="button"
          className="qa-ortho__sev-chip"
          data-severity="waived"
          aria-pressed={waivedSelected}
          onClick={() => {
            if (waivedSelected) {
              onDispositionFilter("open");
            } else {
              onSeverityFilter("all");
              onDispositionFilter("waived");
            }
          }}
        >
          <span>{labels.waived}</span>
          <strong className="num">{counts.waived}</strong>
          {waivedSelected ? <ActiveAxis variant="chip" /> : null}
        </button>
      </div>

      <label className="qa-ortho__field">
        <span>{labels.scope}</span>
        <div className="qa-ortho__segmented">
          <button
            type="button"
            aria-pressed={scope === "document"}
            onClick={() => onScope("document")}
          >
            {labels.documentScope}
          </button>
          <button
            type="button"
            aria-pressed={scope === "project"}
            onClick={() => onScope("project")}
          >
            {labels.projectScope}
          </button>
        </div>
      </label>

      <label className="qa-ortho__field">
        <span>{labels.category}</span>
        <select
          value={categoryFilter}
          onChange={(event) =>
            onCategoryFilter(event.currentTarget.value as "all" | QaCategory)
          }
        >
          <option value="all">{labels.all}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>

      <label className="qa-ortho__field">
        <span>{labels.profile}</span>
        <select
          value={profileId}
          onChange={(event) => onProfileId(event.currentTarget.value)}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
              {profile.builtIn ? ` · ${labels.builtIn}` : ""}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="button secondary qa-ortho__profile-link"
        onClick={onEditProfile}
        disabled={!profiles.some((item) => item.id === profileId)}
      >
        <PencilLine size={14} aria-hidden="true" />
        {labels.editProfile}
      </button>
    </aside>
  );
}
