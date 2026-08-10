import { describe, expect, it } from "vitest";

import {
  buildExternalConnectorRequest,
  mergeUnknownConfig,
  parseBoundedJson,
} from "./external-connector-request";

const binding = {
  profileId: "prof-1",
  contributionId: "c1",
  pluginId: "plug",
  versionId: "v1",
  activationRevision: 3,
  configSchemaVersion: 1,
  checkpointSchemaVersion: 1,
  configuration: { region: "us" },
};

const ops = [
  "validateConfig",
  "test",
  "pull",
  "push",
  "poll",
  "webhook",
] as const;

describe("external-connector-request", () => {
  it("builds all six declared operations", () => {
    for (const operation of ops) {
      const form = {
        operation,
        requestId: `req-${operation}`,
        deadlineMs: 5000,
        streamId: "stream-1",
        limit: 10,
        itemsJson: "[]",
        eventId: "e1",
        eventType: "created",
        bodyJson: "{}",
      };
      const result = buildExternalConnectorRequest(binding, form, [...ops]);
      expect(result.ok, operation).toBe(true);
      if (result.ok) {
        expect(result.request.operation).toBe(operation);
        expect(result.request.requestId).toBe(`req-${operation}`);
        expect(result.request.binding.profileId).toBe("prof-1");
      }
    }
  });

  it("rejects undeclared operations and invalid inputs", () => {
    expect(
      buildExternalConnectorRequest(
        binding,
        {
          operation: "pull",
          requestId: "r1",
          deadlineMs: 1000,
          streamId: "s",
        },
        ["test"],
      ).ok,
    ).toBe(false);

    expect(
      buildExternalConnectorRequest(
        binding,
        { operation: "pull", requestId: "r1", deadlineMs: 1000 },
        ["pull"],
      ),
    ).toMatchObject({ ok: false });

    expect(parseBoundedJson("{", "x").ok).toBe(false);
    expect(parseBoundedJson('{"a":1}', "x")).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("preserves unknown config keys", () => {
    expect(mergeUnknownConfig({ keep: true, a: 1 }, { a: 2, b: 3 })).toEqual({
      keep: true,
      a: 2,
      b: 3,
    });
  });
});
