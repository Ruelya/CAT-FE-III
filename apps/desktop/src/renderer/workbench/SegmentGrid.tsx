import type { KeyboardEvent } from "react";
import type { SegmentEditorRow } from "@translunar/contracts";

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
  }) => void;
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
}: SegmentGridProps) {
  if (rows.length === 0) {
    return <div className="empty-state">No segments</div>;
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

  const onRowKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    segmentId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateRow(segmentId, event.ctrlKey || event.metaKey);
    }
  };

  return (
    <div className="segment-grid">
      <table className="segment-table">
        <colgroup>
          <col className="source" />
          <col className="target" />
          <col className="status" />
        </colgroup>
        <thead>
          <tr>
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
                      aria-label={`Edit segment ${row.segment.ordinal}`}
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
