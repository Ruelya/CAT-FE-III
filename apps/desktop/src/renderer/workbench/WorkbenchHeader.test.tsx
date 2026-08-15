import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Document, SegmentCounts } from "@translunar/contracts";

import {
  formatDocumentProgress,
  WorkbenchHeader,
} from "./WorkbenchHeader";

afterEach(cleanup);

const document: Document = {
  id: "doc-1",
  projectId: "proj-1",
  name: "real.docx",
  sourceLocale: "en",
  targetLocale: "zh",
  revision: 1,
  segmentCount: 10,
  createdAtMs: 1,
  updatedAtMs: 1,
  kind: "working",
} as Document;

const counts: SegmentCounts = {
  total: 10,
  confirmed: 0,
  draft: 0,
  untranslated: 10,
  openIssues: 0,
};

function renderHeader(
  overrides: Partial<ComponentProps<typeof WorkbenchHeader>> = {},
) {
  return render(
    <WorkbenchHeader
      documentName="real.docx"
      projectName="Suggest"
      documents={[document]}
      activeDocumentId="doc-1"
      counts={counts}
      headerBusy={false}
      previewOpen={true}
      autocomplete={true}
      onPreviewOpenChange={vi.fn()}
      onAutocompleteChange={vi.fn()}
      onSelectDocument={vi.fn()}
      onAddFiles={vi.fn()}
      onPretranslate={vi.fn()}
      onQa={vi.fn()}
      onExport={vi.fn()}
      {...overrides}
    />,
  );
}

describe("formatDocumentProgress", () => {
  it("reads as a sentence, not four chips", () => {
    expect(formatDocumentProgress(counts)).toBe("0 of 10 confirmed");
  });
});

describe("WorkbenchHeader", () => {
  it("groups file, progress, view, and job", () => {
    renderHeader();
    expect(screen.getByRole("heading", { name: "real.docx" })).toHaveClass(
      "sr-only",
    );
    expect(screen.getByLabelText("This file")).toBeInTheDocument();
    expect(screen.getByLabelText("Progress")).toHaveTextContent(
      "0 of 10 confirmed",
    );
    expect(screen.getByTestId("toggle-preview")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("toggle-autosuggest")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("workbench-export")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Insights" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Recycle" })).toBeNull();
  });

  it("toggles AutoSuggest through the preference callback", async () => {
    const user = userEvent.setup();
    const onAutocompleteChange = vi.fn();
    renderHeader({ onAutocompleteChange });
    await user.click(screen.getByTestId("toggle-autosuggest"));
    expect(onAutocompleteChange).toHaveBeenCalledWith(false);
  });

  it("keeps Preview as a pressed word, not Hide preview", () => {
    renderHeader({ previewOpen: true });
    expect(screen.getByTestId("toggle-preview")).toHaveTextContent("Preview");
    expect(screen.queryByText("Hide preview")).toBeNull();
  });
});
