import type { KeyboardEvent } from "react";
import type { EditorWorkflowState, InlineTag, SegmentEditorRow } from "@translunar/contracts";

import { segmentNumber } from "../lib/format";
import type { EditorDisplay } from "../lib/editor-display";
import { adjacentPlaceholderGroupAt, pairSourceTags } from "../lib/quickplace";
import {
  isOcrStructuralPath,
  structureLabel,
  structureTitle,
} from "../lib/structure-label";
import {
  caretOffsetsInTaggedEditor,
  mergeTargetTags,
  placeTagAtCaret,
  rememberTaggedClip,
  sliceTaggedSpan,
  tagAtomsInSelection,
  TAGGED_CLIPBOARD_TYPE,
  wrapSelectionWithTagPair,
} from "../lib/tagged-text";
import type { TextHighlight } from "../lib/term-source";
import type { SourceHighlight } from "./TaggedText";
import { readSegmentSelection } from "../state/editor-selection";
import type { SegmentEditState } from "../state/save-coordinator";
import {
  TargetEditor,
  type InlineCompletionBinding,
  type SuggestionBinding,
} from "./TargetEditor";
import { TaggedText } from "./TaggedText";

const WORKFLOW_LABEL: Record<EditorWorkflowState, string> = {
  translation: "Translation",
  review: "Review",
  signed: "Signed off",
};

export interface SegmentGridProps {
  rows: SegmentEditorRow[];
  activeSegmentId: string | null;
  focusSegmentId: string | null;
  /** Additional explicit selection for multi-segment ops (merge). */
  selectedSegmentIds?: string[];
  editState: SegmentEditState | null;
  disabled?: boolean;
  onSelect: (segmentId: string) => void;
  /** Ctrl/Meta click toggles multi-select membership. */
  onToggleSelect?: (segmentId: string) => void;
  onDraftChange: (text: string) => void;
  onTagsChange?: (tags: InlineTag[]) => void;
  onSetWorkflow?: (segmentId: string, state: EditorWorkflowState) => void;
  highlightedSegmentId?: string | null;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onConfirm: (event?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
    altKey?: boolean;
    shiftKey?: boolean;
  }) => void;
  onApplyMatchByIndex?: (index: number) => void;
  suggestions?: SuggestionBinding;
  inlineCompletion?: InlineCompletionBinding;
  quickPlaceOpen?: boolean;
  onQuickPlaceOpenChange?: (open: boolean) => void;
  onPlaceAllTags?: () => void;
  sourceHighlight?: SourceHighlight | null;
  onSourceHighlight?: (span: SourceHighlight | null) => void;
  /** Recognised terms in the active source, painted as red underlines. */
  termHighlights?: readonly TextHighlight[];
  protectTags?: boolean;
  onProtectTagsChange?: (next: boolean) => void;
  groupAdjacent?: boolean;
  onGroupAdjacentChange?: (next: boolean) => void;
  display?: EditorDisplay;
  /** Per-segment comment counts, for the row marker. */
  commentCounts?: Readonly<Record<string, number>>;
  /** Per-segment QA finding counts, for the row marker. */
  qaCounts?: Readonly<Record<string, number>>;
  /** Segments whose source text repeats elsewhere in this document. */
  repeatedSources?: ReadonlySet<string>;
  /** Shown instead of the table when a filter hides everything. */
  filtered?: boolean;
}

