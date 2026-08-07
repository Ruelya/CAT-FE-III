import type { RecycleEntry } from "@translunar/contracts";
import { FileText, FolderOpen, RotateCcw, Trash2 } from "lucide-react";

import { useLocale } from "../../i18n/LocaleProvider";

export interface RecyclePaneProps {
  items: RecycleEntry[];
  onRestore(entry: RecycleEntry): void;
  onPurge(entry: RecycleEntry): void;
}

export function RecyclePane({ items, onRestore, onPurge }: RecyclePaneProps) {
  const { t, formatDate } = useLocale();

  return (
    <div className="recycle-pane">
      <header className="project-view-heading">
        <div>
          <h1>{t("home.recycleBin")}</h1>
          <p>{t("home.recycleDescription")}</p>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="project-home-empty" data-empty="d6">
          <Trash2 size={22} aria-hidden="true" />
          <strong>{t("home.recycleEmpty")}</strong>
          <span>{t("home.recycleEmptyHelp")}</span>
        </div>
      ) : (
        <div className="recycle-list">
          {items.map((entry) => (
            <article key={entry.id}>
              <div className="recycle-kind">
                {entry.entityType === "project" ? (
                  <FolderOpen size={16} aria-hidden="true" />
                ) : (
                  <FileText size={16} aria-hidden="true" />
                )}
              </div>
              <div>
                <span>
                  {t("home.deletedAt", {
                    kind: entry.entityType,
                    value: formatDate(entry.deletedAtMs, {
                      dateStyle: "medium",
                    }),
                  })}
                </span>
                <h2>{entry.displayName}</h2>
                <p>{entry.reason}</p>
                <small>
                  {t("home.retainedUntil", {
                    value: formatDate(entry.retentionUntilMs, {
                      dateStyle: "medium",
                    }),
                    actor: entry.actor,
                  })}
                </small>
              </div>
              <div>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onRestore(entry)}
                >
                  <RotateCcw size={14} /> {t("home.restoreItem")}
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={t("home.purgeNamed", { name: entry.displayName })}
                  title={t("home.permanentlyPurge")}
                  onClick={() => onPurge(entry)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
