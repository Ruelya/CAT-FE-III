import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  HOST_API_VERSION,
  capabilityScopeContains,
  compatibilityForManifest,
  createSandboxEngineConnectorPlugin,
  defineDeclarativeFilter,
  defineDeclarativeEngineConnector,
  defineDeclarativeManifest,
  defineDeclarativePipelineStep,
  defineDeclarativeQaPack,
  defineSandboxManifest,
  defineEngineConnector,
  defaultEngineConnectorLimits,
  ENGINE_CONNECTOR_PROTOCOL_V1,
  EngineConnectorEventSequenceValidatorV1,
  MAX_ENGINE_CONNECTOR_CREDENTIAL_BYTES,
  normalizeCapabilityRequests,
  normalizeManifest,
  parsePluginPanelMessageV1,
  SANDBOX_LIMITS,
  validateSandboxJsonValue,
  validateManifest,
  validateNormalizedManifest,
  validateEngineConnectorConfig,
  validateEngineConnectorDescriptor,
  validateEngineConnectorEvent,
  validateEngineConnectorFailure,
  validateEngineConnectorRequest,
  validateEngineConnectorResult,
  type EngineConnectorContributionDescriptorV1,
  type EngineConnectorHandlerV1,
  type EngineConnectorInvocationContextV1,
  type PluginCapabilityRequest,
  type PluginManifest,
  type PluginManifestV2,
  type SandboxInvocationContextV1,
} from "./index.js";

describe("sandbox SDK contract", () => {
  it("defines an executable sandbox manifest with bounded public limits", () => {
    const manifest = defineSandboxManifest({
      id: "example.sandbox",
      displayName: "Sandbox",
      version: "0.1.0",
      hostApi: { min: 1, max: 1 },
      entry: { path: "entry.mjs" },
      contributions: [
        {
          kind: "uiPanel",
          descriptorVersion: 1,
          id: "example.sandbox.panel",
          version: "0.1.0",
          displayName: "Panel",
          label: "Panel",
          placement: "plugins.preview",
          surface: "panel/index.html",
          bridgeVersion: 1,
        },
      ],
      permissions: [],
    });
    const normalized = normalizeManifest(manifest);
    expect(validateNormalizedManifest(normalized)).toEqual([]);
    expect(compatibilityForManifest(normalized)).toMatchObject({
      compatible: true,
      runtimeSupported: true,
      contributionsSupported: true,
    });
    expect(SANDBOX_LIMITS).toMatchObject({
      heapBytes: 32 * 1024 * 1024,
      stackBytes: 512 * 1024,
      invocationMs: 2_000,
      moduleCount: 128,
      pendingRequests: 32,
      jsonDepth: 16,
      hostCallsPerInvocation: 256,
    });
  });

  it("rejects unsafe entries, surfaces, values, and bridge envelopes", () => {
    const manifest = defineSandboxManifest({
      id: "example.sandbox",
      displayName: "Sandbox",
      version: "0.1.0",
      hostApi: { min: 1, max: 1 },
      entry: { path: "entry.ts" },
      contributions: [
        {
          kind: "uiPanel",
          descriptorVersion: 1,
          id: "example.sandbox.panel",
          version: "0.1.0",
          displayName: "Panel",
          label: "Panel",
          placement: "plugins.preview",
          surface: "panel/index.svg",
          bridgeVersion: 2,
        },
      ],
      permissions: [],
    });
    expect(validateNormalizedManifest(normalizeManifest(manifest))).toEqual(
      expect.arrayContaining([
        "sandbox runtime entry must end in .js or .mjs",
        expect.stringContaining("relative .html surface"),
      ]),
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateSandboxJsonValue(cyclic)).toBe(false);
    expect(validateSandboxJsonValue(new Date())).toBe(false);
    expect(validateSandboxJsonValue(Number.NaN)).toBe(false);
    expect(
      parsePluginPanelMessageV1({
        version: 1,
        type: "request",
        id: "request-1",
        method: "panel.context",
        params: {},
      }),
    ).not.toBeNull();
    expect(
      parsePluginPanelMessageV1({
        version: 1,
        type: "request",
        id: "request-1",
        method: "panel.context",
        params: {},
        extra: true,
      }),
    ).toBeNull();
  });
});

