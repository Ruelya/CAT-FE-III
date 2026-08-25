import { useEffect, useState } from "react";

import type { Segment, SegmentState } from "@translunar/contracts";
import { Badge, Button } from "@translunar/ui";
import type { BadgeTone } from "@translunar/ui";

export interface SegmentGridProps {
  segments: Segment[];
  activeSegmentId: string | null;
  /** Segment ids with open QA issues. */
  qaSegmentIds: ReadonlySet<string>;
  onSelect: (segmentId: string) => void;
  onSaveDraft: (segment: Segment, targetText: string) => void;
  onConfirm: (segment: Segment, targetText: string) => void;
}

const STATE_LABEL: Record<SegmentState, [string, BadgeTone]> = {
  untranslated: ["未译", "neutral"],
  draft: ["草稿", "accent"],
  confirmed: ["已确认", "ok"],
};

export function SegmentGrid({
  segments,
  activeSegmentId,
  qaSegmentIds,
  onSelect,
  onSaveDraft,
  onConfirm,
}: SegmentGridProps) {
  const [draft, setDraft] = useState("");
  const activeSegment =
    segments.find((segment) => segment.id === activeSegmentId) ?? null;

  // Re-seed the editor whenever the active segment (or its committed target)
  // changes from the outside, e.g. TM apply, AI draft, or propagation.
  useEffect(() => {
    setDraft(activeSegment?.targetText ?? "");
  }, [activeSegment?.id, activeSegment?.targetText]);

  return (
    <div className="segment-grid">
      <table>
        <thead>
          <tr>
            <th className="segment-grid__ordinal">#</th>
            <th className="segment-grid__source">源文</th>
            <th className="segment-grid__target">译文</th>
            <th className="segment-grid__state">状态</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => {
            const isActive = segment.id === activeSegmentId;
            const [label, tone] = STATE_LABEL[segment.state];
            return (
              <tr
                key={segment.id}
                data-active={isActive}
                onClick={() => onSelect(segment.id)}
              >
                <td className="segment-grid__ordinal">{segment.ordinal + 1}</td>
                <td className="segment-grid__source">{segment.sourceText}</td>
                <td className="segment-grid__target">
                  {isActive ? (
                    <div className="segment-grid__target-editor">
                      <textarea
                        aria-label={`句段 ${segment.ordinal + 1} 译文`}
                        value={draft}
                        autoFocus
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            (event.ctrlKey || event.metaKey) &&
                            event.key === "Enter"
                          ) {
                            event.preventDefault();
                            onConfirm(segment, draft);
                          }
                        }}
                      />
                      <div className="segment-grid__actions">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSaveDraft(segment, draft);
                          }}
                        >
                          保存草稿
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={draft.trim().length === 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            onConfirm(segment, draft);
                          }}
                        >
                          确认
                        </Button>
                        <span className="segment-grid__hint">
                          Ctrl+Enter 确认
                        </span>
                      </div>
                    </div>
                  ) : segment.targetText ? (
                    segment.targetText
                  ) : (
                    <span className="segment-grid__placeholder">—</span>
                  )}
                </td>
                <td className="segment-grid__state">
                  <Badge tone={tone}>{label}</Badge>{" "}
                  {qaSegmentIds.has(segment.id) ? (
                    <Badge tone="danger" title="存在未解决的 QA 问题">
                      QA
                    </Badge>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
