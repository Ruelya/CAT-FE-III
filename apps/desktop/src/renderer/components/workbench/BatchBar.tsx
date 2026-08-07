/**
 * 36px multi-selection batch plate. Emits intent only.
 *
 * Source: docs/design-ii/screens/workbench.md §3.6
 */

import type {
  BatchActionDescriptor,
  BatchActionId,
} from "./segmentTypes";

export interface BatchBarProps {
  selectedCount: number;
  hiddenCount?: number;
  selectedLabel: string;
  hiddenLabel?: string;
  actions: BatchActionDescriptor[];
  onAction: (id: BatchActionId) => void;
}

export function BatchBar({
  selectedCount,
  hiddenCount = 0,
  selectedLabel,
  hiddenLabel,
  actions,
  onAction,
}: BatchBarProps) {
  if (selectedCount < 2) return null;

  return (
    <div
      className="batch-bar"
      role="toolbar"
      aria-label={selectedLabel}
      data-batch-bar=""
    >
      <span className="batch-bar__count">
        {selectedLabel}
        {hiddenCount > 0 && hiddenLabel ? (
          <span className="batch-bar__hidden"> {hiddenLabel}</span>
        ) : null}
      </span>
      <div className="batch-bar__actions">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={
              action.destructive
                ? "batch-bar__btn batch-bar__btn--danger"
                : "batch-bar__btn"
            }
            disabled={!action.enabled}
            data-batch-action={action.id}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
