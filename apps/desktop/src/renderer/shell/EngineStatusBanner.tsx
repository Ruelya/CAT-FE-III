import type { EngineConnectionStatus } from "../state/app-state";

export interface EngineStatusBannerProps {
  status: EngineConnectionStatus;
  message: string | null;
  onRetry?: () => void;
  onRestart?: () => void;
}

export function EngineStatusBanner({
  status,
  message,
  onRetry,
  onRestart,
}: EngineStatusBannerProps) {
  if (status === "connected" || status === "unknown") return null;

  const label =
    status === "connecting"
      ? "Connecting"
      : status === "reconnecting"
        ? "Reconnecting"
        : status === "disconnected"
          ? "Disconnected"
          : "Engine failed";

  return (
    <div
      className={`engine-status engine-status--${status}`}
      role="status"
      aria-live="polite"
      data-testid="engine-status"
    >
      <span>
        {label}
        {message ? `: ${message}` : ""}
      </span>
      <span className="engine-status__actions">
        {onRetry ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onRetry}
          >
            Retry
          </button>
        ) : null}
        {onRestart ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onRestart}
          >
            Restart
          </button>
        ) : null}
      </span>
    </div>
  );
}
