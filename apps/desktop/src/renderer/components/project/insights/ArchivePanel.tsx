import { Archive, FolderOpen, Trash2 } from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";

export interface ArchivePanelProps {
  projectName: string;
  busy: boolean;
  onExport(): void;
  onRecycle(): void;
}

export function ArchivePanel({
  projectName,
  busy,
  onExport,
  onRecycle,
}: ArchivePanelProps) {
  const { t } = useLocale();
  return (
    <div className="insights-archive-layout">
      <section className="insights-section insights-archive-action">
        <FolderOpen size={24} aria-hidden="true" />
        <div>
          <span className="surface-kicker">{t("insights.portable")}</span>
          <h2>{t("insights.exportArchive")}</h2>
          <p>{projectName}</p>
        </div>
        <button
          className="button primary"
          type="button"
          onClick={onExport}
          disabled={busy}
        >
          <Archive size={14} aria-hidden="true" /> {t("insights.exportTlcat")}
        </button>
      </section>
      <section className="insights-section insights-archive-action danger-zone">
        <Trash2 size={24} aria-hidden="true" />
        <div>
          <span className="surface-kicker">{t("insights.recoverable")}</span>
          <h2>{t("insights.recycleProject")}</h2>
          <p>{t("insights.restoreFromHome")}</p>
        </div>
        <button
          className="button danger"
          type="button"
          onClick={onRecycle}
          disabled={busy}
        >
          <Trash2 size={14} aria-hidden="true" />
          {t("insights.recycleProject")}
        </button>
      </section>
    </div>
  );
}