export function SegmentGrid({
  rows,
  activeSegmentId,
  focusSegmentId,
  selectedSegmentIds = [],
  editState,
  disabled,
  onSelect,
  onToggleSelect,
  onDraftChange,
  onTagsChange,
  onSetWorkflow,
  highlightedSegmentId,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onApplyMatchByIndex,
  suggestions,
  inlineCompletion,
  quickPlaceOpen,
  onQuickPlaceOpenChange,
  onPlaceAllTags,
  sourceHighlight,
  onSourceHighlight,
  termHighlights,
  protectTags,
  onProtectTagsChange,
  groupAdjacent,
  onGroupAdjacentChange,
  display,
  commentCounts,
  qaCounts,
  repeatedSources,
  filtered,
}: SegmentGridProps) {
  if (rows.length === 0) {
    return (
      <div className="empty-state" data-testid="segments-empty">
        <h2 className="empty-state__title">
          {filtered ? "No segments match the filter" : "No segments"}
        </h2>
        {filtered ? (
          <p className="empty-state__body">
            Clear the filter to see the rest of the document.
          </p>
        ) : null}
      </div>
    );
  }

  const activateRow = (segmentId: string, multi = false) => {
    if (disabled) return;
    if (multi && onToggleSelect) {
      onToggleSelect(segmentId);
      return;
    }
    if (segmentId === activeSegmentId) return;
    void onSelect(segmentId);
  };

  /**
   * Up and Down move between segments without leaving the grid, which is how
   * every CAT tool this product's users come from behaves. Enter and Space
   * activate. IME composition is not involved here because these controls are
   * buttons, not the target editor.
   */
  const onRowKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    segmentId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateRow(segmentId, event.ctrlKey || event.metaKey);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const index = rows.findIndex((row) => row.segment.id === segmentId);
    if (index === -1) return;
    const nextIndex = event.key === "ArrowDown" ? index + 1 : index - 1;
    const next = rows[nextIndex];
    if (!next) return;

    event.preventDefault();
    const target = document.querySelector<HTMLElement>(
      `[data-testid="segment-activate-${next.segment.id}"]`,
    );
    target?.focus();
  };

  return (
    <div className="segment-grid">
      <table className="segment-table">
        <colgroup>
          <col className="ordinal" />
          <col className="structure" />
          <col className="source" />
          <col className="target" />
          <col className="status" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="segment-table__ordinal">
              #
            </th>
            <th scope="col" className="segment-table__structure">
              Ctx
            </th>
            <th scope="col">Source</th>
            <th scope="col">Target</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = row.segment.id;
            const active = id === activeSegmentId;
            const multiSelected = selectedSegmentIds.includes(id);
            const displayTarget =
              active && editState?.segmentId === id
                ? editState.draftTarget
                : row.segment.targetText;
            const localLabel =
              active && editState?.segmentId === id
                ? editState.saveState === "saving"
                  ? "saving"
                  : editState.saveState === "error"
                    ? "save error"
                    : editState.editGeneration !== editState.savedGeneration
                      ? "dirty"
                      : null
                : null;
            const locked = row.workflowState === "signed";
            const rowDisabled = Boolean(disabled || locked);

            return (
              <tr
                key={id}
                className={[
                  active ? "segment-row--active" : "",
                  multiSelected ? "segment-row--selected" : "",
                  highlightedSegmentId === id ? "segment-row--hit" : "",
                  locked ? "segment-row--locked" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
                }
                data-testid={`segment-row-${id}`}
                aria-selected={active || multiSelected}
              >
                <td className="segment-table__ordinal">
                  <span className="segment-index">
                    {segmentNumber(row.segment.ordinal)}
                  </span>
                </td>
                <td
                  className="segment-table__structure"
                  title={structureTitle(row.segment.structuralPath)}
                >
                  <span className="segment-structure">
                    {structureLabel(row.segment.structuralPath)}
                  </span>
                </td>
                <td
                  onCopy={(event) => {
                    const root = event.currentTarget.querySelector(".segment-source");
                    if (!(root instanceof HTMLElement)) return;
                    const selection = event.currentTarget.ownerDocument.defaultView?.getSelection() ?? null;
                    const offsets = caretOffsetsInTaggedEditor(root, selection);
                    let clip = sliceTaggedSpan(
                      row.segment.sourceText,
                      row.sourceTags,
                      offsets.start,
                      offsets.end,
                    );
                    if (clip.text.length === 0 && clip.tags.length === 0) {
                      const atoms = tagAtomsInSelection(root, selection);
                      if (atoms.length === 0) return;
                      clip = {
                        text: "",
                        tags: atoms.map((tag, index) => ({
                          ...tag,
                          position: 0,
                          id: `clip:${index}:${tag.id}`,
                        })),
                      };
                    }
                    rememberTaggedClip(clip);
                    event.clipboardData?.setData("text/plain", clip.text);
                    event.clipboardData?.setData(
                      TAGGED_CLIPBOARD_TYPE,
                      JSON.stringify(clip),
                    );
                    event.preventDefault();
                  }}
                >
                  <TaggedText
                    className="segment-source"
                    text={row.segment.sourceText}
                    tags={row.sourceTags}
                    {...(active && sourceHighlight ? { highlight: sourceHighlight } : {})}
                    {...(active && termHighlights?.length
                      ? { highlights: termHighlights }
                      : {})}
                    {...(groupAdjacent ? { groupAdjacent } : {})}
                    {...(display ? { display } : {})}
                    {...(active && onTagsChange
                      ? {
                          onTagActivate: (tag: InlineTag) => {
                            const selection = readSegmentSelection(id);
                            if (groupAdjacent && tag.kind === "standalone") {
                              const group = adjacentPlaceholderGroupAt(
                                row.sourceTags,
                                tag.id,
                              );
                              if (group.length > 1) {
                                onTagsChange(
                                  mergeTargetTags(
                                    row.targetTags,
                                    group.map((item) =>
                                      placeTagAtCaret(item, selection.targetStart),
                                    ),
                                  ),
                                );
                                return;
                              }
                            }
                            const pair = pairSourceTags(row.sourceTags).pairs.find(
                              (item) =>
                                item.start.id === tag.id ||
                                item.end.id === tag.id,
                            );
                            if (pair) {
                              onTagsChange(
                                mergeTargetTags(
                                  row.targetTags,
                                  wrapSelectionWithTagPair(
                                    pair.start,
                                    pair.end,
                                    selection.targetStart,
                                    selection.targetEnd,
                                  ),
                                ),
                              );
                              return;
                            }
                            onTagsChange(
                              mergeTargetTags(row.targetTags, [
                                placeTagAtCaret(tag, selection.targetStart),
                              ]),
                            );
                          },
                        }
                      : {})}
                  />
                </td>
                <td>
                  {active ? (
                    <TargetEditor
                      segmentId={id}
                      value={displayTarget}
                      tags={row.targetTags}
                      editState={editState}
                      disabled={rowDisabled}
                      autoFocus={focusSegmentId === id}
                      confirmLabel={String(segmentNumber(row.segment.ordinal))}
                      onChange={onDraftChange}
                      {...(onTagsChange ? { onTagsChange } : {})}
                      onCompositionStart={onCompositionStart}
                      onCompositionEnd={onCompositionEnd}
                      onConfirm={(ev) => {
                        void onConfirm(ev);
                      }}
                      {...(onApplyMatchByIndex ? { onApplyMatchByIndex } : {})}
                      {...(suggestions ? { suggestions } : {})}
                      {...(inlineCompletion ? { inlineCompletion } : {})}
                      sourceText={row.segment.sourceText}
                      sourceTags={row.sourceTags}
                      {...(quickPlaceOpen !== undefined
                        ? { quickPlaceOpen }
                        : {})}
                      {...(onQuickPlaceOpenChange
                        ? { onQuickPlaceOpenChange }
                        : {})}
                      {...(onPlaceAllTags ? { onPlaceAllTags } : {})}
                      {...(onSourceHighlight ? { onSourceHighlight } : {})}
                      {...(protectTags !== undefined ? { protectTags } : {})}
                      {...(onProtectTagsChange ? { onProtectTagsChange } : {})}
                      {...(groupAdjacent !== undefined ? { groupAdjacent } : {})}
                      {...(onGroupAdjacentChange ? { onGroupAdjacentChange } : {})}
                      {...(display ? { display } : {})}
                    />
                  ) : (
                    <button
                      type="button"
                      className="segment-target-activate"
                      data-testid={`segment-activate-${id}`}
                      disabled={disabled}
                      onClick={(event) =>
                        activateRow(id, event.ctrlKey || event.metaKey)
                      }
                      onKeyDown={(event) => onRowKeyDown(event, id)}
                      aria-label={`Edit segment ${segmentNumber(row.segment.ordinal)}`}
                      title={`Edit segment ${segmentNumber(row.segment.ordinal)}`}
                    >
                      <TaggedText
                        className="segment-source muted"
                        text={displayTarget || "-"}
                        tags={row.targetTags}
                        {...(display ? { display } : {})}
                      />
                    </button>
                  )}
                </td>
                <td>
                  {/* Marks say why a row deserves attention before any panel
                      is opened, which is what makes scanning a long document
                      possible at all. */}
                  <div className="segment-marks" aria-hidden="true">
                    {(qaCounts?.[id] ?? 0) > 0 ? (
                      <span
                        className="segment-mark segment-mark--qa"
                        title={`${qaCounts?.[id]} quality findings`}
                        data-testid={`mark-qa-${id}`}
                      />
                    ) : null}
                    {(commentCounts?.[id] ?? 0) > 0 ? (
                      <span
                        className="segment-mark segment-mark--comment"
                        title={`${commentCounts?.[id]} comments`}
                        data-testid={`mark-comment-${id}`}
                      />
                    ) : null}
                    {repeatedSources?.has(row.segment.sourceText.trim()) ? (
                      <span
                        className="segment-mark segment-mark--repeat"
                        title="This source text repeats in this document"
                        data-testid={`mark-repeat-${id}`}
                      />
                    ) : null}
                    {isOcrStructuralPath(row.segment.structuralPath) ? (
                      <span
                        className="segment-mark segment-mark--ocr"
                        title="This source came from OCR"
                        data-testid={`mark-ocr-${id}`}
                      />
                    ) : null}
                  </div>
                  <div className="segment-status">
                    <span
                      className={`status-chip status-chip--${row.segment.state}`}
                    >
                      {row.segment.state === "untranslated"
                        ? "Open"
                        : row.segment.state === "draft"
                          ? "Draft"
                          : row.segment.state === "confirmed"
                            ? "Confirmed"
                            : row.segment.state}
                    </span>
                    {onSetWorkflow ? (
                      <label className="segment-workflow">
                        <span className="sr-only">
                          Workflow for segment {segmentNumber(row.segment.ordinal)}
                        </span>
                        <select
                          className="segment-workflow__select"
                          data-testid={`workflow-${id}`}
                          value={row.workflowState}
                          disabled={Boolean(disabled)}
                          onChange={(event) =>
                            onSetWorkflow(
                              id,
                              event.target.value as EditorWorkflowState,
                            )
                          }
                        >
                          <option value="translation">Translation</option>
                          <option value="review">Review</option>
                          <option value="signed">Signed off</option>
                        </select>
                      </label>
                    ) : (
                      <span
                        className={`status-chip status-chip--workflow status-chip--${row.workflowState}`}
                      >
                        {WORKFLOW_LABEL[row.workflowState]}
                      </span>
                    )}
                    {locked ? (
                      <span
                        className="status-chip status-chip--locked"
                        data-testid={`mark-locked-${id}`}
                      >
                        Locked
                      </span>
                    ) : null}
                    {localLabel ? (
                      <span className="status-chip status-chip--local">
                        {localLabel}
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
