import type {
  EditorSegmentListParams,
  SegmentEditorRow,
} from "@translunar/contracts";

/**
 * View model a Swordfish-style bilingual grid can render.
 *
 * This is not Swordfish source. It is the mapping from
 * `segment.editor.list` rows onto the columns that grid needs.
 * Mutations still go through `segment.updateTarget` / `segment.confirm`
 * with `expectedRevision`. There is no new engine method here.
 */
export interface BilingualRowView {
  segmentId: string;
  documentId: string;
  ordinal: number;
  revision: number;
  state: SegmentEditorRow["segment"]["state"];
  workflowState: SegmentEditorRow["workflowState"];
  sourceText: string;
  targetText: string;
  sourceTagCount: number;
  targetTagCount: number;
  tagIssueCount: number;
  commentCount: number;
  hasOpenComments: boolean;
  filterHints: {
    untranslated: boolean;
    draft: boolean;
    confirmed: boolean;
    issues: boolean;
    tagged: boolean;
    commented: boolean;
  };
}

export function toBilingualRowView(row: SegmentEditorRow): BilingualRowView {
  const state = row.segment.state;
  const commentCount = row.comments.length;
  const tagIssueCount = row.tagIssues.length;
  const sourceTagCount = row.sourceTags.length;
  const targetTagCount = row.targetTags.length;
  return {
    segmentId: row.segment.id,
    documentId: row.segment.documentId,
    ordinal: row.segment.ordinal,
    revision: row.segment.revision,
    state,
    workflowState: row.workflowState,
    sourceText: row.segment.sourceText,
    targetText: row.segment.targetText,
    sourceTagCount,
    targetTagCount,
    tagIssueCount,
    commentCount,
    hasOpenComments: row.comments.some((comment) => !comment.resolved),
    filterHints: {
      untranslated: state === "untranslated",
      draft: state === "draft",
      confirmed: state === "confirmed",
      issues: tagIssueCount > 0,
      tagged: sourceTagCount > 0 || targetTagCount > 0,
      commented: commentCount > 0,
    },
  };
}

/**
 * Map a Swordfish-like page request onto `segment.editor.list`.
 *
 * Swordfish can combine several "show*" flags. The engine only accepts one
 * `filter` value. Combined flags collapse to `all`; the grid can narrow
 * locally from `filterHints`. Do not add an engine method for this.
 */
export function editorListParamsFromPage(input: {
  documentId: string;
  start: number;
  count: number;
  showUntranslated: boolean;
  showTranslated: boolean;
  showConfirmed: boolean;
  filterText?: string;
}): EditorSegmentListParams {
  const flags = [
    input.showUntranslated,
    input.showTranslated,
    input.showConfirmed,
  ];
  const enabled = flags.filter(Boolean).length;
  let filter: EditorSegmentListParams["filter"] = "all";
  if (enabled === 1) {
    if (input.showUntranslated) filter = "untranslated";
    else if (input.showTranslated) filter = "draft";
    else filter = "confirmed";
  }
  const query = input.filterText?.trim();
  return {
    documentId: input.documentId,
    offset: Math.max(0, input.start),
    limit: Math.max(1, input.count),
    sort: "ordinal",
    filter,
    ...(query ? { query, field: "both" as const } : {}),
  };
}
