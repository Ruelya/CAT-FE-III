import type {
  EditorSegmentListParams,
  InlineTag,
  SegmentCounts,
  SegmentEditorRow,
} from "@translunar/contracts";

export type EditorListFilter = NonNullable<EditorSegmentListParams["filter"]>;

export const EDITOR_PAGE_LIMIT = 200;

export const EDITOR_LIST_FILTERS: readonly EditorListFilter[] = [
  "all",
  "untranslated",
  "draft",
  "confirmed",
  "issues",
  "tagged",
  "commented",
];

export interface EditorPageState {
  offset: number;
  limit: number;
  total: number;
  filter: EditorListFilter;
  query: string;
}

export function defaultEditorPage(total = 0): EditorPageState {
  return {
    offset: 0,
    limit: EDITOR_PAGE_LIMIT,
    total,
    filter: "all",
    query: "",
  };
}

export function resolveEditorPageRequest(
  current?: EditorPageState | null,
  patch?: Partial<EditorPageState>,
): EditorPageState {
  return {
    offset: Math.max(0, patch?.offset ?? current?.offset ?? 0),
    limit: Math.max(1, patch?.limit ?? current?.limit ?? EDITOR_PAGE_LIMIT),
    total: Math.max(0, patch?.total ?? current?.total ?? 0),
    filter: patch?.filter ?? current?.filter ?? "all",
    query: patch?.query ?? current?.query ?? "",
  };
}

/**
 * Document counts stay engine-owned. A page must not be summed as if it were
 * the whole file unless the page is the whole file.
 */
export function countsAfterPageLoad(
  rows: readonly SegmentEditorRow[],
  pageTotal: number,
  previous: SegmentCounts | null,
): SegmentCounts {
  if (pageTotal === rows.length) {
    let confirmed = 0;
    let draft = 0;
    let untranslated = 0;
    for (const row of rows) {
      const state = row.segment.state;
      if (state === "confirmed") confirmed += 1;
      else if (state === "draft") draft += 1;
      else untranslated += 1;
    }
    return {
      confirmed,
      draft,
      untranslated,
      total: rows.length,
      openIssues: previous?.openIssues ?? 0,
    };
  }
  if (previous && previous.total === pageTotal) return previous;
  return (
    previous ?? {
      confirmed: 0,
      draft: 0,
      untranslated: 0,
      total: pageTotal,
      openIssues: 0,
    }
  );
}

export type SourceRun =
  | { kind: "text"; text: string }
  | { kind: "tag"; tag: InlineTag };

/**
 * Interleave source text with structured tags at their engine positions.
 * Positions outside the string clamp to the ends. Does not invent tags.
 */
export function sourceRuns(
  text: string,
  tags: readonly InlineTag[],
): SourceRun[] {
  if (tags.length === 0) {
    return text.length > 0 ? [{ kind: "text", text }] : [];
  }
  const ordered = [...tags].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
  const runs: SourceRun[] = [];
  let cursor = 0;
  for (const tag of ordered) {
    const at = Math.min(Math.max(0, tag.position), text.length);
    if (at > cursor) {
      runs.push({ kind: "text", text: text.slice(cursor, at) });
    }
    runs.push({ kind: "tag", tag });
    cursor = at;
  }
  if (cursor < text.length) {
    runs.push({ kind: "text", text: text.slice(cursor) });
  }
  return runs;
}

/**
 * After confirm, stay on this engine page when the next row is here.
 * If this was the last visible row and the document has more, advance offset.
 */
export function pageAfterConfirm(input: {
  page: EditorPageState;
  rows: readonly SegmentEditorRow[];
  confirmedSegmentId: string;
}): { offset: number; focusSegmentId: string | null } {
  const index = input.rows.findIndex(
    (row) => row.segment.id === input.confirmedSegmentId,
  );
  if (index >= 0 && index + 1 < input.rows.length) {
    return {
      offset: input.page.offset,
      focusSegmentId: input.rows[index + 1]?.segment.id ?? null,
    };
  }
  if (input.page.offset + input.rows.length < input.page.total) {
    return {
      offset: input.page.offset + input.page.limit,
      focusSegmentId: null,
    };
  }
  return {
    offset: input.page.offset,
    focusSegmentId: input.confirmedSegmentId,
  };
}

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
