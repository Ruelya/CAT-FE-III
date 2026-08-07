import type { QaGateResult } from "@translunar/contracts";
import { AlertTriangle, Check, X } from "lucide-react";

export interface ExportGateChecklistProps {
  gate: QaGateResult | null;
  labels: {
    title: string;
    blockingErrors: string;
    warnings: string;
    checkedSegments: string;
    mustFix: string;
    optional: string;
    profile: string;
  };
}

export function ExportGateChecklist({
  gate,
  labels,
}: ExportGateChecklistProps) {
  const errorCount = gate?.errorCount ?? 0;
  const warningCount = gate?.warningCount ?? 0;
  const checked = gate?.run.checkedSegments ?? null;
  const clear = gate?.clear ?? false;

  const rows: {
    key: string;
    icon: "ok" | "err" | "warn";
    name: string;
    value: string;
    verdict: string;
  }[] = [
    {
      key: "errors",
      icon: errorCount > 0 ? "err" : "ok",
      name: labels.blockingErrors,
      value: String(errorCount),
      verdict: errorCount > 0 ? labels.mustFix : labels.optional,
    },
    {
      key: "warnings",
      icon: warningCount > 0 ? "warn" : "ok",
      name: labels.warnings,
      value: String(warningCount),
      verdict: labels.optional,
    },
    {
      key: "checked",
      icon: checked != null && checked > 0 ? "ok" : "warn",
      name: labels.checkedSegments,
      value: checked != null ? String(checked) : "—",
      verdict: clear ? labels.optional : labels.optional,
    },
    {
      key: "profile",
      icon: gate?.run.profileName ? "ok" : "warn",
      name: labels.profile,
      value: gate?.run.profileName ?? "—",
      verdict: labels.optional,
    },
  ];

  return (
    <section className="export-gate-list" aria-label={labels.title}>
      <header>
        <h2>{labels.title}</h2>
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className="export-gate-row" data-icon={row.icon}>
            <span className="export-gate-row__icon" aria-hidden="true">
              {row.icon === "ok" ? (
                <Check size={14} />
              ) : row.icon === "err" ? (
                <X size={14} />
              ) : (
                <AlertTriangle size={14} />
              )}
            </span>
            <span className="export-gate-row__name">{row.name}</span>
            <strong className="export-gate-row__value num">{row.value}</strong>
            <span className="export-gate-row__verdict micro">{row.verdict}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
