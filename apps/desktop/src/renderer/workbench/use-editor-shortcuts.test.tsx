import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEditorShortcuts } from "./use-editor-shortcuts";

afterEach(cleanup);

function Harness({
  enabled,
  onSave,
  onWorkflowTranslation,
  onWorkflowReview,
  onToggleDockFocus,
}: {
  enabled: boolean;
  onSave: () => void;
  onWorkflowTranslation?: () => void;
  onWorkflowReview?: () => void;
  onToggleDockFocus?: () => void;
}) {
  useEditorShortcuts(enabled, {
    onConcordance: () => undefined,
    onQuickAddTerm: () => undefined,
    onCopySource: () => undefined,
    onClearTarget: () => undefined,
    onGoTo: () => undefined,
    onPretranslate: () => undefined,
    onPlaceTags: () => undefined,
    onSave,
    ...(onWorkflowTranslation ? { onWorkflowTranslation } : {}),
    ...(onWorkflowReview ? { onWorkflowReview } : {}),
    ...(onToggleDockFocus ? { onToggleDockFocus } : {}),
  });
  return <div>editor</div>;
}

describe("useEditorShortcuts", () => {
  it("flushes the draft on Ctrl+S", () => {
    const onSave = vi.fn();
    render(<Harness enabled onSave={onSave} />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("switches workflow with Ctrl+Alt+T and Ctrl+Alt+R", () => {
    const onSave = vi.fn();
    const onWorkflowTranslation = vi.fn();
    const onWorkflowReview = vi.fn();
    render(
      <Harness
        enabled
        onSave={onSave}
        onWorkflowTranslation={onWorkflowTranslation}
        onWorkflowReview={onWorkflowReview}
      />,
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "r",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      }),
    );
    expect(onWorkflowTranslation).toHaveBeenCalledTimes(1);
    expect(onWorkflowReview).toHaveBeenCalledTimes(1);
  });

  it("hops between the grid and the dock on F6", () => {
    const onToggleDockFocus = vi.fn();
    render(
      <Harness
        enabled
        onSave={() => undefined}
        onToggleDockFocus={onToggleDockFocus}
      />,
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F6", bubbles: true }),
    );
    expect(onToggleDockFocus).toHaveBeenCalledTimes(1);
    // Ctrl+F6 stays with the platform (window cycling on some desktops).
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F6", ctrlKey: true, bubbles: true }),
    );
    expect(onToggleDockFocus).toHaveBeenCalledTimes(1);
  });

  it("does not steal Ctrl+Shift+S", () => {
    const onSave = vi.fn();
    render(<Harness enabled onSave={onSave} />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
