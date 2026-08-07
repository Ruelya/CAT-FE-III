import {
  useCallback,
  useId,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { ActiveAxis } from "../workbench/ActiveAxis";

export type InsightsTabId =
  | "overview"
  | "files"
  | "analysis"
  | "assets"
  | "alignment"
  | "interop"
  | "reimport"
  | "task-packages"
  | "discussions"
  | "plugins"
  | "archive"
  | "history";

export interface InsightsTabItem {
  id: InsightsTabId;
  label: string;
  icon?: ReactNode;
}

export interface InsightsTabGroup {
  /** Non-interactive micro group header; omit for leading ungrouped items. */
  label?: string;
  items: readonly InsightsTabItem[];
}

export interface InsightsTabListProps {
  groups: readonly InsightsTabGroup[];
  active: InsightsTabId;
  onChange(id: InsightsTabId): void;
  ariaLabel: string;
}

/**
 * §E3 vertical Tab List (~180px) with optional group labels.
 */
export function InsightsTabList({
  groups,
  active,
  onChange,
  ariaLabel,
}: InsightsTabListProps) {
  const baseId = useId();
  const flat = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const index = flat.findIndex((item) => item.id === active);
      if (index < 0) return;
      let next = index;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        next = (index + 1) % flat.length;
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        next = (index - 1 + flat.length) % flat.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = flat.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      onChange(flat[next]!.id);
      const el = event.currentTarget.querySelector<HTMLElement>(
        `[data-tab-id="${flat[next]!.id}"]`,
      );
      el?.focus();
    },
    [active, flat, onChange],
  );

  return (
    <div
      className="insights-tablist"
      role="tablist"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.label ?? `group-${groupIndex}`}
          className="insights-tablist__group"
        >
          {group.label ? (
            <div className="insights-tab-group-label" role="presentation">
              {group.label}
            </div>
          ) : null}
          {group.items.map((item) => {
            const selected = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${baseId}-${item.id}`}
                data-tab-id={item.id}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className="insights-tablist__tab"
                onClick={() => onChange(item.id)}
              >
                {selected ? <ActiveAxis variant="row" /> : null}
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