describe("engine connector V1 SDK", () => {
  const configSchema = {
    schemaVersion: 1 as const,
    fields: [
      {
        key: "mode",
        label: "Mode",
        fieldType: "select" as const,
        required: true,
        defaultValue: "deterministic",
        options: [{ value: "deterministic", label: "Deterministic" }],
      },
      {
        key: "temperature",
        label: "Temperature",
        fieldType: "integer" as const,
        required: false,
        defaultValue: 0,
        min: 0,
        max: 2,
      },
    ],
  };

  const connector = (): EngineConnectorContributionDescriptorV1 =>
    defineEngineConnector({
      id: "example.connector.fixture",
      version: "1.0.0",
      displayName: "Fixture connector",
      configSchemaVersion: 1,
      configSchema,
      operations: ["validateConfig", "test", "models.list", "generate"],
    });

  it("builds a strict descriptor and keeps skeletal inventory incompatible", () => {
    const descriptor = connector();
    expect(descriptor.protocol).toBe(ENGINE_CONNECTOR_PROTOCOL_V1);
    expect(validateEngineConnectorDescriptor(descriptor, "sandbox")).toEqual(
      [],
    );
    const manifest = defineSandboxManifest({
      id: "example.connector",
      displayName: "Connector",
      version: "1.0.0",
      hostApi: { min: 1, max: 1 },
      entry: { path: "entry.mjs" },
      contributions: [descriptor],
      permissions: [],
      capabilities: [],
    });
    const normalized = normalizeManifest(manifest);
    expect(validateNormalizedManifest(normalized)).toEqual([]);
    expect(compatibilityForManifest(normalized)).toMatchObject({
      compatible: true,
      contributionsSupported: true,
    });

    const legacy: PluginManifestV2 = {
      ...manifest,
      contributions: [
        {
          kind: "engineConnector",
          descriptorVersion: 1,
          id: "example.connector.legacy",
          version: "1.0.0",
          displayName: "Legacy inventory",
          protocol: "local",
          operations: ["lookup"],
          configSchemaVersion: 1,
        },
      ],
    };
    expect(validateNormalizedManifest(normalizeManifest(legacy))).toEqual([]);
    expect(compatibilityForManifest(normalizeManifest(legacy)).compatible).toBe(
      false,
    );
  });

  it("rejects unknown fields, versions, operations, config, and every request bound", () => {
    expect(
      validateEngineConnectorDescriptor({ ...connector(), extra: true }).join(
        " ",
      ),
    ).toContain("unknown field extra");
    expect(
      validateEngineConnectorDescriptor({
        ...connector(),
        operations: ["validateConfig", "test", "lookup", "generate"],
      }).join(" "),
    ).toContain("unsupported connector operation lookup");
    expect(
      validateEngineConnectorDescriptor({
        ...connector(),
        contractVersion: 2,
      }).join(" "),
    ).toContain("contractVersion must be 1");
    expect(
      validateEngineConnectorConfig(configSchema, {
        mode: "unknown",
        secret: "must-not-be-configurable",
      }).join(" "),
    ).toContain("unknown connector config field secret");

    const request = {
      operation: "generate",
      contractVersion: 1,
      requestId: "request-1",
      sourceLocale: "en",
      targetLocale: "ja",
      sourceText: "Hello",
      messages: [{ role: "user", content: "Hello" }],
      model: "fixture-1",
      config: { mode: "deterministic" },
      deadlineMs: 1_000,
    };
    expect(validateEngineConnectorRequest(request)).toEqual([]);
    expect(
      validateEngineConnectorRequest({
        ...request,
        operation: "engine.rpc",
      }).join(" "),
    ).toContain("operation is unsupported");
    expect(
      validateEngineConnectorRequest({ ...request, extra: true }).join(" "),
    ).toContain("unknown field extra");
    expect(
      validateEngineConnectorRequest({
        ...request,
        credential: "must-not-be-a-public-request-field",
      }).join(" "),
    ).toContain("unknown field credential");
    expect(
      validateEngineConnectorRequest({
        ...request,
        sourceText: "x".repeat(1024 * 1024 + 1),
      }).join(" "),
    ).toContain("sourceText");
  });

  it("validates ordered event/result/failure payload shapes", () => {
    const result = {
      outputText: "Konnichiwa",
      model: "fixture-1",
      finishReason: "stop" as const,
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    };
    expect(validateEngineConnectorResult(result)).toEqual([]);
    expect(
      validateEngineConnectorEvent({
        kind: "completed",
        contractVersion: 1,
        requestId: "request-1",
        sequence: 1,
        result,
      }),
    ).toEqual([]);
    const sequence = new EngineConnectorEventSequenceValidatorV1("request-1");
    expect(
      sequence.accept({
        kind: "delta",
        contractVersion: 1,
        requestId: "request-1",
        sequence: 0,
        text: "Konnichi",
      }),
    ).toEqual([]);
    expect(
      sequence.accept({
        kind: "completed",
        contractVersion: 1,
        requestId: "request-1",
        sequence: 1,
        result,
      }),
    ).toEqual([]);
    expect(
      sequence
        .accept({
          kind: "delta",
          contractVersion: 1,
          requestId: "request-1",
          sequence: 2,
          text: "late",
        })
        .join(" "),
    ).toContain("after completion");
    expect(
      validateEngineConnectorResult({
        ...result,
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 4 },
      }).join(" "),
    ).toContain("totalTokens");
    expect(
      validateEngineConnectorFailure({
        contractVersion: 1,
        requestId: "request-1",
        code: "authentication",
        message: "authentication failed",
        retryable: false,
        retryAfterMs: 100,
      }).join(" "),
    ).toContain("retryAfterMs requires");
  });

  it("defines a confined Tier 1 OpenAI-compatible mapping", () => {
    const descriptor = defineDeclarativeEngineConnector({
      id: "example.connector.declarative",
      version: "1.0.0",
      displayName: "Declarative fixture",
      configSchemaVersion: 1,
      configSchema,
      declarative: {
        definitionVersion: 1,
        endpoint: {
          destinationOrigin: "http://127.0.0.1:43123",
          urlTemplate: "http://127.0.0.1:43123/v1/chat/completions",
          method: "POST",
        },
        fixedHeaders: [{ name: "x-client", value: "translunar-fixture" }],
        authentication: { kind: "bearer" },
        request: {
          modelPath: ["model"],
          messagesPath: ["messages"],
          streamPath: ["stream"],
        },
        response: {
          kind: "serverSentEvents",
          deltaPath: ["choices", "delta", "content"],
          finishReasonPath: ["choices", "finish_reason"],
          usage: {
            inputTokensPath: ["usage", "prompt_tokens"],
            outputTokensPath: ["usage", "completion_tokens"],
            totalTokensPath: ["usage", "total_tokens"],
          },
          doneMarker: "[DONE]",
          maxLineBytes: 64 * 1024,
        },
        failures: [
          { status: 401, code: "authentication", retryable: false },
          { status: 429, code: "rateLimit", retryable: true },
        ],
      },
    });
    expect(
      validateEngineConnectorDescriptor(descriptor, "declarative"),
    ).toEqual([]);
    expect(
      validateEngineConnectorDescriptor(
        {
          ...descriptor,
          declarative: {
            ...descriptor.declarative,
            endpoint: {
              ...descriptor.declarative!.endpoint,
              urlTemplate: "https://other.example.test/v1",
            },
          },
        },
        "declarative",
      ).join(" "),
    ).toContain("remain under destinationOrigin");
  });

  it("adapts a public handler for the Tier 2 sandbox contract", async () => {
    let shutdown = false;
    const retainedContexts: EngineConnectorInvocationContextV1[] = [];
    const observedCredentials: Array<string | undefined> = [];
    const handler: EngineConnectorHandlerV1 = {
      validateConfig: () => ({ valid: true, issues: [] }),
      test: () => ({ ok: true, latencyMs: 1, model: "fixture-1" }),
      listModels: () => ({
        models: [{ id: "fixture-1", displayName: "Fixture 1" }],
      }),
      async *generate(request, context) {
        retainedContexts.push(context);
        observedCredentials.push(context.credential);
        yield {
          kind: "delta",
          contractVersion: 1,
          requestId: request.requestId,
          sequence: 0,
          text: "Translated",
        };
        yield {
          kind: "completed",
          contractVersion: 1,
          requestId: request.requestId,
          sequence: 1,
          result: {
            outputText: "Translated",
            model: request.model,
            finishReason: "stop",
          },
        };
      },
      cancel: () => {},
      shutdown: () => {
        shutdown = true;
      },
    };
    const plugin = createSandboxEngineConnectorPlugin({
      contributionId: connector().id,
      handler,
      limits: defaultEngineConnectorLimits(),
    });
    const invocation = {
      protocolVersion: 1 as const,
      invocationId: "invocation-1",
      contributionId: connector().id,
      operation: "connector.generate",
      input: {
        operation: "generate",
        contractVersion: 1,
        requestId: "request-1",
        sourceLocale: "en",
        targetLocale: "ja",
        sourceText: "Hello",
        messages: [],
        model: "fixture-1",
        config: { mode: "deterministic" },
        deadlineMs: 1_000,
      },
    };
    const host = { call: async () => ({}) };
    const credential = "ephemeral-tier2-secret";
    expect(JSON.stringify(invocation)).not.toContain(credential);
    await expect(
      plugin.invoke(invocation, host, { credential }),
    ).resolves.toMatchObject({
      events: [{ kind: "delta" }, { kind: "completed" }],
    });
    expect(observedCredentials).toEqual([credential]);
    expect(retainedContexts[0]).not.toHaveProperty("credential");

    await expect(
      plugin.invoke(
        {
          ...invocation,
          invocationId: "invocation-2",
          input: { ...invocation.input, requestId: "request-2" },
        },
        host,
      ),
    ).resolves.toMatchObject({
      events: [{ kind: "delta" }, { kind: "completed" }],
    });
    expect(observedCredentials).toEqual([credential, undefined]);
    expect(retainedContexts[1]).not.toHaveProperty("credential");

    await expect(
      plugin.invoke(invocation, host, {
        credential: "x".repeat(MAX_ENGINE_CONNECTOR_CREDENTIAL_BYTES + 1),
      }),
    ).rejects.toThrow("invalid sandbox invocation context");
    await expect(
      plugin.invoke(invocation, host, { credential: "invalid\0credential" }),
    ).rejects.toThrow("invalid sandbox invocation context");
    await expect(
      plugin.invoke(invocation, host, {
        credential: "bounded",
        extra: true,
      } as SandboxInvocationContextV1),
    ).rejects.toThrow("unknown field extra");
    await plugin.deactivate?.({
      protocolVersion: 1,
      pluginId: "example.connector",
      version: "1.0.0",
    });
    expect(shutdown).toBe(true);
  });
});

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "..", "..");
const exampleRoot = resolve(workspaceRoot, "examples", "plugins", "hello-srt");
const tier1ExampleRoot = resolve(
  workspaceRoot,
  "examples",
  "plugins",
  "tier1-toolkit",
);

