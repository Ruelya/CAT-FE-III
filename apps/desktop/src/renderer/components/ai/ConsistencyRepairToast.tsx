import { useEffect } from "react";

import { useLocale } from "../../i18n/LocaleProvider";

export interface ConsistencyRepairToastProps {
  term: string;
  count: number;
  open: boolean;
  onView(): void;
  onDismiss(): void;
  /** Auto-dismiss ms when action present (default 8000). */
  durationMs?: number;
}

export function ConsistencyRepairToast({
  term,
  count,
  open,
  onView,
  onDismiss,
  durationMs = 8_000,
}: ConsistencyRepairToastProps) {
  const { t } = useLocale();

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => onDismiss(), durationMs);
    return () => window.clearTimeout(timer);
  }, [open, durationMs, onDismiss, term, count]);

  if (!open || count <= 0) return null;

  return (
    <div
      className="consistency-toast"
      role="status"
      aria-live="polite"
      data-testid="consistency-toast"
    >
      <span>
        {t("ai.consistency.toast", { term, count })}
      </span>
      <button type="button" onClick={onView}>
        {t("ai.consistency.view")}
      </button>
      <button type="button" onClick={onDismiss} aria-label={t("common.close")}>
        {t("common.close")}
      </button>
    </div>
  );
}
