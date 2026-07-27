import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canonicalizePublicJson,
  createSandboxPipelineStepPlugin,
  createSandboxQaRulePlugin,
  definePipelineStep,
  defineQaRule,
  inspectContributionCompatibility,
  validatePipelineCheckpointMigrationInvocation,
  validatePipelineCheckpointMigrationResult,
  validateContributionCancelRequest,
  validatePipelineStepDescriptor,
  validatePipelineStepFailure,
  validatePipelineStepInvocation,
  validatePipelineStepResult,
  validatePublicConfig,
  validatePublicJson,
  validateQaRuleDescriptor,
  validateQaRuleFailure,
  validateQaRuleInvocation,
  validateQaRuleResult,
  type PipelineStepContributionDescriptorV1,
  type PipelineCheckpointMigrationInvocationV1,
  type PipelineCheckpointMigrationResultV1,
  type PipelineStepInvocationV1,
  type PipelineStepResultV1,
  type QaRuleContributionDescriptorV1,
  type QaRuleInvocationV1,
  type QaRuleResultV1,
} from "./qa-pipeline.js";
import {
  compatibilityForManifest,
  normalizeManifest,
  validateNormalizedManifest,
  type PluginManifestV2,
} from "./index.js";

interface GoldenContract {
  qaDescriptor: QaRuleContributionDescriptorV1;
  qaInvocation: QaRuleInvocationV1;
  qaResult: QaRuleResultV1;
  pipelineDescriptor: PipelineStepContributionDescriptorV1;
  pipelineInvocation: PipelineStepInvocationV1;
  pipelineResult: PipelineStepResultV1;
}

async function goldenContract(): Promise<GoldenContract> {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = await readFile(
    resolve(here, "../../../fixtures/plugins/qa-pipeline-contract-v1.json"),
    "utf8",
  );
  return JSON.parse(raw) as GoldenContract;
}

