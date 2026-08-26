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
  onWaiveRule: () => {},
  onWaiveSegment: () => {},
  onRestore: () => {},
};

describe("QaPanel", () => {
  it("keeps the honest empty state when no check ever ran", () => {
    render(
      <QaPanel issues={[]} disabled={false} pendingKey={null} {...NOOP} />,
    );
    expect(screen.getByText("尚未运行检查")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "忽略" })).toBeNull();
    expect(screen.getByRole("button", { name: "运行 QA" })).toBeInTheDocument();
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
        pendingKey={null}
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
        pendingKey={null}
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
    // The waived card keeps the recorded note.
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
        pendingKey={null}
        {...NOOP}
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
        issues={[
          issue("open-1", "open", { ruleId: "qa.edge-whitespace" }),
          issue("open-2", "open"),
        ]}
        disabled={false}
        pendingKey="open-1"
        {...NOOP}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "忽略" });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeEnabled();
  });

  it("offers 忽略同类 only when other open issues share the rule", async () => {
    const onWaiveRule = vi.fn();
    const first = issue("open-1", "open");
    const second = issue("open-2", "open");
    const lonely = issue("open-3", "open", { ruleId: "qa.edge-whitespace" });
    render(
      <QaPanel
        issues={[first, second, lonely]}
        disabled={false}
        pendingKey={null}
        {...NOOP}
        onWaiveRule={onWaiveRule}
      />,
    );
    // Two rows share qa.number-mismatch → both carry the batch button; the
    // lonely rule's row does not (its 忽略 already covers everything).
    const ruleButtons = screen.getAllByRole("button", {
      name: "忽略本文档全部 qa.number-mismatch 问题",
    });
    expect(ruleButtons).toHaveLength(2);
    await userEvent.click(ruleButtons[0]!);
    expect(onWaiveRule).toHaveBeenCalledWith(first);
  });

  it("offers 忽略本句 only when the segment has more than one open issue", async () => {
    const onWaiveSegment = vi.fn();
    const first = issue("open-1", "open", { segmentId: "seg-shared" });
    const second = issue("open-2", "open", {
      segmentId: "seg-shared",
      ruleId: "qa.edge-whitespace",
    });
    const other = issue("open-3", "open");
    render(
      <QaPanel
        issues={[first, second, other]}
        disabled={false}
        pendingKey={null}
        {...NOOP}
        onWaiveSegment={onWaiveSegment}
      />,
    );
    const segmentButtons = screen.getAllByRole("button", {
      name: "忽略该句段全部问题",
    });
    expect(segmentButtons).toHaveLength(2);
    await userEvent.click(segmentButtons[0]!);
    expect(onWaiveSegment).toHaveBeenCalledWith(first);
    // A batch in flight locks the matching batch buttons.
  });

  it("locks batch buttons by their pending key", () => {
    render(
      <QaPanel
        issues={[issue("open-1", "open"), issue("open-2", "open")]}
        disabled={false}
        pendingKey="rule:qa.number-mismatch"
        {...NOOP}
      />,
    );
    for (const button of screen.getAllByRole("button", {
      name: "忽略本文档全部 qa.number-mismatch 问题",
    })) {
      expect(button).toBeDisabled();
    }
    // The per-issue buttons stay usable; they are a different call.
    for (const button of screen.getAllByRole("button", { name: "忽略" })) {
      expect(button).toBeEnabled();
    }
  });

  it("localizes behavioral findings from engine params and hides their evidence line", () => {
    render(
      <QaPanel
        issues={[
          issue("fuzzy-1", "open", {
            ruleId: "qa.unedited-fuzzy",
            severity: "warning",
            message: "Fuzzy TM match was confirmed without edits.",
            params: { score: "82" },
            evidence: {
              sourceNumbers: [],
              targetNumbers: [],
              sourceValues: [],
              targetValues: ["保存文件。"],
              relatedSegmentIds: [],
            },
          }),
        ]}
        disabled={false}
        pendingKey={null}
        {...NOOP}
      />,
    );
    expect(
      screen.getByText("模糊匹配（82%）未修改即确认"),
    ).toBeInTheDocument();
    // The pinned target text is fingerprint evidence, not a 源 ≠ 译 diff.
    expect(document.querySelectorAll(".issue-card__evidence")).toHaveLength(0);
  });
});
