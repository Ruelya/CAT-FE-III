#!/usr/bin/env node
// Built entry is generated from src/index.ts when the package is compiled.
// For local smoke, re-export the TypeScript source via the SDK package resolution
// path used by the repository's connector example tests.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Minimal inline process host so the fixture can run without a separate build
// step when the TypeScript source is transpiled by the test harness.
import("../src/index.ts").catch(async () => {
  // Fallback for environments that only load .mjs: re-implement a tiny handler
  // using the published SDK surface after build.
  const sdk = await import("@translunar/plugin-sdk");
  const manifest = (
    await import("../manifest.json", { with: { type: "json" } })
  ).default;
  const FIXTURE_SECRET = "fixture-token-not-for-production";
  const handler = {
    async validateConfig() {
      return { operation: "validateConfig", valid: true, issues: [] };
    },
    async test(request, context) {
      if (context.credentials?.apiToken !== FIXTURE_SECRET) {
        throw new sdk.ExternalConnectorHandlerError({
          contractVersion: 1,
          requestId: request.requestId,
          code: "authentication",
          message: "authentication failed",
          retryable: false,
        });
      }
      return { operation: "test", ok: true, latencyMs: 1, message: "ok" };
    },
    async pull(request, context) {
      if (context.credentials?.apiToken !== FIXTURE_SECRET) {
        throw new sdk.ExternalConnectorHandlerError({
          contractVersion: 1,
          requestId: request.requestId,
          code: "authentication",
          message: "authentication failed",
          retryable: false,
        });
      }
      return {
        operation: "pull",
        items: [
          {
            externalId: "item-1",
            sourceLocale: "en",
            targetLocale: "zh",
            sourceText: "hello",
            targetText: "你好",
          },
        ],
        hasMore: false,
        checkpoint: {
          streamId: request.payload.streamId,
          schemaVersion: 1,
          payload: { cursor: "c1" },
          cursor: "c1",
        },
      };
    },
    async push(request, context) {
      if (context.credentials?.apiToken !== FIXTURE_SECRET) {
        throw new sdk.ExternalConnectorHandlerError({
          contractVersion: 1,
          requestId: request.requestId,
          code: "authentication",
          message: "authentication failed",
          retryable: false,
        });
      }
      return {
        operation: "push",
        receipts: request.payload.items.map((item) => ({
          externalId: item.externalId,
          accepted: true,
        })),
      };
    },
    async poll(request, context) {
      if (context.credentials?.apiToken !== FIXTURE_SECRET) {
        throw new sdk.ExternalConnectorHandlerError({
          contractVersion: 1,
          requestId: request.requestId,
          code: "authentication",
          message: "authentication failed",
          retryable: false,
        });
      }
      return {
        operation: "poll",
        items: [],
        hasMore: false,
        checkpoint: {
          streamId: request.payload.streamId,
          schemaVersion: 1,
          payload: { polled: true },
        },
      };
    },
    async webhook(request, context) {
      if (context.credentials?.apiToken !== FIXTURE_SECRET) {
        throw new sdk.ExternalConnectorHandlerError({
          contractVersion: 1,
          requestId: request.requestId,
          code: "authentication",
          message: "authentication failed",
          retryable: false,
        });
      }
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
      };
    },
    async cancel() {},
    async shutdown() {},
  };
  sdk.startProcessExternalConnector({
    manifest,
    contributionId: "example.external-connector-fixture.system",
    handler,
  });
  void require;
});
