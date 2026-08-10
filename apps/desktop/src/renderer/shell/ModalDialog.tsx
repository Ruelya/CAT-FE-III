import { useEffect, useId, useRef, type ReactNode } from "react";

export interface ModalDialogProps {
  title: string;
  children: ReactNode;
  pending?: boolean;
  onCancel: () => void;
  testId?: string;
  /** Accessible role: dialog for forms, alertdialog for destructive. */
  role?: "dialog" | "alertdialog";
  /** Element to focus on open; defaults to the Cancel button. */
  initialFocus?: "cancel" | "first";
  actions: ReactNode;
}

/**
 * Shared modal: captures prior focus, traps Tab, Escape cancels when safe,
 * restores the trigger on unmount.
 */
export function ModalDialog({
  title,
  children,
  pending = false,
  onCancel,
  testId = "modal-dialog",
  role = "dialog",
  initialFocus = "cancel",
  actions,
}: ModalDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement;
    restoreFocusRef.current = previous instanceof HTMLElement ? previous : null;
    if (initialFocus === "cancel") {
      cancelRef.current?.focus();
    } else {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }
    return () => {
      const trigger = restoreFocusRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [initialFocus]);

  useEffect(() => {
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

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        {children}
        <div className="dialog__actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn--secondary"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}
