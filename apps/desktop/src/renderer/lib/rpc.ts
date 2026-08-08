import {
  PROTOCOL_VERSION,
  type EngineMethod,
  type EngineParams,
  type EngineResult,
} from "@translunar/contracts";

import { toUiError, type UiError } from "./errors";

export type RpcOutcome<T> =
  { ok: true; result: T } | { ok: false; error: UiError };

/** Typed Engine invoke adapter — sole generic Engine call path. */
export async function invokeEngine<Method extends EngineMethod>(
  method: Method,
  params: EngineParams<Method>,
): Promise<EngineResult<Method>> {
  return window.translunar.invoke(method, params);
}

/** Safe variant that never throws; returns a result envelope. */
export async function tryInvoke<Method extends EngineMethod>(
  method: Method,
  params: EngineParams<Method>,
): Promise<RpcOutcome<EngineResult<Method>>> {
  try {
    const result = await invokeEngine(method, params);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: toUiError(error) };
  }
}

export async function initializeEngine(): Promise<
  EngineResult<"engine.initialize">
> {
  return invokeEngine("engine.initialize", {
    protocolVersion: PROTOCOL_VERSION,
    client: {
      name: "translunar-desktop",
      version: "0.1.0",
    },
  });
}

export function desktopApi(): typeof window.translunar {
  return window.translunar;
}
