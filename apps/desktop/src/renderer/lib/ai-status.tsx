/**
 * Centralized AI availability. One provider fetches `ai.status` and every
 * panel reads the same value instead of polling the engine on its own.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AiStatusResult } from "@translunar/contracts";

import { callEngine } from "./engine.js";

export interface AiAvailability {
  /** `null` until the first `ai.status` answer arrives. */
  status: AiStatusResult | null;
  /** True only when the engine confirmed a configured provider. */
  configured: boolean;
  /** Re-query the engine (e.g. after an engine restart). */
  refresh: () => Promise<void>;
  /** Push a fresh status straight from an `ai.configure` response. */
  setStatus: (status: AiStatusResult) => void;
}

const AiStatusContext = createContext<AiAvailability | null>(null);

export function AiStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AiStatusResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await callEngine("ai.status", {}));
    } catch {
      // The engine is unreachable; treat AI as unavailable, never pretend.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AiAvailability>(
    () => ({
      status,
      configured: status?.configured === true,
      refresh,
      setStatus,
    }),
    [status, refresh],
  );

  return (
    <AiStatusContext.Provider value={value}>
      {children}
    </AiStatusContext.Provider>
  );
}

export function useAiStatus(): AiAvailability {
  const value = useContext(AiStatusContext);
  if (!value) {
    throw new Error("useAiStatus must be used inside <AiStatusProvider>");
  }
  return value;
}
