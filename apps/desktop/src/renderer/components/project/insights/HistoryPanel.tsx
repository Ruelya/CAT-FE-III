import type { Operation } from "@translunar/contracts";
import { History } from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";
import { SectionHeading, UnavailableState } from "./insightsShared";

export interface HistoryPanelProps {
  operations: Operation[];
  total: number;
}

export function HistoryPanel({ operations, total }: HistoryPanelProps) {
  const { t, formatDate } = useLocale();
  return (
    <section className="insights-section insights-history">
      <SectionHeading
        eyebrow={t("insights.historyCount", { count: total })}
        title={t("insights.history")}
        icon={<History size={18} aria-hidden="true" />}
      />
      {operations.length ? (
        <div className="insights-history-list">
          {operations.map((operation) => (
            <article key={operation.id}>
              <span className="history-sequence">#{operation.sequence}</span>
              <div>
                <strong>{operation.kind.replaceAll("_", " ")}</strong>
                <span>
                  {operation.entityType} · {operation.entityId.slice(0, 12)}
                </span>
              </div>
              <div>
                <strong>{operation.actor}</strong>
                <time>{formatDate(operation.createdAtMs)}</time>
              </div>
              <span>
                {operation.resultRevision === undefined ||
                operation.resultRevision === null
                  ? ""
                  : `r${operation.resultRevision}`}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <UnavailableState label={t("insights.noOperations")} compact />
      )}
    </section>
  );
}
