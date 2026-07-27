#!/usr/bin/env node

import {
  EngineConnectorHandlerError,
  startProcessEngineConnector,
  validateEngineConnectorConfig,
  type EngineConnectorContributionDescriptorV1,
  type EngineConnectorFailureCodeV1,
  type EngineConnectorGenerateRequestV1,
  type EngineConnectorHandlerV1,
  type EngineConnectorInvocationContextV1,
  type EngineConnectorModelCatalogV1,
  type EngineConnectorUsageV1,
  type PluginManifestV2,
} from "@translunar/plugin-sdk";

import manifestJson from "../manifest.json" with { type: "json" };

const FIXTURE_ORIGIN = "http://127.0.0.1:43123";
const CONTRIBUTION_ID = "example.connector-handler-fixture.chat";
const manifest = manifestJson as PluginManifestV2;
const descriptor = manifest.contributions.find(
  (candidate): candidate is EngineConnectorContributionDescriptorV1 =>
    candidate.kind === "engineConnector" &&
    candidate.id === CONTRIBUTION_ID &&
    candidate.contractVersion === 1,
);

if (!descriptor) {
  throw new Error(
    "fixture manifest is missing its strict connector descriptor",
  );
}

function fail(
  requestId: string,
  code: EngineConnectorFailureCodeV1,
  message: string,
  retryable = false,
  retryAfterMs?: number,
): never {
  throw new EngineConnectorHandlerError({
    contractVersion: 1,
    requestId,
    code,
    message,
    retryable,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
}

function scenario(config: Record<string, string | boolean | number>): string {
  return typeof config.scenario === "string" ? config.scenario : "success";
}

function requestHeaders(
  context: EngineConnectorInvocationContextV1,
  fixtureScenario: string,
): HeadersInit {
  return {
    "content-type": "application/json",
    "x-fixture-scenario": fixtureScenario,
    ...(context.credential
      ? { authorization: `Bearer ${context.credential}` }
      : {}),
  };
}

function invocationSignals(
  context: EngineConnectorInvocationContextV1,
  deadlineMs: number,
): { signal: AbortSignal; timeout: AbortSignal } {
  const timeout = AbortSignal.timeout(deadlineMs);
  return {
    signal: AbortSignal.any([context.signal, timeout]),
    timeout,
  };
}

function mapStatus(requestId: string, response: Response): never {
  if (response.status === 401 || response.status === 403) {
    return fail(requestId, "authentication", "connector authentication failed");
  }
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(
      response.headers.get("retry-after") ?? "1",
      10,
    );
    const retryAfterMs = Number.isSafeInteger(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds, 0) * 1000, 120_000)
      : 1000;
    return fail(
      requestId,
      "rateLimit",
      "connector rate limit reached",
      true,
      retryAfterMs,
    );
  }
  if (response.status >= 500) {
    return fail(
      requestId,
      "unavailable",
      "connector service is unavailable",
      true,
    );
  }
  return fail(requestId, "protocol", "connector returned an invalid status");
}

async function fixtureFetch(
  requestId: string,
  path: string,
  init: RequestInit,
  context: EngineConnectorInvocationContextV1,
  deadlineMs: number,
): Promise<Response> {
  const { signal, timeout } = invocationSignals(context, deadlineMs);
  try {
    return await fetch(`${FIXTURE_ORIGIN}${path}`, { ...init, signal });
  } catch (error) {
    if (error instanceof EngineConnectorHandlerError) throw error;
    if (context.signal.aborted) {
      return fail(requestId, "cancelled", "connector request was cancelled");
    }
    if (timeout.aborted) {
      return fail(requestId, "timeout", "connector request timed out", true);
    }
    return fail(
      requestId,
      "unavailable",
      "connector service is unavailable",
      true,
    );
  }
}

function parseUsage(value: unknown): EngineConnectorUsageV1 | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  if (
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    !Number.isSafeInteger(totalTokens) ||
    (inputTokens as number) + (outputTokens as number) !== totalTokens
  ) {
    return undefined;
  }
  return {
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: totalTokens as number,
  };
}

