import { CaretLeft, CaretRight } from "@phosphor-icons/react";

export interface PanelChromeProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}

export function PanelChrome({ title, collapsed, onToggle }: PanelChromeProps) {
  return (
    <div className="tm-panel__chrome">
      {!collapsed ? <h2 className="tm-panel__title">{title}</h2> : <span />}
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label={
          collapsed ? "Expand exact TM panel" : "Collapse exact TM panel"
        }
        title={collapsed ? "Expand exact TM panel" : "Collapse exact TM panel"}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? (
          <CaretLeft size={16} weight="bold" />
        ) : (
          <CaretRight size={16} weight="bold" />
        )}
      </button>
    </div>
  );
}
