import { useEffect, useState, type KeyboardEvent } from "react";
import type {
  QaIssueView,
  QaRunPluginRuleSnapshot,
  QaSeverity,
  Segment,
} from "@translunar/contracts";
import {
  ExternalLink,
  PencilLine,
  ShieldAlert,
  Undo2,
} from "lucide-react";

import { findSegment, sliceWithSpans } from "./qa-presenters";

export interface QaEvidencePanelProps {
  issue: QaIssueView | null;
  segments: readonly Segment[];
  pluginRule: QaRunPluginRuleSnapshot | null;
  busy: boolean;
  severityLabel(severity: QaSeverity): string;
  categoryLabel(category: string): string;
  labels: {
    detailAria: string;
    selectFinding: string;
    evidenceHere: string;
    source: string;
    target: string;
    noSource: string;
    noTarget: string;
    rule: string;
    severity: string;
    locate: string;
    fixInPlace: string;
    saveFix: string;
    cancelFix: string;
    waive: string;
    revokeWaiver: string;
    openRelated: string;
    noEvidenceText: string;
    pluginOwner: string;
    contribution: string;
    fixHint: string;
  };
  formatWaivedBy(actor: string): string;
  formatRelated(count: number): string;
  onOpenSegment(segmentId: string): void;
  onStartWaive(): void;
  onRevoke(): void;
  onSaveTarget(segment: Segment, targetText: string): Promise<void>;
}

export function QaEvidencePanel({
  issue,
  segments,
  pluginRule,
  busy,
  severityLabel,
  categoryLabel,
  labels,
  formatWaivedBy,
  formatRelated,
  onOpenSegment,
  onStartWaive,
  onRevoke,
  onSaveTarget,
}: QaEvidencePanelProps) {
  const segment = issue ? findSegment(segments, issue.segmentId) : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setDraft(segment?.targetText ?? "");
    setSaveError(null);
  }, [issue?.id, segment?.id, segment?.targetText, segment?.revision]);

  if (!issue) {
    return (
      <aside className="qa-ortho__evidence" aria-label={labels.detailAria}>
        <div className="surface-empty">
          <ShieldAlert size={22} aria-hidden="true" />
          <strong>{labels.selectFinding}</strong>
          <span>{labels.evidenceHere}</span>
        </div>
      </aside>
    );
  }

  const sourceText = segment?.sourceText ?? "";
  const targetText = segment?.targetText ?? "";
  const sourceSlices = sliceWithSpans(
    sourceText,
    issue.evidence.sourceSpans,
  );
  const targetSlices = sliceWithSpans(
    targetText,
    issue.evidence.targetSpans,
  );
  const related = issue.evidence.relatedSegmentIds ?? [];

  async function saveAndMaybeAdvance(advance: boolean) {
    if (!segment) return;
    setSaveError(null);
    try {
      await onSaveTarget(segment, draft);
      setEditing(false);
      if (advance) {
        /* parent advances selection after reload */
      }
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : String(error ?? "error"),
      );
    }
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void saveAndMaybeAdvance(true);
    }
  }

  return (
    <aside className="qa-ortho__evidence" aria-label={labels.detailAria}>
      <header className="qa-ortho__evidence-head">
        <span
          className="qa-ortho__sev-lamp"
          data-severity={issue.severity}
        >
          {severityLabel(issue.severity)}
        </span>
        <strong>
          {labels.rule} · {categoryLabel(issue.category)}
        </strong>
        <span className="qa-ortho__seg-meta">
          {issue.documentName} · {issue.segmentOrdinal + 1}
        </span>
        <code title={issue.ruleId}>{issue.ruleId}</code>
      </header>

      <p className="qa-ortho__evidence-message">{issue.message}</p>

      {pluginRule ? (
        <dl className="qa-finding-provenance">
          <div>
            <dt>{labels.pluginOwner}</dt>
            <dd>{pluginRule.provenance.pluginId}</dd>
          </div>
          <div>
            <dt>{labels.contribution}</dt>
            <dd>{pluginRule.provenance.contributionId}</dd>
          </div>
        </dl>
      ) : null}

      <div className="qa-evidence__block">
        <span className="micro">{labels.source}</span>
        <div className="qa-evidence__text">
          {segment ? (
            sourceSlices.map((slice, index) =>
              slice.hit ? (
                <mark key={index} className="qa-span-hit">
                  {slice.text}
                </mark>
              ) : (
                <span key={index}>{slice.text}</span>
              ),
            )
          ) : (
            <span className="qa-evidence__empty">{labels.noSource}</span>
          )}
        </div>
      </div>

      <div className="qa-evidence__block">
        <span className="micro">{labels.target}</span>
        {editing ? (
          <textarea
            className="qa-evidence__editor"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={onEditorKeyDown}
            aria-label={labels.fixInPlace}
            rows={6}
            autoFocus
          />
        ) : (
          <div className="qa-evidence__text">
            {segment ? (
              targetSlices.map((slice, index) =>
                slice.hit ? (
                  <mark key={index} className="qa-span-hit">
                    {slice.text}
                  </mark>
                ) : (
                  <span key={index}>{slice.text}</span>
                ),
              )
            ) : (
              <span className="qa-evidence__empty">{labels.noTarget}</span>
            )}
          </div>
        )}
      </div>

      {saveError ? (
        <p className="surface-error" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="qa-ortho__actions">
        <button
          type="button"
          className="button primary"
          onClick={() => onOpenSegment(issue.segmentId)}
        >
          <ExternalLink size={14} aria-hidden="true" />
          {labels.locate}
        </button>
        {editing ? (
          <>
            <button
              type="button"
              className="button primary"
              disabled={busy || !segment}
              onClick={() => void saveAndMaybeAdvance(true)}
            >
              {labels.saveFix}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setEditing(false);
                setDraft(segment?.targetText ?? "");
                setSaveError(null);
              }}
            >
              {labels.cancelFix}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button secondary"
            disabled={!segment || busy}
            onClick={() => setEditing(true)}
          >
            <PencilLine size={14} aria-hidden="true" />
            {labels.fixInPlace}
          </button>
        )}
        {issue.disposition === "waived" && issue.waiver ? (
          <div className="qa-waiver">
            <span>{formatWaivedBy(issue.waiver.actor)}</span>
            <p>{issue.waiver.reason}</p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onRevoke}
            >
              <Undo2 size={14} aria-hidden="true" />
              {labels.revokeWaiver}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button secondary"
            disabled={busy || issue.disposition !== "open"}
            onClick={onStartWaive}
          >
            {labels.waive}
          </button>
        )}
      </div>
      {editing ? (
        <p className="qa-ortho__fix-hint micro">{labels.fixHint}</p>
      ) : null}

      {related.length ? (
        <div className="qa-ortho__related">
          <span className="micro">{formatRelated(related.length)}</span>
          <ul>
            {related.map((segmentId) => (
              <li key={segmentId}>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => onOpenSegment(segmentId)}
                >
                  {labels.openRelated.replace(
                    "{id}",
                    segmentId.slice(0, 8),
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
