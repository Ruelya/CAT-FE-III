import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Segment } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { AiPanel } from "./AiPanel.js";

const segment: Segment = {
  id: "s1",
  documentId: "d1",
  ordinal: 0,
  structuralPath: "p:0",
  sourceText: "Hello.",
  targetText: "",
  state: "untranslated",
  revision: 1,
  sourceHash: "hash",
  contextHash: "context",
  updatedAtMs: 1,
};

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
): void {
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

describe("AiPanel", () => {
  it("shows the honest unconfigured state instead of fake output", async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: true,
        result: { configured: false, provider: null, model: null },
      }),
    );
    render(
      <AiPanel
        activeSegment={segment}
        onApplyDraft={vi.fn()}
        onStatusMessage={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("未配置")).toBeInTheDocument();
    });
    expect(screen.getByText(/不会假装成功/)).toBeInTheDocument();
    expect(screen.queryByText("AI 翻译")).not.toBeInTheDocument();
  });

  it("submits provider configuration through ai.configure", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> =>
      Promise.resolve(
        method === "ai.status"
          ? {
              ok: true,
              result: { configured: false, provider: null, model: null },
            }
          : {
              ok: true,
              result: {
                configured: true,
                provider: "openai",
                model: "gpt-test",
              },
            },
      ),
    );
    installBridge(invoke);
    render(
      <AiPanel
        activeSegment={segment}
        onApplyDraft={vi.fn()}
        onStatusMessage={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText("例如 gpt-5.2")).toBeInTheDocument();
    });
    await userEvent.type(
      screen.getByPlaceholderText("例如 gpt-5.2"),
      "gpt-test",
    );
    await userEvent.type(screen.getByPlaceholderText("sk-…"), "sk-test");
    await userEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ai.configure",
        expect.objectContaining({
          provider: "openai",
          model: "gpt-test",
          apiKey: "sk-test",
        }),
      );
    });
    // The configured badge replaces the credential form.
    await waitFor(() => {
      expect(screen.getByText(/openai · gpt-test/)).toBeInTheDocument();
    });
  });
});
