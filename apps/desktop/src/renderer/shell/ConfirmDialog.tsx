import { useEffect, useId, useRef } from "react";

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  error?: string | null;
  /** Optional labelled reason field (required non-empty when present). */
  reasonLabel?: string;
  reason?: string;
  onReasonChange?: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

/**
 * Accessible destructive confirmation: Cancel receives initial focus,
 * Escape cancels, focus is trapped within the dialog.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = true,
  pending = false,
  error = null,
  reasonLabel,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  testId = "confirm-dialog",
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement;
    restoreFocusRef.current = previous instanceof HTMLElement ? previous : null;
    cancelRef.current?.focus();
    return () => {
      const trigger = restoreFocusRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!pending) onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, pending]);

  const reasonRequired = Boolean(reasonLabel);
  const reasonEmpty = reasonRequired && !reason?.trim();

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid={testId}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <p id={bodyId} className="dialog__body">
          {body}
        </p>
        {reasonLabel ? (
          <div className="field">
            <label className="field__label" htmlFor="confirm-reason">
              {reasonLabel}
            </label>
            <input
              id="confirm-reason"
              className="field__control"
              value={reason ?? ""}
              disabled={pending}
              onChange={(e) => onReasonChange?.(e.target.value)}
              autoComplete="off"
            />
          </div>
        ) : null}
        {error ? <p className="field__error">{error}</p> : null}
        <div className="dialog__actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn--secondary"
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "btn btn--danger" : "btn btn--primary"}
            disabled={pending || reasonEmpty}
            onClick={onConfirm}
          >
            {pending ? "Working" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
