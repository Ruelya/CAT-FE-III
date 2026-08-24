import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import { PdfOcrCorrectDialog } from "./PdfOcrCorrectDialog";

describe("PdfOcrCorrectDialog", () => {
  it("does not submit blank text even when a suggestion is shown", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onUse = vi.fn();
    render(
      <PdfOcrCorrectDialog
        sourceText=""
        pending={false}
        error={null}
        canSubmit={false}
        ai={{
          pending: false,
          error: null,
          proposal: "Corrected invoice",
          profilesLoaded: true,
          runnable: true,
        }}
        onSuggestAi={() => undefined}
        onUseAiSuggestion={onUse}
        onSourceTextChange={() => undefined}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByTestId("pdf-ocr-ai-proposal")).toHaveTextContent(
      "Corrected invoice",
    );
    await user.click(screen.getByTestId("pdf-ocr-ai-use"));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("pdf-ocr-save")).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows an honest empty-profile state", () => {
    render(
      <PdfOcrCorrectDialog
        sourceText="OCR text"
        pending={false}
        error={null}
        canSubmit={false}
        ai={{
          pending: false,
          error: null,
          proposal: "",
          profilesLoaded: true,
          runnable: false,
        }}
        onSourceTextChange={() => undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByTestId("pdf-ocr-ai-no-profile")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-ocr-ai-suggest")).toBeNull();
  });
});
