import { Copy, Minus, Square, X } from "@phosphor-icons/react";

import type { WindowChromePlatform } from "../../shared/desktop-api";

export interface WindowControlsProps {
  platform: WindowChromePlatform;
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/**
 * Custom window controls for non-macOS hosts.
 * macOS uses native traffic lights — this component renders nothing there.
 */
export function WindowControls({
  platform,
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps) {
  if (platform === "macos") {
    return null;
  }

  const maximizeLabel = maximized ? "Restore" : "Maximize";

  return (
    <div
      className="window-controls"
      data-testid="window-controls"
      data-maximized={maximized ? "true" : "false"}
    >
      <button
        type="button"
        className="window-controls__btn"
        aria-label="Minimize"
        title="Minimize"
        data-testid="window-control-minimize"
        onClick={onMinimize}
      >
        <Minus size={14} weight="bold" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="window-controls__btn"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        data-testid="window-control-maximize"
        onClick={onToggleMaximize}
      >
        {maximized ? (
          <Copy size={13} weight="bold" aria-hidden="true" />
        ) : (
          <Square size={12} weight="bold" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="window-controls__btn window-controls__btn--close"
        aria-label="Close"
        title="Close"
        data-testid="window-control-close"
        onClick={onClose}
      >
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
