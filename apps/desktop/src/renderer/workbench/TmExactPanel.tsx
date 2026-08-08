import { useEffect, useRef } from "react";
import type { TmEntry } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { PanelChrome } from "./PanelChrome";

export interface TmExactPanelProps {
  collapsed: boolean;
  matches: TmEntry[];
  loading: boolean;
  error: UiError | null;
  onToggle: () => void;
}

export function TmExactPanel({
  collapsed,
  matches,
  loading,
  error,
  onToggle,
}: TmExactPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasCollapsed = useRef(collapsed);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (collapsed) {
      body.setAttribute("inert", "");
      body.setAttribute("aria-hidden", "true");
    } else {
      body.removeAttribute("inert");
      body.removeAttribute("aria-hidden");
    }
  }, [collapsed]);

  // Focus handoff: after collapse, focus lands on expand control (PanelChrome button).
  useEffect(() => {
    if (wasCollapsed.current !== collapsed) {
      wasCollapsed.current = collapsed;
      // PanelChrome owns the toggle; requestAnimationFrame so DOM class applies first.
      requestAnimationFrame(() => {
        const toggle = document.querySelector<HTMLButtonElement>(
          '[data-testid="tm-panel"] button[aria-expanded]',
        );
        toggle?.focus();
      });
    }
  }, [collapsed]);

  return (
    <aside
      className={`tm-panel${collapsed ? " tm-panel--collapsed" : ""}`}
      data-testid="tm-panel"
    >
      <PanelChrome title="Exact TM" collapsed={collapsed} onToggle={onToggle} />
      <div ref={bodyRef} className="tm-panel__body">
        {loading ? <p className="muted">Loading</p> : null}
        {error ? <p className="error-text">{formatUiError(error)}</p> : null}
        {!loading && !error && matches.length === 0 ? (
          <p className="muted">No exact matches</p>
        ) : null}
        {matches.map((match) => (
          <article key={match.id} className="tm-match">
            <p className="tm-match__target">{match.targetText}</p>
            <p className="tm-match__meta">exact</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
