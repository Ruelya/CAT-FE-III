/**
 * Phase 3 presentational contracts for the segment grid.
 * View-only: no engine/draft ownership.
 */

import type {
  EditorTagIssue,
  EditorWorkflowState,
  InlineTag,
  QaIssue,
  Segment,
  SegmentState,
} from "@translunar/contracts";
import type { ReactNode } from "react";

/** Eight presentational lamp states (PRD R1). */
export type SegmentLampState =
  | "untranslated"
  | "draft"
  | "confirmed"
  | "reviewed"
  | "signed"
  | "error"
  | "warning"
  | "locked";

export type GridColumn = "id" | "status" | "source" | "target";

export const GRID_COLUMNS: readonly GridColumn[] = [
  "id",
  "status",
  "source",
  "target",
] as const;

export interface TagView {
  id: string;
  displayText: string;
  kind: string;
  position: number;
  /** Shared pair key for source/target highlight (pairId or id). */
  pairKey: string;
  issue: "none" | "missing" | "order";
}

export interface InlineFindingView {
  id: string;
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  source: "qa" | "tag";
  canLocate: boolean;
  canIgnore: boolean;
}

export interface AutocompleteView {
  targetText: string;
  tail: string;
  provider: string;
}

export interface SegmentRowView {
  segmentId: string;
  ordinal: number;
  sourceText: string;
  targetDraft: string;
  segmentState: SegmentState;
  workflowState: EditorWorkflowState;
  lampState: SegmentLampState;
  isActive: boolean;
  isSelected: boolean;
  isAnchor: boolean;
  isFlash: boolean;
  isSigned: boolean;
  isEditable: boolean;
  mergeEligible: boolean;
  openCommentCount: number;
  sourceTags: TagView[];
  targetTags: TagView[];
  selectedTargetTagId: string | null;
  findings: InlineFindingView[];
  autocomplete: AutocompleteView | null;
  spellFindings: Array<{
    key: string;
    word: string;
    provider: string;
  }>;
  ariaInvalid: boolean;
}

export interface SegmentGridLabels {
  region: string;
  /** Column header for segment ID / number. */
  idColumn: string;
  status: string;
  sourceColumn: string;
  targetColumn: string;
  untranslated: string;
  segmentTools: string;
  bestMatch: string;
  comments: string;
  more: string;
  targetTags: string;
  selectProtectedTag: (tag: string, position: number) => string;
  moveTagHint: string;
  targetSegment: (ordinal: number) => string;
  acceptAutocomplete: (provider: string) => string;
  tab: string;
  spellFindingsFrom: (provider: string) => string;
  addDictionary: string;
  noMatches: string;
  clearFilters: string;
  lamp: Record<SegmentLampState, string>;
  selectedCount: (count: number) => string;
  selectedHidden: (count: number) => string;
  batchConfirm: string;
  batchClearTarget: string;
  batchLock: string;
  batchPretranslate: string;
  batchComment: string;
  batchCancel: string;
  batchConfirmDestructive: string;
  qaRegion: string;
  qaLocate: string;
  qaIgnore: string;
  tagPaired: string;
  tagMissing: string;
  tagOrder: string;
  splitSegment: string;
  mergeNext: string;
  correctSource: string;
  openChinese: string;
  openReview: string;
  copyTags: string;
  insertTag: string;
  insertTagPair: string;
}

export type BatchActionId =
  | "confirm"
  | "clearTarget"
  | "lock"
  | "pretranslate"
  | "comment"
  | "cancel";

export interface BatchActionDescriptor {
  id: BatchActionId;
  label: string;
  enabled: boolean;
  destructive?: boolean;
}