const base: PluginManifest = {
  manifestVersion: 1,
  id: "example.hello-srt",
  displayName: "Hello SRT",
  version: "0.1.0",
  apiVersion: HOST_API_VERSION,
  apiVersionMin: 1,
  tier: "process",
  entry: { kind: "node", path: "bin/hello-srt.mjs" },
  contributions: {
    filters: [
      {
        id: "example.hello-srt",
        version: "0.1.0",
        displayName: "Hello SRT",
        extensions: ["srt"],
        capabilities: {
          import: true,
          export: true,
          validate: true,
          inlineTags: false,
          notes: false,
          degradationReport: true,
        },
      },
    ],
  },
  permissions: ["file.read:source", "file.write:output"],
};
const baseFilter = base.contributions.filters[0]!;

describe("plugin-sdk manifest validation", () => {
  it("accepts a valid hello-srt style manifest", () => {
    expect(validateManifest(base)).toEqual([]);
  });

  it("rejects builtin ids", () => {
    expect(validateManifest({ ...base, id: "builtin.x" }).join(" ")).toContain(
      "builtin",
    );
  });

  it.each([
    [
      "an incompatible API range",
      { ...base, apiVersion: 2, apiVersionMin: 2 },
      "outside plugin range",
    ],
    [
      "a parent-traversing entry",
      { ...base, entry: { ...base.entry, path: "../escape.mjs" } },
      "relative path",
    ],
    [
      "duplicate filter ids",
      {
        ...base,
        contributions: {
          filters: [baseFilter, baseFilter],
        },
      },
      "duplicate filter id",
    ],
    [
      "an invalid filter id",
      {
        ...base,
        contributions: {
          filters: [{ ...baseFilter, id: "invalid/filter" }],
        },
      },
      "unsupported characters",
    ],
    [
      "an unsupported permission",
      { ...base, permissions: ["process.exec"] },
      "unsupported permission",
    ],
  ])("rejects %s", (_label, manifest, expectedError) => {
    expect(validateManifest(manifest).join(" ")).toContain(expectedError);
  });
});

