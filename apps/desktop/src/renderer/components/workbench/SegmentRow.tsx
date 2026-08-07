/**
 * One plate-and-seam segment row (presentation + intent callbacks).
 *
 * Source: docs/design-ii/screens/workbench.md §3
 */

import {
  memo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";

import { InlineQaStrip } from "./InlineQaStrip";
import { SeamActionRail, type MoreAction } from "./SeamActionRail";
import { SegmentStatusLamp } from "./SegmentStatusLamp";
import { TagCapsule } from "./TagCapsule";
import {
  cellId,
  rowId,
  type SegmentGridLabels,
  type SegmentRowView,
} from "./segmentTypes";

export interface SegmentRowProps {
  row: SegmentRowView;
  labels: SegmentGridLabels;
  showAxis: boolean;
  axis: ReactNode;
  sourceContent: ReactNode;
  rowRef?: Ref<HTMLDivElement>;
  onRowClick: (
    event: MouseEvent,
    segmentId: string,
    targetIsEditor: boolean,
  ) => void;
  onTargetFocus: (segmentId: string) => void;
  onDraftChange: (segmentId: string, value: string) => void;
  onCompositionStart: (segmentId: string) => void;
  onCompositionEnd: (
    event: React.CompositionEvent<HTMLTextAreaElement>,
    segmentId: string,
  ) => void;
  onTargetKeyDown: (
    event: KeyboardEvent<HTMLTextAreaElement>,
    segmentId: string,
  ) => void;
  onSelectTargetTag: (segmentId: string, tagId: string | null) => void;
  onMoveTargetTag: (
    segmentId: string,
    tagId: string,
    direction: -1 | 1,
  ) => void;
  onBestMatch: (segmentId: string) => void;
  onOpenComments: (segmentId: string) => void;
  onMoreAction: (segmentId: string, action: MoreAction) => void;
  onAcceptAutocomplete: (segmentId: string, targetText: string) => void;
  onAddDictionary: (findingKey: string) => void;
  onLocateFinding: (segmentId: string, findingId: string) => void;
  onIgnoreFinding: (segmentId: string, findingId: string) => void;
}

function SegmentRowImpl({
  row,
  labels,
  showAxis,
  axis,
  sourceContent,
  rowRef,
  onRowClick,
  onTargetFocus,
  onDraftChange,
  onCompositionStart,
  onCompositionEnd,
  onTargetKeyDown,
  onSelectTargetTag,
  onMoveTargetTag,
  onBestMatch,
  onOpenComments,
  onMoreAction,
  onAcceptAutocomplete,
  onAddDictionary,
  onLocateFinding,
  onIgnoreFinding,
}: SegmentRowProps) {
  const [pairHighlight, setPairHighlight] = useState<string | null>(null);

  const className = [
    "seg-row",
    row.isActive ? "is-active" : "",
    row.isFlash ? "is-flash" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rowRef}
      className={className}
      role="row"
      id={rowId(row.segmentId)}
      data-segment-row={row.segmentId}
      data-active={row.isActive || undefined}
      data-selected={row.isSelected || undefined}
      data-anchor={row.isAnchor || undefined}
      data-state={row.lampState}
      aria-rowindex={row.ordinal + 2}
      aria-selected={row.isSelected}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const isEditor =
          target.closest("textarea[data-editor-for]") !== null ||
          target.matches("textarea[data-editor-for]");
        onRowClick(event, row.segmentId, isEditor);
      }}
    >
      <div
        className="cell cell--id"
        role="gridcell"
        id={cellId(row.segmentId, "id")}
        data-grid-col="id"
      >
        {showAxis ? axis : null}
        <span className="cell--id-num">{row.ordinal + 1}</span>
      </div>

      <div
        className="cell cell--lamp"
        role="gridcell"
        id={cellId(row.segmentId, "status")}
        data-grid-col="status"
      >
        <SegmentStatusLamp
          state={row.lampState}
          label={labels.lamp[row.lampState]}
          flash={row.isFlash}
        />
      </div>

      <div
        className="cell cell--src"
        role="gridcell"
        id={cellId(row.segmentId, "source")}
        data-grid-col="source"
      >
        {sourceContent}
        {row.sourceTags.some((tag) => tag.issue === "missing") ? (
          <div className="tag-layer tag-layer--source">
            {row.sourceTags
              .filter((tag) => tag.issue === "missing")
              .map((tag) => (
                <TagCapsule
                  key={`src-miss-${tag.id}`}
                  tag={tag}
                  side="source"
                  pairedHighlight={pairHighlight === tag.pairKey}
                  label={labels.selectProtectedTag(
                    tag.displayText,
                    tag.position,
                  )}
                  missingLabel={labels.tagMissing}
                  onHoverPair={setPairHighlight}
                />
              ))}
          </div>
        ) : null}
      </div>

      <div
        className="cell cell--tgt"
        role="gridcell"
        id={cellId(row.segmentId, "target")}
        data-grid-col="target"
      >
        <SeamActionRail
          segmentId={row.segmentId}
          labels={labels}
          isSigned={row.isSigned}
          mergeEligible={row.mergeEligible}
          hasTarget={Boolean(row.targetDraft.trim())}
          openCommentCount={row.openCommentCount}
          onBestMatch={onBestMatch}
          onOpenComments={onOpenComments}
          onMoreAction={onMoreAction}
        />

        {row.targetTags.length ? (
          <div className="target-tag-strip" aria-label={labels.targetTags}>
            {row.targetTags.map((tag) => (
              <TagCapsule
                key={tag.id}
                tag={tag}
                side="target"
                selected={row.selectedTargetTagId === tag.id}
                pairedHighlight={pairHighlight === tag.pairKey}
                disabled={row.isSigned}
                label={labels.selectProtectedTag(
                  tag.displayText,
                  tag.position,
                )}
                orderLabel={labels.tagOrder}
                onSelect={(id) => onSelectTargetTag(row.segmentId, id)}
                onHoverPair={setPairHighlight}
                onMove={(dir) => onMoveTargetTag(row.segmentId, tag.id, dir)}
              />
            ))}
          </div>
        ) : null}

        <textarea
          className="tgt-box"
          data-editor-for={row.segmentId}
          data-empty={!row.targetDraft.trim() || undefined}
          value={row.targetDraft}
          placeholder={labels.untranslated}
          aria-label={labels.targetSegment(row.ordinal + 1)}
          aria-invalid={row.ariaInvalid}
          disabled={row.isSigned}
          rows={2}
          onFocus={() => onTargetFocus(row.segmentId)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            onDraftChange(row.segmentId, event.currentTarget.value)
          }
          onCompositionStart={() => onCompositionStart(row.segmentId)}
          onCompositionEnd={(event) => onCompositionEnd(event, row.segmentId)}
          onKeyDown={(event) => onTargetKeyDown(event, row.segmentId)}
        />

        {row.autocomplete ? (
          <button
            type="button"
            className="autocomplete-tail"
            onClick={(event) => {
              event.stopPropagation();
              onAcceptAutocomplete(row.segmentId, row.autocomplete!.targetText);
            }}
            aria-label={labels.acceptAutocomplete(row.autocomplete.provider)}
          >
            <small>{row.autocomplete.provider}</small>
            <span>{row.autocomplete.tail}</span>
            <kbd>{labels.tab}</kbd>
          </button>
        ) : null}

        <InlineQaStrip
          findings={row.findings}
          regionLabel={labels.qaRegion}
          locateLabel={labels.qaLocate}
          ignoreLabel={labels.qaIgnore}
          onLocate={(id) => onLocateFinding(row.segmentId, id)}
          onIgnore={(id) => onIgnoreFinding(row.segmentId, id)}
        />

        {row.isActive && row.spellFindings.length ? (
          <div
            className="spell-findings"
            aria-label={labels.spellFindingsFrom(
              row.spellFindings[0]?.provider ?? "",
            )}
          >
            {row.spellFindings.map((finding) => (
              <button
                key={finding.key}
                type="button"
                onClick={() => onAddDictionary(finding.key)}
                title={labels.addDictionary}
              >
                {finding.word}
                <small>{finding.provider}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const SegmentRow = memo(SegmentRowImpl);
