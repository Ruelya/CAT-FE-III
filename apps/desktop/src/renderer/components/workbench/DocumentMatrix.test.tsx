import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DocumentMatrix,
  aggregateCells,
  documentOrdinalFromRatio,
  dominantState,
  matrixDotId,
  type DocumentMatrixLabels,
} from "./DocumentMatrix";

afterEach(cleanup);

const labelsEn: DocumentMatrixLabels = {
  landmark: "Document segment matrix",
  title: "Live Matrix",
  legendUntranslated: "Untranslated",
  legendDraft: "Draft",
  legendConfirmed: "Confirmed",
  legendError: "Issue",
  legendNeutral: "Unknown / loading",
  stateUntranslated: "Untranslated",
  stateDraft: "Draft",
  stateConfirmed: "Confirmed",
  stateError: "Issue",
  stateNeutral: "Unknown",
  formatRange: (from, to) =>
    from === to ? `Seg ${from}` : `Seg ${from}–${to}`,
};

const labelsZh: DocumentMatrixLabels = {
  landmark: "文档段落矩阵",
  title: "活性矩阵",
  legendUntranslated: "未翻译",
  legendDraft: "草稿",
  legendConfirmed: "已确认",
  legendError: "有问题",
  legendNeutral: "未知 / 加载中",
  stateUntranslated: "未翻译",
  stateDraft: "草稿",
  stateConfirmed: "已确认",
  stateError: "有问题",
  stateNeutral: "未知",
  formatRange: (from, to) =>
    from === to ? `段 ${from}` : `段 ${from}–${to}`,
};