describe("plugin capability vocabulary", () => {
  const requests: PluginCapabilityRequest[] = [
    { capabilityId: "file.read", scope: { kind: "file", areas: ["source"] } },
    { capabilityId: "file.write", scope: { kind: "file", areas: ["output"] } },
    {
      capabilityId: "network.connect",
      scope: { kind: "network", origins: ["https://api.example.test"] },
    },
    {
      capabilityId: "asset.read",
      scope: { kind: "assets", projectIds: ["project-a"], assetIds: [] },
    },
    {
      capabilityId: "asset.write",
      scope: { kind: "assets", projectIds: [], assetIds: ["tm-main"] },
    },
    {
      capabilityId: "project.read",
      scope: { kind: "projects", projectIds: ["project-a"] },
    },
    {
      capabilityId: "project.write",
      scope: { kind: "projects", projectIds: ["project-a"] },
    },
    {
      capabilityId: "engine.connector",
      scope: { kind: "operations", operations: ["segment.read"] },
    },
    {
      capabilityId: "qa.register",
      scope: { kind: "contributions", contributionIds: ["qa.example"] },
    },
    {
      capabilityId: "pipeline.register",
      scope: { kind: "contributions", contributionIds: ["pipeline.example"] },
    },
    {
      capabilityId: "ai.action",
      scope: { kind: "contributions", contributionIds: ["ai.example"] },
    },
    {
      capabilityId: "ui.panel",
      scope: { kind: "contributions", contributionIds: ["panel.example"] },
    },
    {
      capabilityId: "external.connector",
      scope: { kind: "operations", operations: ["sync.push"] },
    },
    {
      capabilityId: "diagnostics.read",
      scope: { kind: "diagnostics", categories: ["runtime"] },
    },
  ];

  it("normalizes every capability family and legacy permissions", () => {
    const normalized = normalizeCapabilityRequests(
      ["file.read:source", "network:https://legacy.example.test"],
      requests,
    );
    expect(normalized).toHaveLength(15);
    const manifest = normalizeManifest({ ...base, capabilities: requests });
    expect(manifest.requestedCapabilities).toHaveLength(requests.length);
    expect(
      manifest.requestedCapabilities.map((request) => request.capabilityId),
    ).toEqual(
      expect.arrayContaining(requests.map((request) => request.capabilityId)),
    );
    expect(validateManifest({ ...base, capabilities: requests })).toEqual([]);
  });

  it("deduplicates semantic requests and sorts scope values", () => {
    expect(
      normalizeCapabilityRequests(
        [],
        [
          {
            capabilityId: "network.connect",
            scope: {
              kind: "network",
              origins: ["https://b.test", "https://a.test"],
            },
          },
          {
            capabilityId: "network.connect",
            required: true,
            scope: {
              kind: "network",
              origins: ["https://a.test", "https://b.test"],
            },
          },
        ],
      ),
    ).toEqual([
      {
        capabilityId: "network.connect",
        required: true,
        scope: {
          kind: "network",
          origins: ["https://a.test", "https://b.test"],
        },
      },
    ]);
  });

  it("checks narrowed and wildcard scope containment", () => {
    expect(
      capabilityScopeContains(
        { kind: "projects", projectIds: ["*"] },
        { kind: "projects", projectIds: ["project-a"] },
      ),
    ).toBe(true);
    expect(
      capabilityScopeContains(
        { kind: "network", origins: ["https://api.example.test"] },
        { kind: "network", origins: ["https://other.example.test"] },
      ),
    ).toBe(false);
  });

  it("rejects empty and capability-mismatched scopes", () => {
    expect(
      validateManifest({
        ...base,
        capabilities: [
          {
            capabilityId: "asset.read",
            scope: { kind: "assets", projectIds: [], assetIds: [] },
          },
        ],
      }).join(" "),
    ).toContain("at least one project or asset");
    expect(
      validateManifest({
        ...base,
        capabilities: [
          {
            capabilityId: "file.read",
            scope: { kind: "network", origins: ["https://api.example.test"] },
          },
        ],
      }).join(" "),
    ).toContain("scope kind does not match capability");
  });

  it("preserves unsupported optional capabilities and rejects required ones", () => {
    const optional: PluginCapabilityRequest = {
      capabilityId: "future.translation.inspect",
      required: false,
      scope: { kind: "unscoped" },
    };
    expect(normalizeCapabilityRequests([], [optional])).toEqual([optional]);
    expect(validateManifest({ ...base, capabilities: [optional] })).toEqual([]);
    expect(
      validateManifest({
        ...base,
        capabilities: [{ ...optional, required: true }],
      }).join(" "),
    ).toContain("unsupported capability future.translation.inspect");
    expect(
      validateManifest({
        ...base,
        capabilities: [{ ...optional, capabilityId: "future capability" }],
      }).join(" "),
    ).toContain("capability id is empty, oversized, or malformed");
  });
});