async function* generate(
  request: EngineConnectorGenerateRequestV1,
  context: EngineConnectorInvocationContextV1,
) {
  const response = await fixtureFetch(
    request.requestId,
    "/v1/chat/completions",
    {
      method: "POST",
      headers: requestHeaders(context, scenario(request.config)),
      body: JSON.stringify({
        model: request.model,
        messages:
          request.messages.length > 0
            ? request.messages
            : [{ role: "user", content: request.sourceText }],
        source_locale: request.sourceLocale,
        target_locale: request.targetLocale,
        stream: true,
      }),
    },
    context,
    request.deadlineMs,
  );
  if (!response.ok) mapStatus(request.requestId, response);
  if (!response.body) {
    return fail(
      request.requestId,
      "protocol",
      "connector response has no body",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sequence = 0;
  let outputText = "";
  let usage: EngineConnectorUsageV1 | undefined;
  let finishReason: "stop" | "length" | "contentFilter" = "stop";
  let completed = false;

  try {
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value ?? new Uint8Array(), {
        stream: !part.done,
      });
      if (buffer.length > 64 * 1024) {
        return fail(
          request.requestId,
          "responseSize",
          "connector stream frame is oversized",
        );
      }
      const frames = buffer.replace(/\r\n/gu, "\n").split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          yield {
            kind: "completed" as const,
            contractVersion: 1 as const,
            requestId: request.requestId,
            sequence,
            result: {
              outputText,
              model: request.model,
              finishReason,
              ...(usage ? { usage } : {}),
            },
          };
          sequence += 1;
          completed = true;
          continue;
        }
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return fail(
            request.requestId,
            "protocol",
            "connector stream contains malformed JSON",
          );
        }
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const choice =
          typeof choices[0] === "object" && choices[0] !== null
            ? (choices[0] as Record<string, unknown>)
            : undefined;
        const delta =
          typeof choice?.delta === "object" && choice.delta !== null
            ? (choice.delta as Record<string, unknown>)
            : undefined;
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          outputText += delta.content;
          yield {
            kind: "delta" as const,
            contractVersion: 1 as const,
            requestId: request.requestId,
            sequence,
            text: delta.content,
          };
          sequence += 1;
        }
        if (choice?.finish_reason === "length") finishReason = "length";
        if (choice?.finish_reason === "content_filter") {
          finishReason = "contentFilter";
        }
        const nextUsage = parseUsage(payload.usage);
        if (nextUsage) {
          usage = nextUsage;
          yield {
            kind: "usage" as const,
            contractVersion: 1 as const,
            requestId: request.requestId,
            sequence,
            usage,
          };
          sequence += 1;
        }
      }
      if (part.done) break;
    }
  } catch (error) {
    if (error instanceof EngineConnectorHandlerError) throw error;
    if (context.signal.aborted) {
      return fail(
        request.requestId,
        "cancelled",
        "connector request was cancelled",
      );
    }
    return fail(
      request.requestId,
      "protocol",
      "connector stream could not be read",
    );
  } finally {
    reader.releaseLock();
  }
  if (!completed) {
    return fail(
      request.requestId,
      "protocol",
      "connector stream ended before completion",
    );
  }
}

const handler: EngineConnectorHandlerV1 = {
  validateConfig(request) {
    const errors = validateEngineConnectorConfig(
      descriptor.configSchema,
      request.config,
    );
    return {
      valid: errors.length === 0,
      issues: errors.map((message) => ({
        field: "configuration",
        code: "invalid",
        message,
      })),
    };
  },
  async test(request, context) {
    const response = await fixtureFetch(
      request.requestId,
      "/v1/models",
      {
        method: "GET",
        headers: requestHeaders(context, scenario(request.config)),
      },
      context,
      request.deadlineMs,
    );
    if (!response.ok) mapStatus(request.requestId, response);
    return {
      ok: true,
      latencyMs: 0,
      ...(request.model ? { model: request.model } : {}),
    };
  },
  async listModels(request, context): Promise<EngineConnectorModelCatalogV1> {
    const response = await fixtureFetch(
      request.requestId,
      "/v1/models",
      {
        method: "GET",
        headers: requestHeaders(context, scenario(request.config)),
      },
      context,
      request.deadlineMs,
    );
    if (!response.ok) mapStatus(request.requestId, response);
    return {
      models: [
        { id: "fixture-translate-1", displayName: "Fixture Translate 1" },
      ],
    };
  },
  generate,
  cancel() {
    // The SDK aborts the exact active invocation before calling this hook.
  },
  shutdown() {
    // The fixture owns no resources beyond each invocation.
  },
};

startProcessEngineConnector({
  manifest,
  contributionId: CONTRIBUTION_ID,
  handler,
});
