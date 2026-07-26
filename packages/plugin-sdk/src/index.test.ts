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
  validateManifest,
  type PluginManifest,
} from "./index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "..", "..");
const exampleRoot = resolve(workspaceRoot, "examples", "plugins", "hello-srt");

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