describe("public QA and pipeline V1 contracts", () => {
  it("shares a golden fixture with Rust and round-trips every successful envelope", async () => {
    const golden = await goldenContract();
    expect(validateQaRuleDescriptor(golden.qaDescriptor)).toEqual([]);
    expect(
      validateQaRuleInvocation(golden.qaInvocation, golden.qaDescriptor),
    ).toEqual([]);
    expect(
      validateQaRuleResult(
        golden.qaResult,
        golden.qaInvocation,
        golden.qaDescriptor,
      ),
    ).toEqual([]);
    expect(validatePipelineStepDescriptor(golden.pipelineDescriptor)).toEqual(
      [],
    );
    expect(
      validatePipelineStepInvocation(
        golden.pipelineInvocation,
        golden.pipelineDescriptor,
      ),
    ).toEqual([]);
    expect(
      validatePipelineStepResult(
        golden.pipelineResult,
        golden.pipelineDescriptor,
      ),
    ).toEqual([]);

    expect(JSON.parse(JSON.stringify(golden))).toEqual(golden);
  });

  it("builds closed descriptors and reports every compatibility axis", () => {
    const qa = defineQaRule({
      id: "example.qa",
      version: "1.0.0",
      displayName: "QA",
      severity: "warning",
      categories: ["custom"],
      configSchema: { schemaVersion: 1, fields: [] },
    });
    const pipeline = definePipelineStep({
      id: "example.pipeline",
      version: "1.0.0",
      displayName: "Pipeline",
      input: "json",
      output: "json",
      configSchema: { schemaVersion: 1, fields: [] },
      resumable: true,
      checkpointSchemaVersion: 1,
    });
    expect(validateQaRuleDescriptor(qa)).toEqual([]);
    expect(validatePipelineStepDescriptor(pipeline)).toEqual([]);
    expect(
      inspectContributionCompatibility({
        descriptorVersion: 1,
        operationProtocolVersion: 2,
        configSchemaVersion: 1,
        checkpointSchemaVersion: 2,
        resumable: true,
      }),
    ).toMatchObject({
      compatible: false,
      reasons: [
        "unsupported_operation_protocol_version",
        "unsupported_checkpoint_schema_version",
      ],
    });
  });

  it("fails closed for unknown fields, enums, config, checkpoints, and bounds", async () => {
    const golden = await goldenContract();
    expect(
      validateQaRuleDescriptor({ ...golden.qaDescriptor, surprise: true }),
    ).toContain("QA descriptor contains unknown field surprise");
    expect(
      validateQaRuleFailure({
        protocolVersion: 1,
        invocationId: "invoke-1",
        code: "surprise",
        message: "failed",
        retryable: false,
      }),
    ).toContain("QA failure code is unsupported");
    expect(
      validatePipelineStepFailure({
        protocolVersion: 1,
        invocationId: "invoke-1",
        code: "surprise",
        message: "failed",
        retryable: false,
      }),
    ).toContain("pipeline failure code is unsupported");
    expect(
      validatePublicConfig(
        { batchSize: 0, unknown: true },
        golden.pipelineDescriptor.configSchema,
      ),
    ).toEqual(
      expect.arrayContaining([
        "config contains unknown field unknown",
        "config field batchSize has an invalid value",
      ]),
    );

    const incompatible = {
      ...golden.pipelineInvocation,
      checkpoint: { schemaVersion: 2, value: {} },
    };
    expect(
      validatePipelineStepInvocation(incompatible, golden.pipelineDescriptor),
    ).toContain("plugin checkpoint is incompatible or oversized");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validatePublicJson(cyclic)).toBe(false);
    const shared = { value: 1 };
    expect(validatePublicJson([shared, shared])).toBe(true);
    expect(validatePublicJson(Number.NaN)).toBe(false);
    expect(validatePublicJson({ text: "x".repeat(8 * 1024 * 1024) })).toBe(
      false,
    );
    expect(
      validateContributionCancelRequest({
        protocolVersion: 1,
        invocationId: "cancel-1",
      }),
    ).toEqual([]);
    expect(
      validateContributionCancelRequest({
        protocolVersion: 2,
        invocationId: "cancel-1",
        extra: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        "cancel request contains unknown field extra",
        "cancel request protocolVersion must be 1",
      ]),
    );
  });

  it("canonicalizes maps and executes typed sandbox QA and resume handlers", async () => {
    const golden = await goldenContract();
    expect(
      Object.keys(
        canonicalizePublicJson({ z: 1, a: { y: 2, b: 3 } }) as Record<
          string,
          unknown
        >,
      ),
    ).toEqual(["a", "z"]);

    const qaPlugin = createSandboxQaRulePlugin({
      descriptor: golden.qaDescriptor,
      handler: {
        evaluateSegment: () => golden.qaResult,
      },
    });
    await expect(
      qaPlugin.invoke({
        protocolVersion: 1,
        invocationId: golden.qaInvocation.invocationId,
        contributionId: golden.qaDescriptor.id,
        operation: "qa.evaluateSegment",
        input: golden.qaInvocation as unknown as never,
      }),
    ).resolves.toEqual({
      protocolVersion: 1,
      ok: true,
      output: golden.qaResult,
    });

    const pipelinePlugin = createSandboxPipelineStepPlugin({
      descriptor: golden.pipelineDescriptor,
      handler: {
        execute: () => golden.pipelineResult,
        resume: (_invocation, context) => {
          context.publishCheckpoint({
            schemaVersion: 1,
            value: { cursor: 2 },
          });
          return golden.pipelineResult;
        },
        migrateCheckpoint: () => ({
          protocolVersion: 1,
          checkpoint: { schemaVersion: 1, value: { cursor: 2 } },
          usage: { workUnits: 1, inputBytes: 8, outputBytes: 8 },
        }),
      },
    });
    const sandboxCheckpoints: unknown[] = [];
    await expect(
      pipelinePlugin.invoke(
        {
          protocolVersion: 1,
          invocationId: golden.pipelineInvocation.invocationId,
          contributionId: golden.pipelineDescriptor.id,
          operation: "pipeline.resume",
          input: golden.pipelineInvocation as unknown as never,
        },
        {
          call(request) {
            sandboxCheckpoints.push(request.params);
            return { accepted: true };
          },
        },
      ),
    ).resolves.toEqual({
      protocolVersion: 1,
      ok: true,
      output: golden.pipelineResult,
    });
    expect(sandboxCheckpoints).toEqual([
      {
        protocolVersion: 1,
        invocationId: golden.pipelineInvocation.invocationId,
        contributionId: golden.pipelineDescriptor.id,
        checkpoint: { schemaVersion: 1, value: { cursor: 2 } },
      },
    ]);
    const migration: PipelineCheckpointMigrationInvocationV1 = {
      protocolVersion: 1,
      invocationId: "migration-1",
      contributionId: golden.pipelineDescriptor.id,
      runId: golden.pipelineInvocation.runId,
      projectId: golden.pipelineInvocation.projectId,
      configSchemaVersion: 1,
      config: golden.pipelineInvocation.config,
      sourceCheckpoint: { schemaVersion: 2, value: { offset: 2 } },
      targetCheckpointSchemaVersion: 1,
      deadlineMs: 1_000,
    };
    expect(
      validatePipelineCheckpointMigrationInvocation(
        migration,
        golden.pipelineDescriptor,
      ),
    ).toEqual([]);
    await expect(
      pipelinePlugin.invoke({
        protocolVersion: 1,
        invocationId: migration.invocationId,
        contributionId: golden.pipelineDescriptor.id,
        operation: "pipeline.checkpointMigrate",
        input: migration as unknown as never,
      }),
    ).resolves.toMatchObject({
      protocolVersion: 1,
      ok: true,
      output: { checkpoint: { schemaVersion: 1, value: { cursor: 2 } } },
    });
  });

  it("rejects nondeterministic QA ordering and Unicode-scalar span overflow", async () => {
    const golden = await goldenContract();
    const duplicate = {
      ...golden.qaResult,
      findings: [...golden.qaResult.findings, golden.qaResult.findings[0]],
    };
    expect(
      validateQaRuleResult(duplicate, golden.qaInvocation, golden.qaDescriptor),
    ).toEqual(
      expect.arrayContaining([
        "QA result contains duplicate findings",
        "QA findings are not deterministically ordered",
      ]),
    );
    const invalidSpan = structuredClone(golden.qaResult);
    invalidSpan.findings[0]!.spans[0]!.end = 10_000;
    expect(
      validateQaRuleResult(
        invalidSpan,
        golden.qaInvocation,
        golden.qaDescriptor,
      ),
    ).toContain("QA span 0 is outside the segment");
  });

  it("builds the public-only process example and dispatches QA and resume over JSON-RPC", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const exampleRoot = resolve(
      here,
      "../../../examples/plugins/qa-pipeline-process",
    );
    const manifest = JSON.parse(
      await readFile(resolve(exampleRoot, "manifest.json"), "utf8"),
    ) as PluginManifestV2;
    const normalized = normalizeManifest(manifest);
    expect(validateNormalizedManifest(normalized)).toEqual([]);
    expect(compatibilityForManifest(normalized).compatible).toBe(true);

    const golden = await goldenContract();
    const child = spawn(process.execPath, [
      resolve(exampleRoot, "bin/qa-pipeline-process.mjs"),
    ]);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();
    let nextId = 1;
    const checkpointNotifications: unknown[] = [];
    const call = async (method: string, params: unknown): Promise<unknown> => {
      const id = nextId++;
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      for (;;) {
        const next = await iterator.next();
        if (next.done) throw new Error("process example closed stdout");
        const response = JSON.parse(next.value) as {
          id?: number;
          method?: string;
          params?: unknown;
          result?: unknown;
          error?: unknown;
        };
        if (response.method === "pipeline.checkpoint") {
          checkpointNotifications.push(response.params);
          continue;
        }
        if (response.id !== id) continue;
        if (response.error) throw new Error(JSON.stringify(response.error));
        return response.result;
      }
    };
    try {
      await expect(call("plugin.handshake", {})).resolves.toMatchObject({
        apiVersion: 1,
        pluginId: "example.qa-pipeline-process",
      });
      const qaResult = (await call(
        "qa.evaluateSegment",
        golden.qaInvocation,
      )) as QaRuleResultV1;
      expect(
        validateQaRuleResult(
          qaResult,
          golden.qaInvocation,
          golden.qaDescriptor,
        ),
      ).toEqual([]);
      const pipelineResult = (await call(
        "pipeline.resume",
        golden.pipelineInvocation,
      )) as PipelineStepResultV1;
      expect(
        validatePipelineStepResult(pipelineResult, golden.pipelineDescriptor),
      ).toEqual([]);
      expect(checkpointNotifications.length).toBeGreaterThan(0);
      const migration: PipelineCheckpointMigrationInvocationV1 = {
        protocolVersion: 1,
        invocationId: "process-migration-1",
        contributionId: golden.pipelineDescriptor.id,
        runId: golden.pipelineInvocation.runId,
        projectId: golden.pipelineInvocation.projectId,
        configSchemaVersion: 1,
        config: golden.pipelineInvocation.config,
        sourceCheckpoint: { schemaVersion: 2, value: { cursor: 2 } },
        targetCheckpointSchemaVersion: 1,
        deadlineMs: 1_000,
      };
      const migrated = (await call(
        "pipeline.checkpointMigrate",
        migration,
      )) as PipelineCheckpointMigrationResultV1;
      expect(
        validatePipelineCheckpointMigrationResult(
          migrated,
          golden.pipelineDescriptor,
        ),
      ).toEqual([]);
      await expect(
        call("pipeline.execute", {
          ...golden.pipelineInvocation,
          invocationId: "process-fatal-1",
          operation: "execute",
          checkpoint: undefined,
          input: {
            kind: "json",
            value: { records: ["fatal"], fixtureFailure: "protocol" },
          },
        }),
      ).rejects.toThrow("plugin contribution invocation failed");
      await call("plugin.shutdown", { protocolVersion: 1 });
    } finally {
      child.kill();
      lines.close();
    }
  });
});