describe("Tier 1 declarative SDK", () => {
  it("validates the official manifest-only toolkit as executable", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(tier1ExampleRoot, "manifest.json"), "utf8"),
    ) as PluginManifestV2;
    const normalized = normalizeManifest(manifest);
    expect(validateNormalizedManifest(normalized)).toEqual([]);
    expect(compatibilityForManifest(normalized)).toMatchObject({
      compatible: true,
      runtimeSupported: true,
      contributionsSupported: true,
    });
    await expect(
      readFile(resolve(tier1ExampleRoot, "sample.catlines"), "utf8"),
    ).resolves.toContain("CAT1");
  });

  it("builds exact typed filter, QA, pipeline, and manifest descriptors", () => {
    const filter = defineDeclarativeFilter({
      id: "example.filter",
      version: "1.0.0",
      displayName: "Example filter",
      extensions: ["example"],
      capabilities: {
        import: true,
        export: true,
        validate: true,
        inlineTags: false,
        notes: false,
        degradationReport: false,
      },
      declarative: {
        definitionVersion: 1,
        encoding: "utf8",
        unitPattern: "(?<source>.+)",
        limits: {
          maxSourceBytes: 1024,
          maxOutputBytes: 1024,
          maxUnits: 10,
          maxUnitBytes: 256,
          maxCaptureBytes: 64,
          probeHeaderBytes: 64,
        },
      },
    });
    const qa = defineDeclarativeQaPack({
      id: "example.qa",
      version: "1.0.0",
      displayName: "Example QA",
      severity: "warning",
      definition: {},
      declarative: {
        definitionVersion: 1,
        rules: [
          {
            id: "placeholder",
            label: "Placeholder",
            field: "target",
            pattern: "TODO",
            severity: "warning",
            message: "Placeholder remains.",
          },
        ],
      },
    });
    const pipeline = defineDeclarativePipelineStep({
      id: "example.pipeline",
      version: "1.0.0",
      displayName: "Example pipeline",
      declarative: {
        definitionVersion: 1,
        input: "json",
        output: "json",
        operations: [{ operation: "set", path: ["status"], value: "ready" }],
        maxInputBytes: 1024,
        maxOutputBytes: 1024,
      },
    });
    const manifest = defineDeclarativeManifest({
      id: "example.toolkit",
      displayName: "Example toolkit",
      version: "1.0.0",
      hostApi: { min: 1, max: 1 },
      contributions: [filter, qa, pipeline],
      permissions: [],
      capabilities: [],
    });
    expect(validateNormalizedManifest(normalizeManifest(manifest))).toEqual([]);
    expect(pipeline).toMatchObject({
      input: "json",
      output: "json",
      configSchemaVersion: 1,
      resumable: false,
      cancellable: true,
    });
  });

  it("keeps untyped declarative inventory incompatible", () => {
    const manifest = defineDeclarativeManifest({
      id: "example.inventory",
      displayName: "Inventory only",
      version: "1.0.0",
      hostApi: { min: 1, max: 1 },
      contributions: [
        {
          kind: "filter",
          descriptorVersion: 1,
          id: "example.inventory.filter",
          version: "1.0.0",
          displayName: "Inventory filter",
          extensions: ["inventory"],
          capabilities: baseFilter.capabilities,
        },
      ],
      permissions: [],
    });
    const normalized = normalizeManifest(manifest);
    expect(validateNormalizedManifest(normalized).join(" ")).toContain(
      "needs a definition",
    );
    expect(compatibilityForManifest(normalized).compatible).toBe(false);
  });
});

