import { useCallback, useEffect, useState } from "react";

import type { WindowChromePlatform } from "../../shared/desktop-api";

export interface WindowChromeController {
  platform: WindowChromePlatform;
  maximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
}

/**
 * Owns trusted DesktopApi window-chrome calls for AppChrome.
 * Independent of domain mutation gating so controls stay available during boot/recovery.
 */
export function useWindowChrome(): WindowChromeController {
  const [platform, setPlatform] = useState<WindowChromePlatform>("custom");
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = window.translunar;
    setPlatform(api.getWindowChromePlatform());

    let cancelled = false;
    const refreshMaximized = (): void => {
      void api
        .isWindowMaximized()
        .then((value) => {
          if (!cancelled) setMaximized(value);
        })
        .catch(() => {
          // Retain last known state on OS-chrome errors.
        });
    };

    refreshMaximized();
    window.addEventListener("resize", refreshMaximized);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", refreshMaximized);
    };
  }, []);

  const minimize = useCallback(() => {
    void window.translunar.minimizeWindow().catch(() => {
      // Non-fatal OS-chrome path.
    });
  }, []);

  const toggleMaximize = useCallback(() => {
    void window.translunar
      .maximizeWindow()
      .then((value) => {
        setMaximized(value);
      })
      .catch(() => {
        // Retain last known state on OS-chrome errors.
      });
  }, []);

  const close = useCallback(() => {
    void window.translunar.closeWindow().catch(() => {
      // Non-fatal OS-chrome path.
    });
  }, []);

  return {
    platform,
    maximized,
    minimize,
    toggleMaximize,
    close,
  };
}
