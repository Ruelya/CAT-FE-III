import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
} from "../test/fake-desktop-api";
import { useTermExtract } from "./use-term-extract";

describe("useTermExtract", () => {
  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("loads candidates for the open document", async () => {
    const engine = createFakeEngineState();
    window.translunar = createFakeDesktopApi(engine);
    const { result } = renderHook(() => useTermExtract("doc-1"));
    await act(async () => {
      await result.current.extract();
    });
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.candidates.some((item) => item.sourceTerm)).toBe(true);
    expect(
      engine.calls.some((call) => call.method === "ai.quality.extractTerms"),
    ).toBe(true);
  });
});
