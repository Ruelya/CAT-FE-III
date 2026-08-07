import type { ReactNode } from "react";

/**
 * Shared surface three-state presenters (§D5 / §D6 / §F5).
 * No circular spinners — skeleton or status text only.
 */

export interface SurfaceLoadingProps {
  label: string;
  /** Optional same-shape skeleton slots */
  children?: ReactNode;
  className?: string;
}

export function SurfaceLoading({
  label,
  children,
  className,
}: SurfaceLoadingProps) {
  return (
    <div
      className={["surface-state", "surface-state--loading", className]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="surface-state__skeleton" aria-hidden="true">
        {children ?? (
          <div className="surface-state__skeleton-lines">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      <span className="surface-state__label">{label}</span>
    </div>
  );
}

export interface SurfaceEmptyProps {
  title: string;
  body?: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

export function SurfaceEmpty({
  title,
  body,
  primaryAction,
  secondaryAction,
  className,
}: SurfaceEmptyProps) {
  return (
    <div
      className={["surface-state", "surface-state--empty", className]
        .filter(Boolean)
        .join(" ")}
      role="region"
      aria-label={title}
    >
      <h3 className="surface-state__title">{title}</h3>
      {body ? <p className="surface-state__body">{body}</p> : null}
      {primaryAction || secondaryAction ? (
        <div className="surface-state__actions">
          {primaryAction}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

export interface SurfaceErrorProps {
  /** What happened */
  what: string;
  /** Data safety note */
  safety?: string;
  /** Recovery action slot */
  recovery?: ReactNode;
  /** Collapsible technical detail */
  techDetail?: string;
  className?: string;
}

export function SurfaceError({
  what,
  safety,
  recovery,
  techDetail,
  className,
}: SurfaceErrorProps) {
  return (
    <div
      className={["surface-state", "surface-state--error", className]
        .filter(Boolean)
        .join(" ")}
      role="alert"
    >
      <p className="surface-state__what">{what}</p>
      {safety ? <p className="surface-state__safety">{safety}</p> : null}
      {recovery ? (
        <div className="surface-state__recovery">{recovery}</div>
      ) : null}
      {techDetail ? (
        <details className="surface-state__tech">
          <summary>Technical detail</summary>
          <pre>{techDetail}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** Inline busy affordance for buttons / toolbars — text only, no spinner. */
export function BusyLabel({ label }: { label: string }) {
  return (
    <span className="surface-busy-label" role="status" aria-live="polite">
      {label}
    </span>
  );
}
