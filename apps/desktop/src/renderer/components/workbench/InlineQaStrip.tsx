/**
 * Plate-style inline QA strip under source/target.
 * Renders supplied findings only — does not evaluate rules.
 *
 * Source: docs/design-ii/screens/workbench.md §3.2
 */

import { AlertTriangle, Info, Tags } from "lucide-react";

import type { InlineFindingView } from "./segmentTypes";

export interface InlineQaStripProps {
  findings: InlineFindingView[];
  regionLabel: string;
  locateLabel: string;
  ignoreLabel: string;
  onLocate?: (findingId: string) => void;
  onIgnore?: (findingId: string) => void;
}

export function InlineQaStrip({
  findings,
  regionLabel,
  locateLabel,
  ignoreLabel,
  onLocate,
  onIgnore,
}: InlineQaStripProps) {
  if (findings.length === 0) return null;

  return (
    <div
      className="qa-inline-strip"
      role="region"
      aria-label={regionLabel}
      data-qa-inline=""
    >
      <ul className="qa-inline-strip__list">
        {findings.map((finding) => (
          <li
            key={finding.id}
            className="qa-inline"
            data-severity={finding.severity}
            data-source={finding.source}
          >
            <span className="qa-inline__icon" aria-hidden="true">
              {finding.source === "tag" ? (
                <Tags size={12} />
              ) : finding.severity === "info" ? (
                <Info size={12} />
              ) : (
                <AlertTriangle size={12} />
              )}
            </span>
            <span className="qa-inline__msg">{finding.message}</span>
            <span className="qa-inline__actions">
              {finding.canLocate && onLocate ? (
                <button
                  type="button"
                  className="qa-inline__action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLocate(finding.id);
                  }}
                >
                  {locateLabel}
                </button>
              ) : null}
              {finding.canIgnore && onIgnore ? (
                <button
                  type="button"
                  className="qa-inline__action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onIgnore(finding.id);
                  }}
                >
                  {ignoreLabel}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
