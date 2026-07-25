import type { ReactNode } from "react";

import { BrandMark } from "./BrandMark";

export type WorkbenchVisualStateKind = "loading" | "empty";
export type WorkbenchVisualStateVariant =
  "matches" | "assistant" | "preview" | "terms" | "qa" | "grid";

export interface WorkbenchVisualStateProps {
  kind: WorkbenchVisualStateKind;
  label: string;
  variant: WorkbenchVisualStateVariant;
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * A small, presentational state surface shared by Workbench resource panels.
 * Request ownership and recovery actions stay with the parent component.
 */
export function WorkbenchVisualState({
  kind,
  label,
  variant,
  action,
  children,
}: WorkbenchVisualStateProps) {
  return (
    <div
      className={`workbench-visual-state ${kind} state-${variant}`}
      data-state-kind={kind}
      data-state-variant={variant}
      role="status"
      aria-live="polite"
      aria-busy={kind === "loading" ? true : undefined}
      aria-label={label}
    >
      <div className="workbench-state-mark" aria-hidden="true">
        <BrandMark />
      </div>
      {kind === "loading" ? (
        <div className="workbench-state-skeleton" aria-hidden="true">
          {children ?? <StateSkeleton variant={variant} />}
        </div>
      ) : null}
      <span className="workbench-state-label">{label}</span>
      {action ? <div className="workbench-state-action">{action}</div> : null}
    </div>
  );
}

function StateSkeleton({ variant }: { variant: WorkbenchVisualStateVariant }) {
  if (variant === "preview") {
    return (
      <div className="state-skeleton-preview">
        <span className="state-skeleton-page" />
        <span className="state-skeleton-blocks">
          <i />
          <i />
          <i />
        </span>
      </div>
    );
  }
  if (variant === "assistant") {
    return (
      <div className="state-skeleton-assistant">
        <i />
        <i />
        <i />
      </div>
    );
  }
  if (variant === "grid") {
    return (
      <div className="state-skeleton-grid">
        <i />
        <i />
      </div>
    );
  }
  return (
    <div className="state-skeleton-lines">
      <i />
      <i />
      <i />
    </div>
  );
}
