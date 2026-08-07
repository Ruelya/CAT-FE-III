import type { ReactNode } from "react";
import type { OptionalCountMetric } from "@translunar/contracts";
import { ShieldAlert } from "lucide-react";

import type { FormatVars, MessageKey } from "../../../i18n/messages";

export function SectionHeading({
  eyebrow,
  title,
  icon,
  actions,
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="insights-section-heading">
      <div>
        <span className="surface-kicker">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {actions ? (
        <div className="insights-section-actions">{actions}</div>
      ) : (
        icon
      )}
    </header>
  );
}

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="insights-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Definition({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function UnavailableState({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact ? "insights-unavailable compact" : "insights-unavailable"
      }
    >
      <ShieldAlert size={compact ? 16 : 22} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function OptionalReason({ metrics }: { metrics: OptionalCountMetric[] }) {
  const reason = metrics.find((metric) => !metric.available)?.reason;
  return reason ? <p className="insights-unavailable-note">{reason}</p> : null;
}

export function formatBasisPoints(
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
  t: (key: MessageKey, vars?: FormatVars) => string,
): string {
  return t("insights.percent", {
    value: formatNumber(value / 100, {
      maximumFractionDigits: value % 100 === 0 ? 0 : 1,
    }),
  });
}

export function formatOptionalMetric(
  metric: OptionalCountMetric,
  fallback: string,
  formatter: (value: number) => string,
): string {
  return metric.available && metric.value !== null && metric.value !== undefined
    ? formatter(metric.value)
    : fallback;
}

export function formatDuration(
  value: number,
  t: (key: MessageKey, vars?: FormatVars) => string,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  if (value < 60_000) {
    return t("insights.durationSeconds", {
      value: formatNumber(Math.round(value / 1000)),
    });
  }
  if (value < 3_600_000) {
    return t("insights.durationMinutes", {
      value: formatNumber(Math.round(value / 60_000)),
    });
  }
  return t("insights.durationHours", {
    value: formatNumber(value / 3_600_000, {
      maximumFractionDigits: 1,
    }),
  });
}

export function formatMilli(
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  return formatNumber(value / 1000, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatShortDate(
  value: number,
  formatDate: (
    value: Date | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string,
): string {
  return formatDate(value, {
    month: "short",
    day: "numeric",
  });
}

export function safeArchiveName(value: string): string {
  return value.trim().replaceAll(/[\\/:*?"<>|]/gu, "-") || "project";
}
