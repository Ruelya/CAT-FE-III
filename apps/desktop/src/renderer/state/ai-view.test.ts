import { describe, expect, it } from "vitest";

import {
  buildCreateConfiguration,
  canApplyRun,
  canCancelBatch,
  canCancelRun,
  canResumeBatch,
  canResumeRun,
  formatProviderSource,
  isBatchTerminal,
  isRunTerminal,
  mergeConfiguration,
  projectConnectorSchema,
} from "./ai-view";

describe("ai-view schema", () => {
  it("projects supported fields and rejects unsupported", () => {
    const ok = projectConnectorSchema({
      schemaVersion: 1,
      fields: [
        {
          key: "region",
          label: "Region",
          fieldType: "text",
          required: true,
        },
        {
          key: "enabled",
          label: "On",
          fieldType: "boolean",
          required: false,
          defaultValue: true,
        },
      ],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.fields).toHaveLength(2);
      expect(buildCreateConfiguration(ok.fields, { region: "us" })).toEqual({
        region: "us",
        enabled: true,
      });
    }

    const bad = projectConnectorSchema({
      schemaVersion: 1,
      fields: [
        {
          key: "payload",
          label: "Payload",
          fieldType: "json" as never,
          required: false,
        },
      ],
    });
    expect(bad).toEqual({
      ok: false,
      reason: "unsupported",
      unsupportedKeys: ["payload"],
    });
    const missing = projectConnectorSchema(null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("missing");
  });

  it("preserves unknown configuration keys on update", () => {
    const projected = projectConnectorSchema({
      schemaVersion: 1,
      fields: [
        {
          key: "region",
          label: "Region",
          fieldType: "text",
          required: true,
        },
      ],
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const merged = mergeConfiguration(
      { region: "eu", futureKey: 42, nested: { a: 1 } },
      projected.fields,
      { region: "us" },
    );
    expect(merged).toEqual({
      region: "us",
      futureKey: 42,
      nested: { a: 1 },
    });
  });
});

describe("ai-view terminal guards", () => {
  it("classifies run/batch terminal and command availability", () => {
    expect(isRunTerminal("succeeded")).toBe(true);
    expect(isRunTerminal("running")).toBe(false);
    expect(canCancelRun("running")).toBe(true);
    expect(canCancelRun("succeeded")).toBe(false);
    expect(canResumeRun("interrupted")).toBe(true);
    expect(canApplyRun("succeeded", "hello")).toBe(true);
    expect(canApplyRun("succeeded", null)).toBe(false);
    expect(isBatchTerminal("completedWithErrors")).toBe(true);
    expect(canCancelBatch("queued")).toBe(true);
    expect(canResumeBatch("failed")).toBe(true);
  });

  it("formats provider source identity", () => {
    expect(
      formatProviderSource({ kind: "builtin", provider: "openai" }),
    ).toBe("builtin:openai");
    expect(
      formatProviderSource({
        kind: "plugin",
        contractVersion: 1,
        contributionId: "c1",
        owner: { pluginId: "plug", versionId: "v1" },
      }),
    ).toBe("plugin:plug/c1@v1");
  });
});
