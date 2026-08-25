import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "../../shared/desktop-api.js";
import {
  EngineClientError,
  callEngine,
  isAiNotConfigured,
  isEngineUnavailable,
  isExportBlocked,
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
