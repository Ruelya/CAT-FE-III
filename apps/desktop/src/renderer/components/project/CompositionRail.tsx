import type { ReactNode } from "react";

import { BrandMark } from "../../BrandMark";

export interface CompositionRailProps {
  /** Primary brand line (app or wizard name). */
  title: string;
  /** Secondary meta under brand. */
  subtitle?: string;
  /** Main rail body: inert field, summary, stepper, etc. */
  children?: ReactNode;
  /** Bottom meta row (refresh, last loaded). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Shared 35%/30% composition rail: brand plate + body + optional footer.
 * Decorative matrix field is pure CSS; no live data invention.
 */
export function CompositionRail({
  title,
  subtitle,
  children,
  footer,
  className,
}: CompositionRailProps) {
  return (
    <aside
      className={["composition-rail", className].filter(Boolean).join(" ")}
      aria-label={title}
    >
      <div className="composition-rail__brand brand-plate">
        <BrandMark />
        <div className="composition-rail__identity">
          <strong className="composition-rail__title">{title}</strong>
          {subtitle ? (
            <span className="composition-rail__subtitle">{subtitle}</span>
          ) : null}
        </div>
      </div>
      <div className="composition-rail__field" aria-hidden="true" />
      <div className="composition-rail__body">{children}</div>
      {footer ? (
        <div className="composition-rail__footer">{footer}</div>
      ) : null}
    </aside>
  );
}
