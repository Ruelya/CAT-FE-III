import { useCallback, useId, type KeyboardEvent, type ReactNode } from "react";

import { ActiveAxis } from "../workbench/ActiveAxis";

export type AssetsTabId =
  | "tm"
  | "terms"
  | "curation"
  | "alignment"
  | "interop";

export interface AssetsTabItem {
  id: AssetsTabId;
  label: string;
  count?: number;
  icon?: ReactNode;
}

export interface AssetsTabListProps {
  tabs: readonly AssetsTabItem[];
  active: AssetsTabId;
  onChange(id: AssetsTabId): void;
  ariaLabel: string;
}

/** §E2 horizontal Tabs (≤5) for Assets surface. */
export function AssetsTabList({
  tabs,
  active,
  onChange,
  ariaLabel,
}: AssetsTabListProps) {
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
      className="assets-tablist"
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
            className="assets-tablist__tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.icon}
            <span className="assets-tablist__label">
              {tab.label}
              {tab.count !== undefined ? (
                <span className="assets-tablist__count num"> {tab.count}</span>
              ) : null}
            </span>
            {selected ? <ActiveAxis variant="chip" /> : null}
          </button>
        );
      })}
    </div>
  );
}
