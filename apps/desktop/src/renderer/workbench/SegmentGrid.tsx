import type { KeyboardEvent } from "react";
import type { SegmentEditorRow } from "@translunar/contracts";

import { segmentNumber } from "../lib/format";
import type { SegmentEditState } from "../state/save-coordinator";
import { TargetEditor } from "./TargetEditor";

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
  onCompositionStart,
  onCompositionEnd,
  onConfirm,
  onApplyMatchByIndex,
}: SegmentGridProps) {
  if (rows.length === 0) {
    return (
      <div className="empty-state" data-testid="segments-empty">
        <h2 className="empty-state__title">No segments</h2>
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
                  <div className="segment-source">{row.segment.sourceText}</div>
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
                      {...(onApplyMatchByIndex ? { onApplyMatchByIndex } : {})}
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
  );
}
