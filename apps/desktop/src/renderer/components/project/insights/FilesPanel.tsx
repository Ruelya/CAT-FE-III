import type { DragEvent } from "react";
import type {
  BatchImportDiagnostic,
  Document,
  ProjectAnalyticsSummary,
} from "@translunar/contracts";
import {
  ArrowRight,
  Check,
  FilePlus2,
  FileText,
  FolderOpen,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";
import { fileName } from "../../../workbench-utils";
import { formatBasisPoints, SectionHeading } from "./insightsShared";

export interface FilesPanelProps {
  documents: Document[];
  activeDocumentId: string;
  analytics: ProjectAnalyticsSummary | null;
  busy: boolean;
  diagnostics: BatchImportDiagnostic[];
  onChooseFiles(): void;
  onChooseFolder(): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
  onOpen(documentId: string): void;
  onRecycle(document: Document): void;
}

export function FilesPanel({
  documents,
  activeDocumentId,
  analytics,
  busy,
  diagnostics,
  onChooseFiles,
  onChooseFolder,
  onDrop,
  onOpen,
  onRecycle,
}: FilesPanelProps) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="insights-files-layout">
      <section className="insights-section insights-files">
        <SectionHeading
          eyebrow={t("insights.activeSourceSet")}
          title={t("insights.projectFiles", { count: documents.length })}
          icon={<FileText size={18} aria-hidden="true" />}
          actions={
            <>
              <button
                className="button secondary"
                type="button"
                onClick={onChooseFiles}
                disabled={busy}
              >
                <FilePlus2 size={14} aria-hidden="true" /> {t("insights.addFiles")}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={onChooseFolder}
                disabled={busy}
              >
                <FolderOpen size={14} aria-hidden="true" />{" "}
                {t("insights.addFolder")}
              </button>
            </>
          }
        />
        <div
          className="insights-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <UploadCloud size={20} aria-hidden="true" />
          <span>{t("insights.dropFiles")}</span>
        </div>
        <div className="insights-file-list">
          {documents.map((item) => {
            const progress = analytics?.documentProgress[item.id];
            return (
              <article
                key={item.id}
                data-active={item.id === activeDocumentId || undefined}
              >
                <div className="insights-file-icon">
                  <FileText size={16} aria-hidden="true" />
                </div>
                <div className="insights-file-copy">
                  <span>
                    {item.format} ·{" "}
                    {t("insights.fileRevisionVersion", {
                      revision: item.revision,
                      version: item.currentVersion,
                    })}
                  </span>
                  <strong>{item.relativePath}</strong>
                  <small>
                    {item.status} ·{" "}
                    {item.degradation.length
                      ? t("insights.fileSegmentsDiagnostics", {
                          count: item.segmentCount,
                          diagnostics: item.degradation.length,
                        })
                      : t("insights.fileSegments", {
                          count: item.segmentCount,
                        })}
                  </small>
                </div>
                <div className="insights-file-progress">
                  <strong>
                    {progress
                      ? formatBasisPoints(
                          progress.completionBasisPoints,
                          formatNumber,
                          t,
                        )
                      : t("insights.unavailable")}
                  </strong>
                  <span>
                    {progress
                      ? t("insights.blockerCount", {
                          count: progress.qaBlockers,
                        })
                      : ""}
                  </span>
                </div>
                <div className="insights-file-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => onOpen(item.id)}
                  >
                    {t("common.open")}
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    title={t("insights.recycleDocument")}
                    aria-label={t("insights.recycleNamed", { name: item.name })}
                    onClick={() => onRecycle(item)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {diagnostics.length ? (
        <section className="insights-section insights-diagnostics">
          <SectionHeading
            eyebrow={t("insights.lastBatch")}
            title={t("setup.importDiagnostics")}
            icon={<FilePlus2 size={18} aria-hidden="true" />}
          />
          {diagnostics.map((item, index) => (
            <div
              key={`${item.path}-${index}`}
              data-status={item.status}
              className="insights-diagnostic-row"
            >
              <span>
                {item.status === "succeeded" ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  "!"
                )}
              </span>
              <div>
                <strong>{item.relativePath || fileName(item.path)}</strong>
                <small>{item.message ?? item.errorCode ?? item.status}</small>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
