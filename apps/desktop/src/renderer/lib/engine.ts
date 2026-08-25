import type {
  EngineMethod,
  EngineParams,
  EngineResult,
} from "@translunar/contracts";

export class EngineClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
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
    throw new EngineClientError(response.error.code, response.error.message);
  }
  return response.result as EngineResult<Method>;
}

export function isAiNotConfigured(error: unknown): boolean {
  return error instanceof EngineClientError && error.code === "aiNotConfigured";
}

export function describeError(error: unknown): string {
  if (error instanceof EngineClientError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
