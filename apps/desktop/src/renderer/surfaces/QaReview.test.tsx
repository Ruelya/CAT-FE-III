import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QaIssueView } from "@translunar/contracts";

import type { SessionContext } from "../state/app-state";
import { QaReview } from "./QaReview";

const ctx = {
  session: { version: 1 as const, projectId: "p1", documentId: "d1" },
  project: { id: "p1", name: "Job" },
  document: { id: "d1", name: "guide.docx" },
  documents: [{ id: "d1", name: "guide.docx" }],
} as unknown as SessionContext;

function issue(overrides: Partial<QaIssueView> = {}): QaIssueView {
  return {
    id: "iss-1",
    projectId: "p1",
    documentId: "d1",
    documentName: "guide.docx",
    segmentId: "seg-1",
    segmentOrdinal: 2,
    category: "tags",
    createdAtMs: 1,
    updatedAtMs: 1,
    disposition: "open",
    evidence: {},
    fingerprint: "fp-1",
    message: "Missing protected tag R",
    ruleId: "qa.tag-tag_missing",
    severity: "error",
    ...overrides,
  };
}

describe("QaReview waive reason", () => {
  afterEach(() => {
    cleanup();
  });

  it("states why a reason is stored and shows it on the waived row", async () => {
    const user = userEvent.setup();
    const onWaive = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <QaReview
        ctx={ctx}
        issues={[issue()]}
        issuesLoaded
        run={null}
        loading={false}
        error={null}
        scope="file"
        onScopeChange={() => undefined}
        onRun={() => undefined}
        onJump={() => undefined}
        onWaive={onWaive}
        onRevoke={async () => true}
        onBack={() => undefined}
        onExport={() => undefined}
      />,
    );

    await user.click(screen.getByTestId("waive-iss-1"));
    const dialog = screen.getByTestId("waive-confirm");
    expect(dialog).toHaveTextContent("The note is stored on this finding");
    expect(dialog).toHaveTextContent("Export then ignores it");
    expect(dialog).toHaveTextContent("Missing protected tag R");
    expect(
      screen.getByLabelText("Why export may ignore this"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Client accepted" }));
    await user.click(within(dialog).getByRole("button", { name: "Waive" }));
    expect(onWaive).toHaveBeenCalledWith("iss-1", "Client accepted");

    rerender(
      <QaReview
        ctx={ctx}
        issues={[
          issue({
            disposition: "waived",
            waiver: {
              id: "w1",
              issueId: "iss-1",
              actor: "desktop",
              reason: "Client accepted",
              revision: 1,
              createdAtMs: 1,
              fingerprint: "fp-1",
            },
          }),
        ]}
        issuesLoaded
        run={null}
        loading={false}
        error={null}
        scope="file"
        onScopeChange={() => undefined}
        onRun={() => undefined}
        onJump={() => undefined}
        onWaive={onWaive}
        onRevoke={async () => true}
        onBack={() => undefined}
        onExport={() => undefined}
      />,
    );
    expect(screen.getByText("Waived: Client accepted")).toBeInTheDocument();
  });
});
