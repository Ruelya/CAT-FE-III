/** Renderer projection of Engine / bridge failures. */

export interface UiError {
  code: string;
  message: string;
  details?: unknown;
  kind: "domain" | "transport" | "cancel" | "unknown";
}

export function isDesktopEngineError(
  value: unknown,
): value is { code: string; message: string; data?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && typeof record.message === "string";
}

export function toUiError(
  error: unknown,
  fallbackMessage = "Request failed",
): UiError {
  if (isDesktopEngineError(error)) {
    const code = error.code;
    const kind =
      code === "ENGINE_DISCONNECTED" ||
      code === "ENGINE_UNAVAILABLE" ||
      code === "TRANSPORT" ||
      code.includes("DISCONNECT")
        ? "transport"
        : "domain";
    return {
      code,
      message: error.message || fallbackMessage,
      details: error.data,
      kind,
    };
  }
  if (error instanceof Error) {
    return {
      code: "RENDERER_ERROR",
      message: error.message || fallbackMessage,
      kind: "unknown",
    };
  }
  return {
    code: "UNKNOWN",
    message: fallbackMessage,
    details: error,
    kind: "unknown",
  };
}

export function formatUiError(error: UiError): string {
  return error.code ? `${error.message} (${error.code})` : error.message;
}

function readErrorDataField(
  details: unknown,
  key: string,
): string | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Structured AI error formatter keyed by stable Engine code/data.
 * Never interpolates secrets — only stable identifiers and catalog messages.
 */
export function formatAiError(error: UiError): string {
  const profileId = readErrorDataField(error.details, "profileId");
  if (error.code === "policy_denied" || error.code.includes("POLICY")) {
    const policy = readErrorDataField(error.details, "policy") ?? error.message;
    const parts = [`Policy denied: ${policy}`];
    if (profileId) parts.push(`profile ${profileId}`);
    parts.push(`(${error.code})`);
    return parts.join(" · ");
  }
  if (profileId) {
    return `${error.message} · profile ${profileId} (${error.code})`;
  }
  return formatUiError(error);
}