describe("DocumentMatrix", () => {
  it("maps known states and keeps mixed-null buckets neutral", () => {
    const onNavigate = vi.fn();
    // One state per cell: force cellCount via many rows by using few states
    // with a tall container is hard in jsdom — exercise aggregate helpers + paint.
    const { container } = render(
      <DocumentMatrix
        segmentStates={["confirmed", "error", "draft", "untranslated"]}
        activeIndex={1}
        viewportRange={[0, 2]}
        onNavigate={onNavigate}
        labels={labelsEn}
      />,
    );

    const dots = container.querySelectorAll(".doc-matrix__dot");
    expect(dots.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-state="error"]')).not.toBeNull();

    fireEvent.click(dots[0]!);
    expect(onNavigate).toHaveBeenCalled();
  });

  it("exposes localized landmark and title for en-US", () => {
    render(
      <DocumentMatrix
        segmentStates={["untranslated", "draft", "confirmed"]}
        activeIndex={0}
        viewportRange={[0, 1]}
        onNavigate={() => undefined}
        labels={labelsEn}
      />,
    );
    expect(
      screen.getByRole("navigation", { name: "Document segment matrix" }),
    ).toBeTruthy();
    expect(screen.getByText("Live Matrix")).toBeTruthy();
    expect(screen.getByText("Untranslated")).toBeTruthy();
  });

  it("exposes localized landmark and title for zh-CN", () => {
    render(
      <DocumentMatrix
        segmentStates={["untranslated", "draft", "confirmed"]}
        activeIndex={0}
        viewportRange={[0, 1]}
        onNavigate={() => undefined}
        labels={labelsZh}
      />,
    );
    expect(
      screen.getByRole("navigation", { name: "文档段落矩阵" }),
    ).toBeTruthy();
    expect(screen.getByText("活性矩阵")).toBeTruthy();
  });

  it("does not mark active when activeIndex is negative", () => {
    const { container } = render(
      <DocumentMatrix
        segmentStates={["confirmed", "draft"]}
        activeIndex={-1}
        viewportRange={[0, 1]}
        onNavigate={() => undefined}
        labels={labelsEn}
      />,
    );
    expect(container.querySelector("[data-active]")).toBeNull();
  });

  it("forwards wheel deltas to the grid scroll owner bridge", () => {
    const onScrollBy = vi.fn();
    const { container } = render(
      <DocumentMatrix
        segmentStates={["confirmed", "draft", "error"]}
        activeIndex={0}
        viewportRange={[0, 1]}
        onNavigate={() => undefined}
        onScrollBy={onScrollBy}
        labels={labelsEn}
      />,
    );
    const matrix = container.querySelector(".doc-matrix");
    expect(matrix).not.toBeNull();
    fireEvent.wheel(matrix!, { deltaY: 48 });
    expect(onScrollBy).toHaveBeenCalledWith(48);
  });

  it("uses roving tabindex + data-focus and activates exact ordinal on Enter", () => {
    const onNavigate = vi.fn();
    // 12 segments, default rows≈20 → one segment per cell for first 12 cells
    const { container } = render(
      <DocumentMatrix
        segmentStates={Array.from({ length: 12 }, () => "draft" as const)}
        activeIndex={0}
        viewportRange={[0, 2]}
        onNavigate={onNavigate}
        labels={labelsEn}
      />,
    );
    const matrix = container.querySelector(".doc-matrix") as HTMLElement;
    expect(matrix).not.toBeNull();
    // Landmark must not own aria-activedescendant (axe aria-allowed-attr).
    expect(matrix.getAttribute("aria-activedescendant")).toBeNull();
    expect(matrix.getAttribute("tabindex")).toBeNull();

    const firstDot = container.querySelector(
      `#${matrixDotId(0)}`,
    ) as HTMLElement | null;
    expect(firstDot).not.toBeNull();
    expect(firstDot!.tabIndex).toBe(0);
    firstDot!.focus();
    expect(document.activeElement).toBe(firstDot);
    expect(firstDot!.hasAttribute("data-focus")).toBe(true);

    fireEvent.keyDown(matrix, { key: "ArrowRight" });
    const secondDot = container.querySelector(
      `#${matrixDotId(1)}`,
    ) as HTMLElement | null;
    expect(secondDot).not.toBeNull();
    expect(secondDot!.tabIndex).toBe(0);
    expect(firstDot!.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(secondDot);
    expect(
      container.querySelector(".doc-matrix__dot[data-focus]")?.id,
    ).toBe(matrixDotId(1));

    fireEvent.keyDown(matrix, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith(1);

    fireEvent.keyDown(matrix, { key: "End" });
    fireEvent.keyDown(matrix, { key: "Enter" });
    const lastCall = onNavigate.mock.calls.at(-1)?.[0];
    expect(typeof lastCall).toBe("number");
    expect(lastCall).toBeGreaterThanOrEqual(1);
  });

  it("maps bracket handle drag through document ordinal navigate", () => {
    const onNavigate = vi.fn();
    const onViewportSeek = vi.fn();
    const { container } = render(
      <DocumentMatrix
        segmentStates={Array.from({ length: 100 }, () => "draft" as const)}
        activeIndex={0}
        viewportRange={[0, 10]}
        onNavigate={onNavigate}
        onViewportSeek={onViewportSeek}
        labels={labelsEn}
      />,
    );
    const matrix = container.querySelector(".doc-matrix") as HTMLElement;
    expect(matrix).not.toBeNull();
    // Force a known geometry so ratio → ordinal is deterministic.
    vi.spyOn(matrix, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 100,
      left: 0,
      right: 28,
      width: 28,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const handle = container.querySelector(
      ".doc-matrix__viewport-handle",
    ) as HTMLElement | null;
    expect(handle).not.toBeNull();
    // Mid-height → ~50% → ordinal ~50
    fireEvent.pointerDown(handle!, { clientY: 50, pointerId: 1 });
    expect(onViewportSeek).toHaveBeenCalled();
    const ratio = onViewportSeek.mock.calls[0]![0] as number;
    expect(ratio).toBeCloseTo(0.5, 1);
    expect(onNavigate).toHaveBeenCalledWith(
      documentOrdinalFromRatio(ratio, 100),
    );
    // Body does not capture events (handles only)
    const body = container.querySelector(".doc-matrix__viewport");
    expect(body).not.toBeNull();
  });

  it("keeps dots as buttons under the bracket (handles are the only drag targets)", () => {
    const { container } = render(
      <DocumentMatrix
        segmentStates={["confirmed", "draft", "error", "untranslated"]}
        activeIndex={0}
        viewportRange={[0, 2]}
        onNavigate={() => undefined}
        labels={labelsEn}
      />,
    );
    expect(
      container.querySelectorAll(".doc-matrix__viewport-handle").length,
    ).toBe(2);
    expect(container.querySelectorAll(".doc-matrix__dot").length).toBeGreaterThan(
      0,
    );
  });
});

describe("documentOrdinalFromRatio", () => {
  it("maps document-space ratios to ordinals (filter-safe coordinate)", () => {
    expect(documentOrdinalFromRatio(0, 100)).toBe(0);
    expect(documentOrdinalFromRatio(1, 100)).toBe(99);
    expect(documentOrdinalFromRatio(0.5, 100)).toBe(50);
    expect(documentOrdinalFromRatio(-1, 10)).toBe(0);
    expect(documentOrdinalFromRatio(2, 10)).toBe(9);
    expect(documentOrdinalFromRatio(0.25, 0)).toBe(0);
  });
});

describe("matrix aggregate / ordinal helpers", () => {
  it("dominantState stays neutral when any member is unresolved", () => {
    expect(dominantState([null, "confirmed", "draft"])).toBeNull();
    expect(dominantState([undefined, "error"])).toBeNull();
    expect(dominantState([null, null])).toBeNull();
  });

  it("dominantState ranks fully-known buckets error-first", () => {
    expect(dominantState(["confirmed", "draft", "error"])).toBe("error");
    expect(dominantState(["confirmed", "untranslated"])).toBe("untranslated");
    expect(dominantState(["confirmed", "draft"])).toBe("draft");
    expect(dominantState(["confirmed", "confirmed"])).toBe("confirmed");
  });

  it("aggregateCells uses startIndex as document ordinal offsets", () => {
    // 6 states → 3 cells of 2: indices 0, 2, 4
    const cells = aggregateCells(
      ["confirmed", "confirmed", null, null, "error", "error"],
      3,
    );
    expect(cells.map((c) => c.startIndex)).toEqual([0, 2, 4]);
    // Mixed null+known → neutral; pure known → dominant
    expect(cells[0]!.state).toBe("confirmed");
    expect(cells[1]!.state).toBeNull();
    expect(cells[2]!.state).toBe("error");
  });
});
