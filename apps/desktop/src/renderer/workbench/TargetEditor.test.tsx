import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorSuggestion } from "@translunar/contracts";

import {
  TargetEditor,
  type InlineCompletionBinding,
  type SuggestionBinding,
} from "./TargetEditor";

afterEach(cleanup);

function term(text = "power supply"): EditorSuggestion {
  return { text, source: "term", hint: "term" };
}

function suggestions(
  overrides: Partial<SuggestionBinding> = {},
): SuggestionBinding {
  const item = term();
  return {
    items: [item],
    activeIndex: 0,
    request: vi.fn(),
    dismiss: vi.fn(),
    move: vi.fn(),
    accept: vi.fn(() => item),
    setActiveIndex: vi.fn(),
    onAccepted: vi.fn(),
    ...overrides,
  };
}

function inline(
  overrides: Partial<InlineCompletionBinding> = {},
): InlineCompletionBinding {
  return {
    text: "er supply",
    source: "suggest",
    onAccept: vi.fn(),
    onAcceptWord: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

function renderEditor(
  overrides: Partial<ComponentProps<typeof TargetEditor>> = {},
) {
  return render(
    <TargetEditor
      segmentId="seg-1"
      value="pow"
      editState={null}
      onChange={vi.fn()}
      onCompositionStart={vi.fn()}
      onCompositionEnd={vi.fn()}
      onConfirm={vi.fn()}
      suggestions={suggestions()}
      inlineCompletion={inline()}
      {...overrides}
    />,
  );
}

describe("TargetEditor inline completion", () => {
  it("paints the untyped suffix after the caret", () => {
    renderEditor();
    const ghost = screen.getByTestId("inline-completion");
    expect(ghost).toHaveTextContent("er supply");
    expect(ghost).toHaveAttribute("data-inline-source", "suggest");
  });

  it("hides the suffix while an IME composition is open", async () => {
    const dismiss = vi.fn();
    renderEditor({
      inlineCompletion: inline({ onDismiss: dismiss }),
    });
    const surface = screen.getByTestId("target-surface-seg-1");
    surface.focus();
    fireEvent.compositionStart(surface);
    expect(screen.queryByTestId("inline-completion")).toBeNull();
    expect(dismiss).toHaveBeenCalled();
  });

  it("lets Tab accept the dropdown, not the ghost, when both are open", async () => {
    const user = userEvent.setup();
    const onAccepted = vi.fn();
    const onAccept = vi.fn();
    const binding = suggestions({ onAccepted });
    renderEditor({
      suggestions: binding,
      inlineCompletion: inline({ onAccept }),
    });
    screen.getByTestId("target-surface-seg-1").focus();
    await user.keyboard("{Tab}");
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("accepts the AI suffix with Tab when the dropdown is empty", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onConfirm = vi.fn();
    renderEditor({
      suggestions: suggestions({ items: [], accept: vi.fn(() => null) }),
      inlineCompletion: inline({ text: " completed", source: "ai", onAccept }),
      onConfirm,
    });
    screen.getByTestId("target-surface-seg-1").focus();
    await user.keyboard("{Tab}");
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("accepts one word with Ctrl+ArrowRight", async () => {
    const user = userEvent.setup();
    const onAcceptWord = vi.fn();
    renderEditor({
      inlineCompletion: inline({ onAcceptWord }),
    });
    screen.getByTestId("target-surface-seg-1").focus();
    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    expect(onAcceptWord).toHaveBeenCalledTimes(1);
  });

  it("keeps Ctrl+Enter as confirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onAccept = vi.fn();
    renderEditor({
      onConfirm,
      inlineCompletion: inline({ onAccept }),
    });
    screen.getByTestId("target-surface-seg-1").focus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
