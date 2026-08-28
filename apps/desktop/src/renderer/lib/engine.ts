import type {
  EngineMethod,
  EngineParams,
  EngineResult,
} from "@translunar/contracts";

export class EngineClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** Structured payload from `RpcError.data`; undefined for most errors. */
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "EngineClientError";
  }
}

/** Typed request to the engine through the preload bridge. */
export async function callEngine<Method extends EngineMethod>(
  method: Method,
  params: EngineParams<Method>,
): Promise<EngineResult<Method>> {
  const response = await window.tl.invoke(method, params);
  if (!response.ok) {
    throw new EngineClientError(
      response.error.code,
      response.error.message,
      response.error.data,
    );
  }
  return response.result as EngineResult<Method>;
}

export function isAiNotConfigured(error: unknown): boolean {
  return error instanceof EngineClientError && error.code === "aiNotConfigured";
}

/**
 * The engine refused to clobber an existing export destination. The caller
 * may retry the same export with `overwrite: true` after an explicit user
 * confirmation.
 */
export function isExportBlocked(error: unknown): boolean {
  return error instanceof EngineClientError && error.code === "exportBlocked";
}

/** What the QA export gate reported when it refused an export. */
export interface QaGateBlock {
  openErrors: number;
  ruleIds: string[];
}

/**
 * The QA export gate refused (`exportBlocked` with `data.reason: "qaGate"`).
 * The caller may retry with `overrideQaGate: true` after an explicit user
 * decision. Returns the structured refusal, or null for every other error —
 * including the plain destination-exists `exportBlocked`.
 */
export function qaGateBlock(error: unknown): QaGateBlock | null {
  if (!(error instanceof EngineClientError) || error.code !== "exportBlocked") {
    return null;
  }
  const data = error.data as
    { reason?: unknown; openErrors?: unknown; ruleIds?: unknown } | undefined;
  if (!data || data.reason !== "qaGate") {
    return null;
  }
  return {
    openErrors: typeof data.openErrors === "number" ? data.openErrors : 0,
    ruleIds: Array.isArray(data.ruleIds)
      ? data.ruleIds.filter((rule): rule is string => typeof rule === "string")
      : [],
  };
}

/**
 * Transport-level failures where the request may never have reached the
 * engine (child not running, stdin write failed, or no response before the
 * timeout). For writes this means the change was NOT acknowledged and must
 * not be presented as saved.
 */
export function isEngineUnavailable(error: unknown): boolean {
  return (
    error instanceof EngineClientError &&
    (error.code === "engineDown" || error.code === "timeout")
  );
}

export function describeError(error: unknown): string {
  if (error instanceof EngineClientError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
