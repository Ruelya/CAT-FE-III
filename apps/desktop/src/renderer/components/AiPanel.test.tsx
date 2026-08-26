import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Segment } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { AiStatusProvider } from "../lib/ai-status.js";
import { AiPanel } from "./AiPanel.js";

const segment: Segment = {
  id: "s1",
  documentId: "d1",
  ordinal: 0,
  structuralPath: "p:0",
  sourceText: "Click {button} to continue.",
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

function renderPanel(
  overrides: Partial<Parameters<typeof AiPanel>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <AiStatusProvider>
      <AiPanel
        activeSegment={segment}
        onApplyDraft={vi.fn()}
        onStatusMessage={vi.fn()}
        {...overrides}
      />
    </AiStatusProvider>,
  );
}

const CONFIGURED_STATUS: EngineInvokeResponse = {
  ok: true,
  result: { configured: true, provider: "openai", model: "gpt-test" },
};

const RUNNING_ASSIST = {
  assistId: "assist-1",
  segmentId: "s1",
  action: "translate",
  status: "running",
  cancelRequested: false,
  createdAtMs: 1,
  updatedAtMs: 1,
};

function doneAssist(result: unknown): unknown {
  return {
    ...RUNNING_ASSIST,
    status: "done",
    result,
    updatedAtMs: 2,
  };
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
    renderPanel();
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
          : CONFIGURED_STATUS,
      ),
    );
    installBridge(invoke);
    renderPanel();
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

  it("sends a non-default provider and base URL through ai.configure", async () => {
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
                provider: "gemini",
                model: "gemini-2.5-flash",
              },
            },
      ),
    );
    installBridge(invoke);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByLabelText("供应商")).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByLabelText("供应商"), "gemini");
    await userEvent.type(
      screen.getByPlaceholderText("例如 gpt-5.2"),
      "gemini-2.5-flash",
    );
    await userEvent.type(
      screen.getByPlaceholderText("https://…"),
      "https://gateway.example/v1beta",
    );
    await userEvent.type(screen.getByPlaceholderText("sk-…"), "test-key");
    await userEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai.configure", {
        provider: "gemini",
        model: "gemini-2.5-flash",
        baseUrl: "https://gateway.example/v1beta",
        apiKey: "test-key",
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/gemini · gemini-2.5-flash/)).toBeInTheDocument();
    });
  });

  it("blocks Apply when the candidate breaks placeholders", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start") {
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      if (method === "ai.assist.status") {
        return Promise.resolve({
          ok: true,
          result: doneAssist({
            draftTarget: "点击按钮继续。",
            provider: "openai",
            model: "gpt-test",
            elapsedMs: 12,
            tagCheck: { ok: false, missing: ["{button}"], extra: [] },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "internal", message: `unexpected ${method}` },
      });
    });
    installBridge(invoke);
    const onApplyDraft = vi.fn();
    renderPanel({ onApplyDraft });
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));
    await waitFor(() => {
      expect(screen.getByTestId("ai-candidate")).toBeInTheDocument();
    });
    expect(screen.getByText("标签破损")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("缺失：{button}");
    expect(screen.getByRole("button", { name: "应用为草稿" })).toBeDisabled();
    // Reject stays available so the human can throw the proposal away.
    await userEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(screen.queryByTestId("ai-candidate")).not.toBeInTheDocument();
    expect(onApplyDraft).not.toHaveBeenCalled();
  });

  it("applies an intact candidate as a draft", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start") {
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      return Promise.resolve({
        ok: true,
        result: doneAssist({
          draftTarget: "点击 {button} 继续。",
          provider: "openai",
          model: "gpt-test",
          elapsedMs: 9,
          tagCheck: { ok: true, missing: [], extra: [] },
        }),
      });
    });
    installBridge(invoke);
    const onApplyDraft = vi.fn();
    renderPanel({ onApplyDraft });
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));
    await waitFor(() => {
      expect(screen.getByText("标签完整")).toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith(
      "ai.assist.start",
      expect.objectContaining({ segmentId: "s1", action: "translate" }),
    );
    expect(invoke).toHaveBeenCalledWith("ai.assist.status", {
      assistId: "assist-1",
    });
    await userEvent.click(screen.getByRole("button", { name: "应用为草稿" }));
    expect(onApplyDraft).toHaveBeenCalledWith("点击 {button} 继续。");
  });

  it("surfaces a failed assist run instead of pretending", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start") {
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      return Promise.resolve({
        ok: true,
        result: {
          ...RUNNING_ASSIST,
          status: "failed",
          errorMessage: "AI call failed: AI provider is unavailable",
          updatedAtMs: 2,
        },
      });
    });
    installBridge(invoke);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "AI provider is unavailable",
      );
    });
    expect(screen.queryByTestId("ai-candidate")).not.toBeInTheDocument();
  });

  it("cancels an in-flight assist and frees the buttons", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start" || method === "ai.assist.status") {
        // The provider never answers: the run stays in flight.
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      if (method === "ai.assist.cancel") {
        return Promise.resolve({
          ok: true,
          result: { ...RUNNING_ASSIST, cancelRequested: true },
        });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "internal", message: `unexpected ${method}` },
      });
    });
    installBridge(invoke);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "取消请求" }),
      ).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "取消请求" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai.assist.cancel", {
        assistId: "assist-1",
      });
    });
    // The panel frees up without a candidate; no result is faked.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "AI 翻译" })).toBeEnabled();
    });
    expect(screen.queryByTestId("ai-candidate")).not.toBeInTheDocument();
  });

  it("refuses to touch confirmed segments", async () => {
    installBridge(vi.fn().mockResolvedValue(CONFIGURED_STATUS));
    renderPanel({
      activeSegment: { ...segment, state: "confirmed", targetText: "已确认" },
    });
    await waitFor(() => {
      expect(screen.getByText(/不会覆盖已确认的译文/)).toBeInTheDocument();
    });
    expect(screen.queryByText("AI 翻译")).not.toBeInTheDocument();
  });
});
