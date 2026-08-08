import { useEffect, useId, useRef } from "react";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";

export interface RecoveryDialogProps {
  mode: "recoverable" | "stale";
  reason?: string;
  error?: UiError | null;
  onRecover?: () => void;
  onDiscard: () => void;
  onRetry?: () => void;
}

export function RecoveryDialog({
  mode,
  reason,
  error,
  onRecover,
  onDiscard,
  onRetry,
}: RecoveryDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    primaryRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Non-destructive: Escape never discards; only closes focus action path.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="recovery-dialog"
      >
        <h2 id={titleId} className="dialog__title">
          {mode === "recoverable" ? "Recover draft" : "Draft unavailable"}
        </h2>
        <p className="dialog__body">
          {mode === "recoverable"
            ? "A pending target draft was found."
            : (reason ?? "The draft journal could not be restored.")}
        </p>
        {error ? <p className="error-text">{formatUiError(error)}</p> : null}
        <div className="dialog__actions">
          {mode === "recoverable" && onRecover ? (
            <>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onDiscard}
              >
                Discard
              </button>
              <button
                ref={primaryRef}
                type="button"
                className="btn btn--primary"
                onClick={onRecover}
                data-testid="recovery-primary"
              >
                Recover
              </button>
            </>
          ) : (
            <>
              {onRetry ? (
                <button
                  ref={primaryRef}
                  type="button"
                  className="btn btn--secondary"
                  onClick={onRetry}
                  data-testid="recovery-primary"
                >
                  Retry
                </button>
              ) : (
                <button
                  ref={primaryRef}
                  type="button"
                  className="btn btn--primary"
                  onClick={onDiscard}
                  data-testid="recovery-primary"
                >
                  Discard
                </button>
              )}
              {onRetry ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={onDiscard}
                >
                  Discard
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
