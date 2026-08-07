/**
 * Source/target seam action rail: best match, comment, More.
 * Visible only while the parent row is hovered or focus-within (CSS).
 */

import { useState } from "react";
import {
  Combine,
  GitCompareArrows,
  Languages,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Split,
  Tags,
} from "lucide-react";

import type { SegmentGridLabels } from "./segmentTypes";

export type MoreAction =
  | "copyTags"
  | "insertTag"
  | "insertTagPair"
  | "split"
  | "merge"
  | "correctSource"
  | "chinese"
  | "review";

export interface SeamActionRailProps {
  segmentId: string;
  labels: SegmentGridLabels;
  isSigned: boolean;
  mergeEligible: boolean;
  hasTarget: boolean;
  openCommentCount: number;
  onBestMatch: (segmentId: string) => void;
  onOpenComments: (segmentId: string) => void;
  onMoreAction: (segmentId: string, action: MoreAction) => void;
}

export function SeamActionRail({
  segmentId,
  labels,
  isSigned,
  mergeEligible,
  hasTarget,
  openCommentCount,
  onBestMatch,
  onOpenComments,
  onMoreAction,
}: SeamActionRailProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div
      className="seg-row__seam-rail"
      role="toolbar"
      aria-label={labels.segmentTools}
      data-seam-rail=""
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="seam-rail__btn"
        aria-label={labels.bestMatch}
        title={labels.bestMatch}
        disabled={isSigned}
        onClick={() => onBestMatch(segmentId)}
      >
        <Sparkles size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="seam-rail__btn"
        aria-label={labels.comments}
        title={labels.comments}
        onClick={() => onOpenComments(segmentId)}
      >
        <MessageSquare size={14} aria-hidden="true" />
        {openCommentCount ? (
          <span className="seam-rail__count">{openCommentCount}</span>
        ) : null}
      </button>
      <div className="seam-rail__more">
        <button
          type="button"
          className="seam-rail__btn"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label={labels.more}
          title={labels.more}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {moreOpen ? (
          <div className="seam-rail__menu" role="menu" aria-label={labels.more}>
            {(
              [
                ["copyTags", labels.copyTags, isSigned, Tags],
                ["insertTag", labels.insertTag, isSigned, Tags],
                ["insertTagPair", labels.insertTagPair, isSigned, Tags],
                ["split", labels.splitSegment, isSigned, Split],
                [
                  "merge",
                  labels.mergeNext,
                  !mergeEligible || isSigned,
                  Combine,
                ],
                ["correctSource", labels.correctSource, isSigned, Pencil],
                [
                  "chinese",
                  labels.openChinese,
                  isSigned || !hasTarget,
                  Languages,
                ],
                ["review", labels.openReview, false, GitCompareArrows],
              ] as const
            ).map(([action, label, disabled, Icon]) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setMoreOpen(false);
                  onMoreAction(segmentId, action);
                }}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
