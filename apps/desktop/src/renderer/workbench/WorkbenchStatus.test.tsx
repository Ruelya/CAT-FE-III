import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Document, SegmentCounts } from "@translunar/contracts";

import {
  formatDocumentProgress,
  WorkbenchStatus,
} from "./WorkbenchStatus";

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
} as unknown as Document;

const counts: SegmentCounts = {
  total: 10,
  confirmed: 0,
  draft: 0,
  untranslated: 10,
  openIssues: 0,
};

function renderStatus(
  overrides: Partial<ComponentProps<typeof WorkbenchStatus>> = {},
) {
  return render(
    <WorkbenchStatus
      documentName="real.docx"
      documents={[document]}
      activeDocumentId="doc-1"
      sourceLocale="en-US"
      targetLocale="zh-CN"
      segmentLabel="Segment 1 of 10"
      counts={counts}
      wordCount={0}
      headerBusy={false}
      autocomplete={true}
      onSelectDocument={vi.fn()}
      onAddFiles={vi.fn()}
      onPretranslate={vi.fn()}
      onAutocompleteChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("formatDocumentProgress", () => {
  it("reads as a sentence, not four chips", () => {
    expect(formatDocumentProgress(counts)).toBe("0 of 10 confirmed");
  });
});

describe("WorkbenchStatus", () => {
  it("keeps job actions on the status line, not a second header", () => {
    renderStatus();
    expect(screen.getByRole("heading", { name: "real.docx" })).toHaveClass(
      "sr-only",
    );
    expect(screen.getByLabelText("Document")).toBeInTheDocument();
    expect(screen.getByTestId("status-locales")).toHaveTextContent(
      "en-US → zh-CN",
    );
    expect(screen.getByTestId("add-files")).toBeInTheDocument();
    expect(screen.getByTestId("pretranslate")).toBeInTheDocument();
    expect(screen.queryByLabelText("This file")).toBeNull();
    expect(screen.queryByLabelText("Job")).toBeNull();
  });

  it("toggles AutoSuggest through the preference callback", async () => {
    const user = userEvent.setup();
    const onAutocompleteChange = vi.fn();
    renderStatus({ onAutocompleteChange });
    await user.click(screen.getByTestId("toggle-autosuggest"));
    expect(onAutocompleteChange).toHaveBeenCalledWith(false);
  });
});
