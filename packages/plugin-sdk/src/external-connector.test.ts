import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  defineExternalConnector,
  defaultExternalConnectorLimits,
  validateExternalConnectorDescriptor,
  verifyHmacSha256WebhookSignature,
  EXTERNAL_CONNECTOR_PROTOCOL_V1,
} from "./external-connector.js";

describe("external connector SDK", () => {
  it("defines a strict executable descriptor", () => {
    const descriptor = defineExternalConnector({
      id: "example.external",
      version: "1.0.0",
      displayName: "Example",
      transports: ["http"],
      checkpointVersion: 1,
      capabilities: { pull: true },
      operations: ["validateConfig", "test", "pull", "push"],
      origins: ["http://127.0.0.1:43124"],
      credentialSlots: [
        {
          id: "apiToken",
          label: "API token",
          required: true,
          operations: ["test", "pull", "push"],
        },
      ],
      configSchema: {
        schemaVersion: 1,
        fields: [
          {
            key: "scenario",
            label: "Scenario",
            fieldType: "text",
            required: false,
            defaultValue: "success",
          },
        ],
      },
    });
    expect(descriptor.protocol).toBe(EXTERNAL_CONNECTOR_PROTOCOL_V1);
    expect(descriptor.contractVersion).toBe(1);
    expect(descriptor.limits).toEqual(defaultExternalConnectorLimits());
    expect(validateExternalConnectorDescriptor(descriptor)).toEqual([]);
  });

  it("rejects descriptors without exchange operations", () => {
    expect(() =>
      defineExternalConnector({
        id: "example.external",
        version: "1.0.0",
        displayName: "Example",
        transports: ["http"],
        checkpointVersion: 1,
        capabilities: {},
        operations: ["validateConfig", "test"],
        origins: ["http://127.0.0.1:43124"],
        credentialSlots: [],
        configSchema: { schemaVersion: 1, fields: [] },
      }),
    ).toThrow(/exchange operation/);
  });

  it("verifies HMAC webhook signatures without leaking secrets", () => {
    const secret = "fixture-token-not-for-production";
    const body = '{"event":"updated"}';
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(
      verifyHmacSha256WebhookSignature({
        body,
        signature: `sha256=${signature}`,
        secret,
        prefix: "sha256=",
      }),
    ).toBe(true);
    expect(
      verifyHmacSha256WebhookSignature({
        body,
        signature: "sha256=deadbeef",
        secret,
        prefix: "sha256=",
      }),
    ).toBe(false);
  });
});