describe("official hello-srt example", () => {
  it("imports and invokes the public process helper", async () => {
    const sourcePath = resolve(exampleRoot, "src", "index.ts");
    const sourceText = await readFile(sourcePath, "utf8");
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const importedHelperNames = new Set<string>();
    let invokesImportedHelper = false;

    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "@translunar/plugin-sdk" &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          if (
            (element.propertyName ?? element.name).text === "startProcessPlugin"
          ) {
            importedHelperNames.add(element.name.text);
          }
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        importedHelperNames.has(node.expression.text)
      ) {
        invokesImportedHelper = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(importedHelperNames.size).toBe(1);
    expect(invokesImportedHelper).toBe(true);
    expect(sourceText).not.toContain("createInterface");
  });

  it("builds a self-contained entry that serves filter JSON-RPC", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "translunar-sdk-srt-"));
    const bundledEntryPath = join(fixtureRoot, "hello-srt.mjs");
    const sourcePath = join(fixtureRoot, "source.srt");
    const outputPath = join(fixtureRoot, "translated.srt");
    await copyFile(
      resolve(exampleRoot, "bin", "hello-srt.mjs"),
      bundledEntryPath,
    );
    await writeFile(
      sourcePath,
      [
        "1",
        "00:00:01,000 --> 00:00:02,000",
        "First cue",
        "",
        "2",
        "00:00:03,000 --> 00:00:04,000",
        "Second cue",
        "",
      ].join("\n"),
      "utf8",
    );

    const child = spawn(process.execPath, [bundledEntryPath], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let nextId = 1;
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const call = (method: string, params: unknown): Promise<unknown> => {
      const id = nextId;
      nextId += 1;
      return new Promise((resolveCall, rejectCall) => {
        const timeout = setTimeout(() => {
          lines.removeListener("line", onLine);
          rejectCall(new Error(`timed out waiting for ${method}: ${stderr}`));
        }, 5_000);
        const onLine = (line: string) => {
          clearTimeout(timeout);
          let response: unknown;
          try {
            response = JSON.parse(line) as unknown;
          } catch (error) {
            rejectCall(
              error instanceof Error ? error : new Error(String(error)),
            );
            return;
          }
          if (typeof response !== "object" || response === null) {
            rejectCall(new Error(`invalid JSON-RPC response for ${method}`));
            return;
          }
          const record = response as Record<string, unknown>;
          if (record.id !== id) {
            rejectCall(new Error(`unexpected JSON-RPC id for ${method}`));
            return;
          }
          if (record.error) {
            rejectCall(new Error(JSON.stringify(record.error)));
            return;
          }
          resolveCall(record.result);
        };
        lines.once("line", onLine);
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
    };

    try {
      await expect(call("plugin.handshake", {})).resolves.toMatchObject({
        apiVersion: HOST_API_VERSION,
        pluginId: base.id,
      });
      await expect(call("filter.probe", { sourcePath })).resolves.toMatchObject(
        { confidence: 90 },
      );
      await expect(call("filter.import", { sourcePath })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "text", text: "First cue" }),
          expect.objectContaining({ type: "text", text: "Second cue" }),
        ]),
      );
      await expect(
        call("filter.export", {
          sourcePath,
          outputPath,
          segments: [
            { ordinal: 0, targetText: "First translated cue" },
            { ordinal: 1, targetText: "Second translated cue" },
          ],
        }),
      ).resolves.toMatchObject({
        outputPath,
        translatedSegments: 2,
      });
      await expect(readFile(outputPath, "utf8")).resolves.toContain(
        "Second translated cue",
      );
      await expect(call("filter.validate", { sourcePath })).resolves.toEqual({
        valid: true,
        findings: [],
      });
      expect(stderr).toBe("");
    } finally {
      lines.close();
      await new Promise<void>((resolveExit) => {
        if (child.exitCode !== null) {
          resolveExit();
          return;
        }
        child.once("exit", () => resolveExit());
        child.kill();
      });
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
