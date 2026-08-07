import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../../i18n/LocaleProvider";
import { StackPanel } from "./StackPanel";

afterEach(cleanup);

vi.mock("../../../AssistantPanel", () => ({
  AssistantPanel: () => <div data-testid="assistant-panel">Assistant</div>,
}));
vi.mock("../../../PluginAiActions", () => ({
  PluginAiActions: () => null,
}));
vi.mock("../../../PluginWorkbenchPanels", () => ({
  PluginWorkbenchPanels: () => null,
}));

function renderStack(overrides: Partial<ComponentProps<typeof StackPanel>> = {}) {
  const props: ComponentProps<typeof StackPanel> = {
    projectId: "p1",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
    mode: "docked",
    onModeChange: vi.fn(),
    assistantOpen: false,
    onAssistantOpenChange: vi.fn(),
    activeSegment: {
      id: "s1",
      ordinal: 0,
      sourceText: "hello world",
      targetText: "你好世界",
      state: "draft",
      structuralPath: "",
      revision: 1,
      documentId: "d1",
      sourceHash: "h",
      contextHash: "c",
      updatedAtMs: 0,
    },
    matches: [
      {
        id: "m1",
        memoryId: "tm1",
        originDocumentId: "d0",
        originProjectId: "p1",
        originSegmentId: "seg-abc",
        sourceHash: "h2",
        sourceText: "hello there",
        targetText: "你好",
        confirmedAtMs: Date.now(),
      },
    ],
    matchesLoading: false,
    matchesError: null,
    termMatches: [
      {
        end: 5,
        entryId: "t1",
        sourceTerm: "hello",
        start: 0,
        termbaseId: "tb1",
        translations: [
          {
            createdAtMs: 0,
            entryId: "t1",
            forbidden: false,
            id: "tr1",
            locale: "zh-CN",
            preferred: true,
            term: "你好",
            updatedAtMs: 0,
          },
        ],
      },
    ],
    termLoading: false,
    termSettled: true,
    termError: null,
    onInsert: vi.fn(),
    onApplyMutation: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(
      <LocaleProvider>
        <StackPanel {...props} />
      </LocaleProvider>,
    ),
  };
}

describe("StackPanel", () => {
  it("shows Matches and Terms sections at the same time", () => {
    renderStack();
    expect(screen.getByLabelText(/matches|匹配/i)).toBeTruthy();
    expect(screen.getByLabelText(/^terms$|^术语$/i)).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("has a single primary collapse control when expanded", () => {
    renderStack({ mode: "docked" });
    const collapse = screen.getByLabelText(
      /collapse suggestions|折叠建议/i,
    );
    expect(collapse).toBeTruthy();
    expect(screen.queryByLabelText(/maximize suggestions|最大化建议/i)).toBeNull();
  });

  it("marks body inert when collapsed", () => {
    const { container } = renderStack({ mode: "collapsed" });
    const body = container.querySelector(".stack__body");
    expect(body?.getAttribute("aria-hidden")).toBe("true");
    expect(body?.hasAttribute("inert")).toBe(true);
    expect(
      screen.getByLabelText(/open suggestions|打开建议/i),
    ).toBeTruthy();
  });

  it("toggles assistant drawer open state", () => {
    const onAssistantOpenChange = vi.fn();
    renderStack({ assistantOpen: false, onAssistantOpenChange });
    fireEvent.click(
      screen.getByRole("button", { name: /assistant|助手/i }),
    );
    expect(onAssistantOpenChange).toHaveBeenCalledWith(true);
  });

  it("mounts assistant body when open", () => {
    renderStack({ assistantOpen: true });
    expect(screen.getByTestId("assistant-panel")).toBeTruthy();
  });
});
