import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFakeDesktopApi,
  createFakeEngineState,
  type FakeEngineState,
} from "../test/fake-desktop-api";
import { useLayoutPreview } from "./use-layout-preview";

describe("useLayoutPreview", () => {
  let engine: FakeEngineState;

  beforeEach(() => {
    engine = createFakeEngineState();
    window.translunar = createFakeDesktopApi(engine);
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.translunar;
  });

  it("exports through document.export then publishes the loopback session", async () => {
    const { result } = renderHook(() =>
      useLayoutPreview({
        generation: 1,
        mutationsEnabled: true,
        documentId: "doc-1",
        documentName: "Brief.docx",
        fileType: "docx",
        flushOrStay: async () => true,
      }),
    );

    await act(async () => {
      await result.current.show();
    });
    await waitFor(() => {
      expect(result.current.session?.fileUrl).toContain("127.0.0.1");
    });
    expect(engine.calls.some((call) => call.method === "document.export")).toBe(
      true,
    );
    expect(result.current.session?.documentType).toBe("word");
    expect(JSON.stringify(result.current.session)).not.toContain(
      "TRANSLUNAR_ONLYOFFICE_JWT_SECRET",
    );
  });
});
