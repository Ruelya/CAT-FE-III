import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "../../shared/desktop-api.js";
import {
  EngineClientError,
  callEngine,
  isAiNotConfigured,
  isEngineUnavailable,
  isExportBlocked,
  qaGateBlock,
} from "./engine.js";

function installBridge(invoke: DesktopApi["invoke"]): void {
  const api: Partial<DesktopApi> = { invoke };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "tl");
});

describe("callEngine", () => {
  it("returns the unwrapped result on success", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      result: { projects: [] },
    });
    installBridge(invoke);
    const result = await callEngine("project.list", {});
    expect(result).toEqual({ projects: [] });
    expect(invoke).toHaveBeenCalledWith("project.list", {});
  });

  it("throws a typed error carrying the engine error code", async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "aiNotConfigured",
          message: "AI provider is not configured",
        },
      }),
    );
    const failure = await callEngine("ai.status", {}).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(EngineClientError);
    expect((failure as EngineClientError).code).toBe("aiNotConfigured");
    expect(isAiNotConfigured(failure)).toBe(true);
  });
});

describe("isExportBlocked", () => {
  it("recognises only the engine's exportBlocked refusal", () => {
    expect(
      isExportBlocked(
        new EngineClientError("exportBlocked", "output path already exists"),
      ),
    ).toBe(true);
    expect(isExportBlocked(new EngineClientError("io", "disk full"))).toBe(
      false,
    );
    expect(isExportBlocked(new Error("exportBlocked"))).toBe(false);
  });
});

describe("qaGateBlock", () => {
  it("carries RpcError.data through callEngine and parses the gate payload", async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "exportBlocked",
          message: "export blocked: 2 error-severity QA issue(s) are open",
          data: {
            reason: "qaGate",
            openErrors: 2,
            ruleIds: ["qa.number-mismatch", "qa.term-missing:t1"],
          },
        },
      }),
    );
    const failure = await callEngine("document.export", {
      documentId: "d1",
      outputPath: "/tmp/out.txt",
    }).catch((error: unknown) => error);
    expect(qaGateBlock(failure)).toEqual({
      openErrors: 2,
      ruleIds: ["qa.number-mismatch", "qa.term-missing:t1"],
    });
  });

  it("returns null for the plain destination-exists refusal and foreign errors", () => {
    expect(
      qaGateBlock(
        new EngineClientError("exportBlocked", "output path already exists"),
      ),
    ).toBeNull();
    expect(
      qaGateBlock(
        new EngineClientError("exportBlocked", "?", { reason: "other" }),
      ),
    ).toBeNull();
    expect(
      qaGateBlock(new EngineClientError("conflict", "?", { reason: "qaGate" })),
    ).toBeNull();
    expect(qaGateBlock(new Error("qaGate"))).toBeNull();
  });
});

describe("isEngineUnavailable", () => {
  it("recognises transport failures where a write may never have arrived", () => {
    expect(
      isEngineUnavailable(
        new EngineClientError("engineDown", "engine process is not running"),
      ),
    ).toBe(true);
    expect(
      isEngineUnavailable(
        new EngineClientError("timeout", "segment.update timed out"),
      ),
    ).toBe(true);
  });

  it("treats engine-level errors and foreign errors as available", () => {
    expect(
      isEngineUnavailable(
        new EngineClientError("revisionConflict", "stale revision"),
      ),
    ).toBe(false);
    expect(isEngineUnavailable(new Error("engineDown"))).toBe(false);
    expect(isEngineUnavailable("engineDown")).toBe(false);
  });
});
