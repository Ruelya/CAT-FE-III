import { useEffect, useId, useRef, useState } from "react";

import { useLocale } from "../../i18n/LocaleProvider";
import type { DivergentTargetHit } from "./consistency-presenters";

export interface ConsistencyApplyResult {
  segmentId: string;
  ok: boolean;
  error?: string;
}

export interface ConsistencyRepairDrawerProps {
  open: boolean;
  term: string;
  hits: readonly DivergentTargetHit[];
  capped: boolean;
  applying: boolean;
  results: readonly ConsistencyApplyResult[];
  onClose(): void;
  onApply(selected: DivergentTargetHit[]): void;
  onCancelApply(): void;
}

export function ConsistencyRepairDrawer({
  open,
  term,
  hits,
  capped,
  applying,
  results,
  onClose,
  onApply,
  onCancelApply,
}: ConsistencyRepairDrawerProps) {
  const { t } = useLocale();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const hit of hits) next[hit.segmentId] = true;
    setSelected(next);
    closeRef.current?.focus();
  }, [open, hits]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (applying) onCancelApply();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, applying, onClose, onCancelApply]);

  if (!open) return null;

  const selectedHits = hits.filter((hit) => selected[hit.segmentId]);
  const resultById = new Map(results.map((r) => [r.segmentId, r]));
  const allSelected =
    hits.length > 0 && hits.every((hit) => selected[hit.segmentId]);

  return (
    <div
      className="consistency-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="consistency-drawer"
    >
      <header className="consistency-drawer__head">
        <div>
          <h2 id={titleId}>{t("ai.consistency.drawerTitle")}</h2>
          <p>
            {t("ai.consistency.drawerLead", { term, count: hits.length })}
          </p>
        </div>
        <button
          type="button"
          ref={closeRef}
          onClick={onClose}
          aria-label={t("common.close")}
        >
          {t("common.close")}
        </button>
      </header>
      <div className="consistency-drawer__body">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={applying || hits.length === 0}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              const next: Record<string, boolean> = {};
              for (const hit of hits) next[hit.segmentId] = checked;
              setSelected(next);
            }}
          />{" "}
          {t("ai.consistency.selectAll")}
        </label>
        {hits.map((hit) => {
          const result = resultById.get(hit.segmentId);
          return (
            <div
              key={hit.segmentId}
              className="consistency-row"
              data-failed={result && !result.ok ? "true" : undefined}
            >
              <input
                type="checkbox"
                checked={Boolean(selected[hit.segmentId])}
                disabled={applying}
                aria-label={t("ai.consistency.rowAria", {
                  ordinal: hit.ordinal + 1,
                })}
                onChange={(event) =>
                  setSelected((current) => ({
                    ...current,
                    [hit.segmentId]: event.currentTarget.checked,
                  }))
                }
              />
              <div>
                <strong>#{hit.ordinal + 1}</strong>
                <div className="consistency-row__pair">
                  <del>{hit.before || "—"}</del>
                  <ins>{hit.after}</ins>
                </div>
                {result && !result.ok ? (
                  <p role="alert">{result.error ?? t("ai.consistency.applyFailed")}</p>
                ) : null}
                {result?.ok ? (
                  <p role="status">{t("ai.consistency.applyOk")}</p>
                ) : null}
              </div>
            </div>
          );
        })}
        {capped ? (
          <p className="ai-usage-note" role="status">
            {t("ai.consistency.capped")}
          </p>
        ) : null}
        <p className="ai-usage-note" role="note">
          {t("ai.consistency.undoResidual")}
        </p>
      </div>
      <footer className="consistency-drawer__foot">
        {applying ? (
          <button type="button" onClick={onCancelApply}>
            {t("common.cancel")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={applying || selectedHits.length === 0}
          onClick={() => onApply(selectedHits)}
        >
          {t("ai.consistency.apply", { count: selectedHits.length })}
        </button>
      </footer>
    </div>
  );
}
