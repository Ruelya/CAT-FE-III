import { useCallback, useId, type KeyboardEvent, type ReactNode } from "react";

import { ActiveAxis } from "../workbench/ActiveAxis";

export type HomeTabId = "projects" | "search" | "templates" | "recycle";

export interface HomeTabItem {
  id: HomeTabId;
  label: string;
  count?: number;
  icon?: ReactNode;
}

export interface HomeTabListProps {
  tabs: readonly HomeTabItem[];
  active: HomeTabId;
  onChange(id: HomeTabId): void;
  ariaLabel: string;
}

/**
 * §E2 horizontal Tabs (≤4 items) for Project Home content chrome.
 */
export function HomeTabList({
  tabs,
  active,
  onChange,
  ariaLabel,
}: HomeTabListProps) {
  const baseId = useId();

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const index = tabs.findIndex((tab) => tab.id === active);
      if (index < 0) return;
      let next = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (index + 1) % tabs.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = tabs.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      onChange(tabs[next]!.id);
      const el = event.currentTarget.querySelector<HTMLElement>(
        `[data-tab-id="${tabs[next]!.id}"]`,
      );
      el?.focus();
    },
    [active, onChange, tabs],
  );

  return (
    <div
      className="home-tablist"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-${tab.id}`}
            data-tab-id={tab.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="home-tablist__tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.icon}
            <span className="home-tablist__label">
              {tab.label}
              {tab.count !== undefined ? (
                <span className="home-tablist__count num"> {tab.count}</span>
              ) : null}
            </span>
            {selected ? <ActiveAxis variant="chip" /> : null}
          </button>
        );
      })}
    </div>
  );
}
