import type { Document } from "@translunar/contracts";
import { ChevronDown, Download, FileText, ShieldCheck } from "lucide-react";

import { useLocale } from "../../i18n/LocaleProvider";

export interface MastheadProps {
  projectName: string;
  sourceLocale: string;
  targetLocale: string;
  documents: readonly Document[];
  activeDocument: Document;
  /** Authoritative segment total for the open document (progress). */
  confirmedCount: number;
  totalCount: number;
  actionBusy: boolean;
  onRunQa(): void;
  onExport(): void;
  /** Existing save-before-navigation path; never a direct load. */
  onSelectDocument(documentId: string): void;
}

/**
 * Workbench masthead: identity plate (sole 45° bevel), document switcher,
 * Run QA / Export. Global search stays on Ctrl+Shift+K only.
 */
export function Masthead({
  projectName,
  sourceLocale,
  targetLocale,
  documents,
  activeDocument,
  confirmedCount,
  totalCount,
  actionBusy,
  onRunQa,
  onExport,
  onSelectDocument,
}: MastheadProps) {
  const { t } = useLocale();
  const fileCount = documents.length;
  const progressPct =
    totalCount > 0 ? Math.round((confirmedCount / totalCount) * 100) : 0;
  const metaLine = [
    `${sourceLocale} → ${targetLocale}`,
    t("home.filesCount", { count: fileCount }),
  ].join(" · ");

  return (
    <header className="masthead app-bar" role="banner">
      <div className="identity brand-plate" data-project-identity>
        <div className="identity__name">{projectName}</div>
        <div className="identity__meta micro">{metaLine}</div>
      </div>

      <div className="masthead__mid">
        <label className="docswitch docswitch--select">
          <FileText size={15} aria-hidden="true" />
          <span className="visually-hidden">{t("workbench.activeDocument")}</span>
          <select
            className="docswitch__select"
            value={activeDocument.id}
            disabled={actionBusy}
            aria-label={t("workbench.activeDocument")}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (next && next !== activeDocument.id) onSelectDocument(next);
            }}
          >
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
                {doc.id === activeDocument.id
                  ? ` · ${progressPct}%`
                  : doc.segmentCount > 0
                    ? ` · ${doc.segmentCount}`
                    : ""}
              </option>
            ))}
          </select>
          <span className="docswitch__name" aria-hidden="true">
            {activeDocument.name}
          </span>
          <span className="docswitch__pct num" aria-hidden="true">
            {progressPct}%
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
      </div>

      <div className="masthead__actions app-actions">
        <button
          id="tutorial-target-qa"
          className="btn btn--secondary top-command"
          type="button"
          onClick={onRunQa}
          disabled={actionBusy}
        >
          <ShieldCheck size={15} aria-hidden="true" />
          {t("workbench.runQa")}
        </button>
        <button
          id="tutorial-target-export"
          className="btn btn--primary top-command export-command"
          type="button"
          onClick={onExport}
          disabled={actionBusy}
        >
          <Download size={15} aria-hidden="true" />
          {t("action.export")}
        </button>
      </div>
    </header>
  );
}
