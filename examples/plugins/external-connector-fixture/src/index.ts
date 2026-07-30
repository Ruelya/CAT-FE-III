#!/usr/bin/env node

/**
 * Deterministic public-SDK-only external connector fixture.
 * No paid service or internet dependency is required.
 */

import {
  ExternalConnectorHandlerError,
  startProcessExternalConnector,
  type ExternalConnectorHandlerV1,
  type ExternalConnectorInvocationContextV1,
  type ExternalConnectorRequestV1,
  type PluginManifestV2,
} from "@translunar/plugin-sdk";

import manifestJson from "../manifest.json" with { type: "json" };

const CONTRIBUTION_ID = "example.external-connector-fixture.system";
const FIXTURE_SECRET = "fixture-token-not-for-production";
const manifest = manifestJson as PluginManifestV2;

function scenarioOf(request: ExternalConnectorRequestV1): string {
  const value = request.config.scenario;
  return typeof value === "string" ? value : "success";
}

function requireToken(context: ExternalConnectorInvocationContextV1): void {
  const token = context.credentials.apiToken;
  if (!token || token !== FIXTURE_SECRET) {
    throw new ExternalConnectorHandlerError({
      contractVersion: 1,
      requestId: "unknown",
      code: "authentication",
      message: "authentication failed",
      retryable: false,
    });
  }
}

const handler: ExternalConnectorHandlerV1 = {
  async validateConfig(request) {
    return {
      operation: "validateConfig",
      valid: true,
      issues: [],
    };
  },
  async test(request, context) {
    const scenario = scenarioOf(request);
    if (scenario === "auth") {
      throw new ExternalConnectorHandlerError({
        contractVersion: 1,
        requestId: request.requestId,
        code: "authentication",
        message: "authentication failed",
        retryable: false,
      });
    }
    requireToken(context);
    return {
      operation: "test",
      ok: true,
      latencyMs: 1,
      message: "ok",
    };
  },
  async pull(request, context) {
    requireToken(context);
    const scenario = scenarioOf(request);
    if (scenario === "rate") {
      throw new ExternalConnectorHandlerError({
        contractVersion: 1,
        requestId: request.requestId,
        code: "rateLimit",
        message: "rate limited",
        retryable: true,
        retryAfterMs: 1000,
      });
    }
    const items =
      scenario === "empty"
        ? []
        : [
            {
              externalId: "item-1",
              externalRevision: "1",
              sourceLocale: "en",
              targetLocale: "zh",
              sourceText: "hello",
              targetText: "你好",
            },
          ];
    return {
      operation: "pull",
      items,
      hasMore: scenario === "page",
      nextCursor: scenario === "page" ? "cursor-2" : undefined,
      checkpoint: {
        streamId: request.payload.streamId,
        schemaVersion: 1,
        payload: { cursor: request.payload.cursor ?? "c1" },
        cursor: request.payload.cursor ?? "c1",
      },
    };
  },
  async push(request, context) {
    requireToken(context);
    return {
      operation: "push",
      receipts: request.payload.items.map((item) => ({
        externalId: item.externalId,
        accepted: true,
        remoteRevision: "r1",
      })),
      checkpoint: {
        streamId: request.payload.streamId,
        schemaVersion: 1,
        payload: { pushed: request.payload.items.length },
      },
    };
  },
  async poll(request, context) {
    requireToken(context);
    return {
      operation: "poll",
      items:
        scenarioOf(request) === "empty"
          ? []
          : [
              {
                externalId: "poll-1",
                sourceLocale: "en",
                targetLocale: "zh",
                sourceText: "polled",
              },
            ],
      hasMore: false,
      checkpoint: {
        streamId: request.payload.streamId,
        schemaVersion: 1,
        payload: { polled: true },
        cursor: "poll-c1",
      },
    };
  },
  async webhook(request, context) {
    requireToken(context);
    return {
      operation: "webhook",
      items: [
        {
          externalId: request.payload.eventId,
          sourceLocale: "en",
          targetLocale: "zh",
          sourceText: "webhook",
        },
      ],
      hasMore: false,
      checkpoint: {
        streamId: request.payload.streamId,
        schemaVersion: 1,
        payload: { eventId: request.payload.eventId },
      },
    };
  },
  async cancel() {},
  async shutdown() {},
};

startProcessExternalConnector({
  manifest,
  contributionId: CONTRIBUTION_ID,
  handler,
});
