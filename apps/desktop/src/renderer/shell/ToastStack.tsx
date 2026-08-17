import type { ReactNode } from "react";

export type ToastTone = "info" | "success" | "danger";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  testId?: string;
  children: ReactNode;
}

export interface ToastStackProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * Transient workbench messages. They sit on the status line, not in the
 * document flow — import results and reuse notices must not push the grid.
 */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" data-testid="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.tone}`}
          role={toast.tone === "danger" ? "alert" : "status"}
          {...(toast.testId ? { "data-testid": toast.testId } : {})}
        >
          <div className="toast__body">{toast.children}</div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onDismiss(toast.id)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
