import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "../../shared/desktop-api.js";
import { EngineClientError, callEngine, isAiNotConfigured } from "./engine.js";

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
