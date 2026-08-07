import type { QaGateResult, QaIssueView } from "@translunar/contracts";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileCheck2,
} from "lucide-react";

export interface ExportDeliveryActionsProps {
  documentName: string;
  format: string;
  gate: QaGateResult | null;
  blockers: readonly QaIssueView[];
  overrideEnabled: boolean;
  actor: string;
  reason: string;
  canExport: boolean;
  busy: boolean;
  labels: {
    contentTitle: string;
    originalFormat: string;
    formatsResidual: string;
    publication: string;
    overrideAria: string;
    overrideTitle: string;
    overrideHelp: string;
    actor: string;
    reason: string;
    actorPlaceholder: string;
    reasonPlaceholder: string;
    exportDocument: string;
    publishing: string;
    helpBlocked: string;
    noOpenErrors: string;
    resolveBefore: string;
    nothingBlocks: string;
    warningsRemain: string;
    segmentLabel: string;
    blockingFindings: string;
  };
  onOverrideEnabled(value: boolean): void;
  onActor(value: string): void;
  onReason(value: string): void;
  onExport(): void;
  onOpenSegment(segmentId: string): void;
}

export function ExportDeliveryActions({
  documentName,
  format,
  gate,
  blockers,
  overrideEnabled,
  actor,
  reason,
  canExport,
  busy,
  labels,
  onOverrideEnabled,
  onActor,
  onReason,
  onExport,
  onOpenSegment,
}: ExportDeliveryActionsProps) {
  return (
    <div className="export-delivery">
      <section className="export-content">
        <header>
          <h2>{labels.contentTitle}</h2>
        </header>
        <dl className="export-content__meta">
          <div>
            <dt>{labels.originalFormat}</dt>
            <dd>{format.toUpperCase()}</dd>
          </div>
          <div>
            <dt>{labels.publication}</dt>
            <dd>{documentName}</dd>
          </div>
        </dl>
        <p className="export-content__residual micro">{labels.formatsResidual}</p>
      </section>

      <section className="export-blockers" aria-label={labels.blockingFindings}>
        <header>
          <h2>
            {gate?.clear ? labels.noOpenErrors : labels.resolveBefore}
          </h2>
          <span className="num">{blockers.length}</span>
        </header>
        {blockers.length ? (
          blockers.map((issue) => (
            <button
              type="button"
              key={issue.id}
              onClick={() => onOpenSegment(issue.segmentId)}
            >
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                <strong>{issue.message}</strong>
                <small>
                  {issue.documentName} ·{" "}
                  {labels.segmentLabel.replace(
                    "{ordinal}",
                    String(issue.segmentOrdinal + 1),
                  )}{" "}
                  · {issue.ruleId}
                </small>
              </span>
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          ))
        ) : (
          <div className="surface-empty">
            <FileCheck2 size={24} aria-hidden="true" />
            <strong>{labels.nothingBlocks}</strong>
            <span>{labels.warningsRemain}</span>
          </div>
        )}
      </section>

      <aside className="export-delivery-card">
        {!gate?.clear && gate ? (
          <div className="override-control">
            <label className="override-toggle">
              <input
                aria-label={labels.overrideAria}
                type="checkbox"
                checked={overrideEnabled}
                onChange={(event) =>
                  onOverrideEnabled(event.currentTarget.checked)
                }
              />
              <span>
                <strong>{labels.overrideTitle}</strong>
                <small>{labels.overrideHelp}</small>
              </span>
            </label>
            {overrideEnabled ? (
              <div className="override-fields">
                <label>
                  {labels.actor}
                  <input
                    value={actor}
                    onChange={(event) => onActor(event.currentTarget.value)}
                    placeholder={labels.actorPlaceholder}
                  />
                </label>
                <label>
                  {labels.reason}
                  <textarea
                    value={reason}
                    onChange={(event) => onReason(event.currentTarget.value)}
                    placeholder={labels.reasonPlaceholder}
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className={
            !gate?.clear && overrideEnabled
              ? "button danger export-submit"
              : "button primary export-submit"
          }
          disabled={!canExport || busy}
          onClick={onExport}
        >
          <Download size={15} aria-hidden="true" />
          {busy ? labels.publishing : labels.exportDocument}
        </button>
        {!gate?.clear && gate && !overrideEnabled ? (
          <p className="export-help">{labels.helpBlocked}</p>
        ) : null}
      </aside>
    </div>
  );
}
