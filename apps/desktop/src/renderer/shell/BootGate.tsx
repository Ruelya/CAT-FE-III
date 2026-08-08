import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";

export interface BootGateProps {
  message?: string;
  error?: UiError | null;
  onRetry?: () => void;
  onRestart?: () => void;
}

export function BootGate({
  message,
  error,
  onRetry,
  onRestart,
}: BootGateProps) {
  return (
    <div
      className="boot-gate"
      data-testid="boot-gate"
      role="status"
      aria-live="polite"
    >
      <p className="boot-gate__title">
        {error ? "Startup failed" : "Starting"}
      </p>
      <p className="muted">
        {error ? formatUiError(error) : (message ?? "Loading")}
      </p>
      {error ? (
        <div className="engine-status__actions">
          {onRetry ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : null}
          {onRestart ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onRestart}
            >
              Restart
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
