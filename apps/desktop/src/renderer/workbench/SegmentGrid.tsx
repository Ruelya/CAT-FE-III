import type { KeyboardEvent } from "react";
import type { InlineTag, SegmentEditorRow } from "@translunar/contracts";

import {
  EDITOR_LIST_FILTERS,
  defaultEditorPage,
  sourceRuns,
  type EditorListFilter,
  type EditorPageState,
} from "../lib/bilingual-row-view";
import { segmentNumber } from "../lib/format";
import type { SegmentEditState } from "../state/save-coordinator";
import { TargetEditor } from "./TargetEditor";

export interface SegmentGridProps {
  rows: SegmentEditorRow[];
  page?: EditorPageState;
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
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onConfirm: (event?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  }) => void;
  onPage?: (offset: number) => void;
  onFilter?: (filter: EditorListFilter) => void;
}

function filterLabel(filter: EditorListFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "untranslated":
      return "Untranslated";
    case "draft":
      return "Draft";
    case "confirmed":
      return "Confirmed";
    case "issues":
      return "Issues";
    case "tagged":
      return "Tagged";
    case "commented":
      return "Commented";
  }
}

function SourceCell({
  text,
  tags,
}: {
  text: string;
  tags: readonly InlineTag[];
}) {
  const runs = sourceRuns(text, tags);
  if (runs.length === 0) {
    return <div className="segment-source">-</div>;
  }
  return (
    <div className="segment-source">
      {runs.map((run, index) =>
        run.kind === "text" ? (
          <span key={`t-${index}`}>{run.text}</span>
        ) : (
          <span
            key={run.tag.id}
            className={`source-tag source-tag--${run.tag.kind}`}
            title={run.tag.payload || run.tag.displayText}
          >
            {run.tag.displayText || run.tag.payload || run.tag.id}
          </span>
        ),
      )}
    </div>
  );
}

export function SegmentGrid({
  rows,
  page,
  activeSegmentId,
  focusSegmentId,
  selectedSegmentIds = [],
  editState,
  disabled,
  onSelect,
  onToggleSelect,
  onDraftChange,
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onPage,
  onFilter,
}: SegmentGridProps) {
  const editorPage = page ?? defaultEditorPage(rows.length);
  const { offset, limit, total, filter } = editorPage;

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
    <div className="segment-grid" data-testid="bilingual-grid">
      <div className="segment-grid__chrome">
        <label className="field field--inline segment-grid__filter">
          <span className="field__label">Show</span>
          <select
            className="field__control"
            data-testid="segment-filter"
            value={filter}
            disabled={disabled || !onFilter}
            aria-label="Segment filter"
            onChange={(event) => {
              onFilter?.(event.target.value as EditorListFilter);
            }}
          >
            {EDITOR_LIST_FILTERS.map((value) => (
              <option key={value} value={value}>
                {filterLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <div className="pagination" data-testid="segment-paging">
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            disabled={disabled || !onPage || offset <= 0}
            onClick={() => onPage?.(Math.max(0, offset - limit))}
          >
            Previous
          </button>
          <span className="pagination__count">
            {total === 0
              ? "0"
              : `${offset + 1}-${Math.min(offset + rows.length, total)}`}{" "}
            of {total}
          </span>
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            disabled={disabled || !onPage || offset + limit >= total}
            onClick={() => onPage?.(offset + limit)}
          >
            Next
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state" data-testid="segments-empty">
          <h2 className="empty-state__title">No segments</h2>
        </div>
      ) : (
        <div className="segment-grid__body">
        <table className="segment-table">
          <colgroup>
            <col className="ordinal" />
            <col className="source" />
            <col className="target" />
            <col className="status" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="segment-table__ordinal">
                #
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

              return (
                <tr
                  key={id}
                  className={
                    active
                      ? "segment-row--active"
                      : multiSelected
                        ? "segment-row--selected"
                        : undefined
                  }
                  data-testid={`segment-row-${id}`}
                  aria-selected={active || multiSelected}
                >
                  <td className="segment-table__ordinal">
                    <span className="segment-index">
                      {segmentNumber(row.segment.ordinal)}
                    </span>
                  </td>
                  <td>
                    <SourceCell
                      text={row.segment.sourceText}
                      tags={row.sourceTags}
                    />
                  </td>
                  <td>
                    {active ? (
                      <TargetEditor
                        segmentId={id}
                        value={displayTarget}
                        editState={editState}
                        disabled={disabled ?? false}
                        autoFocus={focusSegmentId === id}
                        onChange={onDraftChange}
                        onCompositionStart={onCompositionStart}
                        onCompositionEnd={onCompositionEnd}
                        onConfirm={(ev) => {
                          void onConfirm(ev);
                        }}
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
                      >
                        <span className="segment-source muted">
                          {displayTarget || "-"}
                        </span>
                      </button>
                    )}
                  </td>
                  <td>
                    <div className="segment-status">
                      <span
                        className={`status-chip status-chip--${row.segment.state}`}
                      >
                        {row.segment.state}
                      </span>
                      {localLabel ? (
                        <span className="status-chip status-chip--local">
                          {localLabel}
                        </span>
                      ) : null}
                      {row.sourceTags.length > 0 || row.targetTags.length > 0 ? (
                        <span className="status-chip">
                          {row.sourceTags.length + row.targetTags.length} tags
                        </span>
                      ) : null}
                      {active ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={
                            disabled ||
                            editState?.isComposing ||
                            editState?.saveState === "saving"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            void onConfirm();
                          }}
                          aria-label={`Confirm segment ${segmentNumber(row.segment.ordinal)}`}
                          title="Confirm (Ctrl+Enter)"
                        >
                          Confirm
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
