import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Document Matrix 文档矩阵
 *
 * 3 列打孔卡圆点矩阵，取代原生滚动条。每个点聚合若干段落，
 * 状态实时映射全文档。回答三个问题：我在哪 / 还剩多少 / 问题在哪。
 *
 * 交互：点击跳转 · 拖拽视口括号 · 键盘导航 · hover tooltip
 *
 * Source: docs/design-ii/03-signatures.md §2
 */

const COLS = 3;
const DOT_GAP = 4;

export type SegmentState = "untranslated" | "draft" | "confirmed" | "error";

export interface MatrixCell {
  /** 该点聚合的段落起始索引（0-based） */
  startIndex: number;
  /** 该点聚合的段落数 */
  count: number;
  /** 聚合后的显示状态（优先级：error > untranslated > draft > confirmed） */
  state: SegmentState;
}

interface DocumentMatrixProps {
  /** 全部段落状态数组（按文档顺序） */
  segmentStates: readonly SegmentState[];
  /** 当前活动段索引（0-based） */
  activeIndex: number;
  /** 可见区间：[起始索引, 结束索引] */
  viewportRange: readonly [number, number];
  /** 点击某个点时跳转到对应段落 */
  onNavigate: (segmentIndex: number) => void;
}

export function DocumentMatrix({
  segmentStates,
  activeIndex,
  viewportRange,
  onNavigate,
}: DocumentMatrixProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(20);

  // 根据容器高度动态计算行数
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      const dotWidth = (box.width - 12) / COLS;  // 减去 padding
      const pitch = dotWidth + DOT_GAP;
      const available = box.height - 16;  // 减去 padding
      setRows(Math.max(10, Math.floor(available / pitch)));
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cells = useMemo(
    () => aggregateCells(segmentStates, rows * COLS),
    [segmentStates, rows],
  );

  const activeCellIndex = useMemo(
    () => cells.findIndex(
      (c) => activeIndex >= c.startIndex && activeIndex < c.startIndex + c.count,
    ),
    [cells, activeIndex],
  );

  // 视口括号位置：转换段落索引 → 像素偏移
  const viewportStyle = useMemo(() => {
    if (cells.length === 0) return undefined;

    const total = segmentStates.length;
    const [vpStart, vpEnd] = viewportRange;
    const startRatio = vpStart / Math.max(total, 1);
    const endRatio = Math.min(vpEnd / Math.max(total, 1), 1);

    return {
      "--vp-top": `${startRatio * 100}%`,
      "--vp-h": `${Math.max((endRatio - startRatio) * 100, 2)}%`,
    } as React.CSSProperties;
  }, [cells.length, segmentStates.length, viewportRange]);

  return (
    <div
      ref={containerRef}
      className="doc-matrix"
      role="navigation"
      aria-label="文档段落矩阵"
    >
      {cells.map((cell, i) => (
        <button
          key={cell.startIndex}
          type="button"
          className="doc-matrix__dot"
          data-state={cell.state}
          data-active={i === activeCellIndex || undefined}
          style={{ "--i": i } as React.CSSProperties}
          title={formatTooltip(cell)}
          aria-label={formatTooltip(cell)}
          onClick={() => onNavigate(cell.startIndex)}
        />
      ))}

      {viewportStyle && (
        <div
          className="doc-matrix__viewport"
          style={viewportStyle}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * 将段落状态数组聚合为固定数量的矩阵单元
 *
 * 聚合优先级：error > untranslated > draft > confirmed
 * 确保问题段落永不被"淹没"在大量已确认段落中。
 */
function aggregateCells(
  states: readonly SegmentState[],
  cellCount: number,
): MatrixCell[] {
  if (states.length === 0 || cellCount === 0) return [];

  const perCell = Math.ceil(states.length / cellCount);
  const cells: MatrixCell[] = [];

  for (let i = 0; i < states.length; i += perCell) {
    const slice = states.slice(i, i + perCell);
    cells.push({
      startIndex: i,
      count: slice.length,
      state: dominantState(slice),
    });
  }

  return cells;
}

function dominantState(states: readonly SegmentState[]): SegmentState {
  if (states.includes("error")) return "error";
  if (states.includes("untranslated")) return "untranslated";
  if (states.includes("draft")) return "draft";
  return "confirmed";
}

function formatTooltip(cell: MatrixCell): string {
  const stateLabel: Record<SegmentState, string> = {
    untranslated: "未翻译",
    draft: "草稿",
    confirmed: "已确认",
    error: "有问题",
  };

  const from = cell.startIndex + 1;
  const to = cell.startIndex + cell.count;
  const range = cell.count === 1 ? `段 ${from}` : `段 ${from}–${to}`;

  return `${range} · ${stateLabel[cell.state]}`;
}
