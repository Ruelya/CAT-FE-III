import type {
  Document,
  DocumentReimportPreviewResult,
} from "@translunar/contracts";
import { ArrowRight, FileClock, FolderOpen, RotateCcw } from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";
import { fileName } from "../../../workbench-utils";
import { Definition, Metric, SectionHeading } from "./insightsShared";

export interface ReimportPanelProps {
  document: Document;
  replacementPath: string;
  preview: DocumentReimportPreviewResult | null;
  busy: boolean;
  onChoose(): void;
  onPreview(): void;
  onApply(): void;
}

export function ReimportPanel({
  document,
  replacementPath,
  preview,
  busy,
  onChoose,
  onPreview,
  onApply,
}: ReimportPanelProps) {
  const { t } = useLocale();
  return (
    <div className="insights-reimport-layout">
      <section className="insights-section">
        <SectionHeading
          eyebrow={t("insights.revisionReconciliation")}
          title={document.name}
          icon={<RotateCcw size={18} aria-hidden="true" />}
        />
        <dl className="insights-file-facts">
          <Definition
            label={t("insights.currentRevision")}
            value={document.revision}
          />
          <Definition
            label={t("insights.currentVersion")}
            value={document.currentVersion}
          />
          <Definition
            label={t("common.segments")}
            value={document.segmentCount}
          />
          <Definition
            label={t("insights.sourceHash")}
            value={document.sourceSha256.slice(0, 12)}
          />
        </dl>
        <div className="insights-reimport-picker">
          <button
            className="button secondary"
            type="button"
            onClick={onChoose}
            disabled={busy}
          >
            <FolderOpen size={14} aria-hidden="true" />{" "}
            {t("insights.selectReplacement")}
          </button>
          <span title={replacementPath}>
            {replacementPath
              ? fileName(replacementPath)
              : t("insights.noReplacement")}
          </span>
          <button
            className="button primary"
            type="button"
            onClick={onPreview}
            disabled={busy || !replacementPath}
          >
            {t("insights.previewReconciliation")}
          </button>
        </div>
      </section>

      {preview ? (
        <section className="insights-section insights-reimport-preview">
          <SectionHeading
            eyebrow={t("insights.previewId", {
              id: preview.previewId.slice(0, 8),
            })}
            title={t("insights.reconciliation")}
            icon={<FileClock size={18} aria-hidden="true" />}
            actions={
              <button
                className="button primary"
                type="button"
                onClick={onApply}
                disabled={busy}
              >
                {t("insights.applyPreview")}
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            }
          />
          <div
            className="reimport-counts"
            aria-label={t("insights.reimportCounts")}
          >
            <Metric
              label={t("insights.unchanged")}
              value={preview.plan.unchanged}
            />
            <Metric label={t("insights.changed")} value={preview.plan.changed} />
            <Metric
              label={t("insights.newSegments")}
              value={preview.plan.newSegments}
            />
            <Metric
              label={t("insights.removed")}
              value={preview.plan.removed}
            />
            <Metric
              label={t("insights.ambiguous")}
              value={preview.plan.ambiguous}
            />
          </div>
          <div className="reimport-items">
            {preview.plan.items.slice(0, 100).map((item, index) => (
              <div
                key={`${item.oldSegmentId ?? "new"}-${item.newSegmentId ?? index}`}
              >
                <span data-disposition={item.disposition}>
                  {item.disposition}
                </span>
                <strong>
                  {item.oldOrdinal === undefined || item.oldOrdinal === null
                    ? t("insights.newItem")
                    : t("insights.oldOrdinal", {
                        ordinal: item.oldOrdinal + 1,
                      })}
                  {" → "}
                  {item.newOrdinal === undefined || item.newOrdinal === null
                    ? t("insights.removedLabel")
                    : t("insights.newOrdinal", {
                        ordinal: item.newOrdinal + 1,
                      })}
                </strong>
                <small>{item.reason}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