export interface SegmentGridProps {
  rows: SegmentRowView[];
  total: number;
  offset: number;
  rowHeight: number;
  loading: boolean;
  empty: boolean;
  hasFilters: boolean;
  activeId: string | null;
  labels: SegmentGridLabels;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  /** Seek so that filter-space list index is mounted (not document ordinal). */
  onSeekOrdinal?: (listIndex: number) => void | Promise<void>;
  onActivate: (segmentId: string) => void;
  onTargetFocus: (segmentId: string) => void;
  onDraftChange: (segmentId: string, value: string) => void;
  onCompositionStart: (segmentId: string) => void;
  onCompositionEnd: (
    event: React.CompositionEvent<HTMLTextAreaElement>,
    segmentId: string,
  ) => void;
  onTargetKeyDown: (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
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
  onMoreAction: (
    segmentId: string,
    action:
      | "copyTags"
      | "insertTag"
      | "insertTagPair"
      | "split"
      | "merge"
      | "correctSource"
      | "chinese"
      | "review",
  ) => void;
  onAcceptAutocomplete: (segmentId: string, targetText: string) => void;
  onAddDictionary: (findingKey: string) => void;
  onLocateFinding: (segmentId: string, findingId: string) => void;
  onIgnoreFinding: (segmentId: string, findingId: string) => void;
  onClearFilters: () => void;
  onBatchAction: (action: BatchActionId, selectedIds: string[]) => void;
  batchActions: BatchActionDescriptor[];
  /**
   * Optional IME predicate from Workbench (composition session or per-segment).
   * Prefer injecting into roving when provided so tests can stub it.
   */
  isComposing?: () => boolean;
  /** Mount ActiveAxis only for the active/anchor row. */
  renderAxis: (segmentId: string) => ReactNode;
  /** Extra source cell content (TaggedText with nonprinting). */
  renderSource: (row: SegmentRowView) => ReactNode;
  selectedIds: ReadonlySet<string>;
  anchorId: string | null;
  onSelectionChange: (next: {
    selectedIds: Set<string>;
    anchorId: string | null;
  }) => void;
  filterSelectedCount?: number;
  hiddenSelectedCount?: number;
  /** Ordered full filter-scope IDs when Workbench has expanded them. */
  allFilteredIds?: readonly string[];
  /** Select-all for current filter when IDs are not pre-expanded. */
  onSelectAllFilterScope?: () => void | Promise<void>;
  /** Expand a list-index range across the virtual window. */
  onRangeSelect?: (
    fromListIndex: number,
    toListIndex: number,
    anchorId: string,
  ) => void | Promise<void>;
  /**
   * Estimated row stride from measured heights (for Matrix / scroll index).
   * Falls back to `rowHeight` when nothing is measured yet.
   */
  onRowStrideChange?: (stride: number) => void;
}

/** Deterministic lamp mapping — does not mutate stored state. */
export function deriveLampState(input: {
  segmentState: SegmentState;
  workflowState: EditorWorkflowState;
  openIssue?: Pick<QaIssue, "severity" | "status"> | null;
  locked?: boolean;
}): SegmentLampState {
  const issue = input.openIssue;
  if (issue && issue.status === "open") {
    if (issue.severity === "error") return "error";
    if (issue.severity === "warning" || issue.severity === "info") {
      return "warning";
    }
  }
  if (input.locked) return "locked";
  if (input.workflowState === "signed") return "signed";
  if (input.workflowState === "review") return "reviewed";
  if (input.segmentState === "confirmed") return "confirmed";
  if (input.segmentState === "draft") return "draft";
  return "untranslated";
}

export function pairKeyForTag(tag: Pick<InlineTag, "id" | "pairId">): string {
  return tag.pairId?.trim() ? tag.pairId : tag.id;
}

export function mapSourceTags(
  tags: InlineTag[],
  targetTags: InlineTag[],
  tagIssues: EditorTagIssue[],
): TagView[] {
  const targetSigs = new Set(
    targetTags.map((tag) => tagSignature(tag)),
  );
  const hasMissingIssue = tagIssues.some((issue) => issue.code === "tag_missing");
  return tags.map((tag) => {
    const missing =
      hasMissingIssue && !targetSigs.has(tagSignature(tag))
        ? ("missing" as const)
        : ("none" as const);
    return {
      id: tag.id,
      displayText: tag.displayText || tag.kind,
      kind: tag.kind,
      position: tag.position,
      pairKey: pairKeyForTag(tag),
      issue: missing,
    };
  });
}

export function mapTargetTags(
  tags: InlineTag[],
  tagIssues: EditorTagIssue[],
): TagView[] {
  const orderTagIds = new Set(
    tagIssues
      .filter((issue) => issue.code === "tag_pair_order")
      .map((issue) => issue.tagId)
      .filter((id): id is string => Boolean(id)),
  );
  return tags.map((tag) => ({
    id: tag.id,
    displayText: tag.displayText || tag.kind,
    kind: tag.kind,
    position: tag.position,
    pairKey: pairKeyForTag(tag),
    issue: orderTagIds.has(tag.id) ? ("order" as const) : ("none" as const),
  }));
}

export function mapFindings(
  issue: QaIssue | undefined,
  tagIssues: EditorTagIssue[],
  hasTarget: boolean,
): InlineFindingView[] {
  const findings: InlineFindingView[] = [];
  if (issue && issue.status === "open") {
    findings.push({
      id: issue.id,
      code: issue.ruleId,
      message: issue.message,
      severity:
        issue.severity === "error"
          ? "error"
          : issue.severity === "warning"
            ? "warning"
            : "info",
      source: "qa",
      canLocate: true,
      canIgnore: true,
    });
  }
  if (hasTarget) {
    for (const tagIssue of tagIssues) {
      findings.push({
        id: `tag:${tagIssue.code}:${tagIssue.tagId ?? "all"}`,
        code: tagIssue.code,
        message: tagIssue.message,
        severity:
          tagIssue.code === "tag_missing" ||
          tagIssue.code === "tag_pair_incomplete"
            ? "error"
            : "warning",
        source: "tag",
        canLocate: Boolean(tagIssue.tagId),
        canIgnore: false,
      });
    }
  }
  return findings;
}

function tagSignature(tag: InlineTag): string {
  return [tag.kind, tag.pairId ?? "", tag.payload, tag.displayText].join("\0");
}

export function cellId(segmentId: string, column: GridColumn): string {
  return `seg-cell-${segmentId}-${column}`;
}

export function rowId(segmentId: string): string {
  return `seg-row-${segmentId}`;
}

/** Re-export segment type for view builders. */
export type { Segment };
