import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEditorShortcuts } from "./use-editor-shortcuts";

afterEach(cleanup);

function Harness({
  enabled,
  onSave,
}: {
  enabled: boolean;
  onSave: () => void;
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
