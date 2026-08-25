import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { QaIssue } from "@translunar/contracts";

import { QaPanel } from "./QaPanel.js";

function issue(
  id: string,
  status: QaIssue["status"],
  overrides: Partial<QaIssue> = {},
): QaIssue {
  return {
    id,
    segmentId: `seg-${id}`,
    ruleId: "qa.number-mismatch",
    severity: "error",
    status,
    message: `数字不一致 ${id}`,
    fingerprint: `fp-${id}`,
    evidence: {
      sourceNumbers: ["30"],
      targetNumbers: ["40"],
      sourceValues: [],
      targetValues: [],
      relatedSegmentIds: [],
    },
    waiveNote: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

const NOOP = {
  onRun: () => {},
  onJump: () => {},
  onWaive: () => {},
  onRestore: () => {},
};

describe("QaPanel", () => {
  it("keeps the honest empty state when no check ever ran", () => {
    render(
      <QaPanel issues={[]} disabled={false} pendingIssueId={null} {...NOOP} />,
    );
    expect(screen.getByText("尚未运行检查")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "忽略" })).toBeNull();
    // One button runs the whole rule library; neither the button nor the
    // hint may claim QA is numbers-only.
    expect(screen.getByRole("button", { name: "运行 QA" })).toBeInTheDocument();
    expect(screen.getByText(/内联标签\/占位符完整性/)).toBeInTheDocument();
  });

  it("renders token evidence for tag issues and hides empty evidence", () => {
    render(
      <QaPanel
        issues={[
          issue("tag-1", "open", {
            ruleId: "qa.tag-placeholder_missing",
            message: "Target is missing inline tags or placeholders.",
            evidence: {
              sourceNumbers: [],
              targetNumbers: [],
              sourceValues: ["{button}", "{link}"],
              targetValues: [],
              relatedSegmentIds: [],
            },
          }),
          issue("plain-1", "open", {
            ruleId: "qa.edge-whitespace",
            message: "译文首尾有空白。",
            evidence: {
              sourceNumbers: [],
              targetNumbers: [],
              sourceValues: [],
              targetValues: [],
              relatedSegmentIds: [],
            },
          }),
        ]}
        disabled={false}
        pendingIssueId={null}
        {...NOOP}
      />,
    );
    // The tag issue shows the exact tokens as evidence.
    expect(screen.getByText(/源 \[\{button\}, \{link\}\]/)).toBeInTheDocument();
    // A rule without side-by-side evidence renders no empty bracket line.
    const evidenceLines = document.querySelectorAll(".issue-card__evidence");
    expect(evidenceLines).toHaveLength(1);
  });

  it("orders open, waived, resolved and offers 忽略 only on open issues", () => {
    render(
      <QaPanel
        issues={[
          issue("resolved-1", "resolved"),
          issue("waived-1", "waived", { waiveNote: "客户已确认" }),
          issue("open-1", "open"),
        ]}
        disabled={false}
        pendingIssueId={null}
        {...NOOP}
      />,
    );
    // The title counts only truly open issues; waived is not resolved and
    // not open.
    expect(screen.getByText("质量检查（未解决 1）")).toBeInTheDocument();
    const cards = document.querySelectorAll(".issue-card");
    expect(
      Array.from(cards).map((card) => card.getAttribute("data-status")),
    ).toEqual(["open", "waived", "resolved"]);
    // One 忽略 (open card), one 恢复 (waived card), never both on one card.
    expect(screen.getAllByRole("button", { name: "忽略" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "恢复" })).toHaveLength(1);
    // The waived card says honestly that nothing was fixed or written.
    expect(
      screen.getByText(/已忽略：问题仍存在，未确认句段、未写入 TM/),
    ).toBeInTheDocument();
    expect(screen.getByText(/备注：客户已确认/)).toBeInTheDocument();
  });

  it("fires onWaive / onRestore with the exact issue", async () => {
    const onWaive = vi.fn();
    const onRestore = vi.fn();
    const open = issue("open-1", "open");
    const waived = issue("waived-1", "waived");
    render(
      <QaPanel
        issues={[open, waived]}
        disabled={false}
        pendingIssueId={null}
        onRun={() => {}}
        onJump={() => {}}
        onWaive={onWaive}
        onRestore={onRestore}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "忽略" }));
    expect(onWaive).toHaveBeenCalledWith(open);
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(onRestore).toHaveBeenCalledWith(waived);
  });

  it("locks the button of the issue whose call is in flight", () => {
    render(
      <QaPanel
        issues={[issue("open-1", "open"), issue("open-2", "open")]}
        disabled={false}
        pendingIssueId="open-1"
        {...NOOP}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "忽略" });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeEnabled();
  });
});
