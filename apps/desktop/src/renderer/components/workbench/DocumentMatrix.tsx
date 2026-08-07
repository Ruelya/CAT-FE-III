import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

/**
 * Document Matrix 文档矩阵
 *
 * 3 列打孔卡圆点矩阵，取代原生滚动条。每个点聚合若干段落，
 * 状态实时映射全文档。回答三个问题：我在哪 / 还剩多少 / 问题在哪。
 *
 * 交互：点击跳转 · 拖拽视口括号 · 滚轮转发 · 键盘导航 · hover tooltip
 *
 * Source: docs/design-ii/03-signatures.md §2
 */

const COLS = 3;
const DOT_GAP = 4;

export type SegmentState = "untranslated" | "draft" | "confirmed" | "error";

/** Known state, or null/undefined for unloaded/unknown (neutral hollow). */
export type MatrixSegmentState = SegmentState | null | undefined;

export interface MatrixCell {
  /** Authoritative document ordinal start (0-based). */
  startIndex: number;
  /** Segments aggregated into this cell. */
  count: number;
  /**
   * Aggregate display state (priority: error > untranslated > draft > confirmed).
   * null = unresolved / mixed-unknown bucket (neutral hollow — never invent).
   */
  state: SegmentState | null;
}

/** Localized copy injected by the host (message catalog). */
export interface DocumentMatrixLabels {
  landmark: string;
  title: string;
  legendUntranslated: string;
  legendDraft: string;
  legendConfirmed: string;
  legendError: string;
  legendNeutral: string;
  stateUntranslated: string;
  stateDraft: string;
  stateConfirmed: string;
  stateError: string;
  stateNeutral: string;
  /** One-based display range, e.g. "Seg 3" / "Seg 3–7". */
  formatRange(from: number, to: number): string;
}

interface DocumentMatrixProps {
  /**
   * Full-document segment states indexed by authoritative ordinal.
   * Unknown/unloaded slots are null.
   */
  segmentStates: readonly MatrixSegmentState[];
  /** Active document ordinal (0-based; negative = none). */
  activeIndex: number;
  /** Visible ordinal interval [start, end). */
  viewportRange: readonly [number, number];
  /** Seek to the document segment the cell represents (ordinal). */
  onNavigate: (segmentOrdinal: number) => void;
  /** Forward wheel deltas to the real `.segment-grid` scroll owner. */
  onScrollBy?: (deltaY: number) => void;
  /**
   * Optional escape hatch for hosts that need the raw document ratio.
   * Bracket drag always maps through document ordinal + `onNavigate`
   * (filter-safe); this prop is not used for the viewport bracket.
   */
  onViewportSeek?: (ratio: number) => void;
  labels: DocumentMatrixLabels;
}

/** Stable id for a matrix dot (roving-focus target / tests). */
export function matrixDotId(startIndex: number): string {
  return `doc-matrix-dot-${startIndex}`;
}

/**
 * Map a document-space ratio [0, 1] to a 0-based document ordinal.
 * Bracket drag must use this (not filtered-list scroll height).
 */
export function documentOrdinalFromRatio(
  ratio: number,
  documentTotal: number,
): number {
  if (documentTotal <= 0) return 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  return Math.min(
    documentTotal - 1,
    Math.max(0, Math.round(clamped * Math.max(documentTotal - 1, 1))),
  );
}

export function DocumentMatrix({
  segmentStates,
  activeIndex,
  viewportRange,
  onNavigate,
  onScrollBy,
  onViewportSeek,
  labels,
}: DocumentMatrixProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(20);
  const [focusCell, setFocusCell] = useState(-1);
  const draggingRef = useRef(false);

  // 根据容器高度动态计算行数
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      const dotWidth = (box.width - 12) / COLS; // 减去 padding
      const pitch = dotWidth + DOT_GAP;
      const available = box.height - 16; // 减去 padding
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
    () =>
      cells.findIndex(
        (c) =>
          activeIndex >= c.startIndex &&
          activeIndex < c.startIndex + c.count,
      ),
    [cells, activeIndex],
  );

  // Sync keyboard focus cell with active segment when entering
  useEffect(() => {
    if (activeCellIndex >= 0) setFocusCell(activeCellIndex);
  }, [activeCellIndex]);

  // 视口括号位置：段落序 → 比例
  const viewportStyle = useMemo(() => {
    if (cells.length === 0) return undefined;

    const total = segmentStates.length;
    const [vpStart, vpEnd] = viewportRange;
    const startRatio = vpStart / Math.max(total, 1);
    const endRatio = Math.min(vpEnd / Math.max(total, 1), 1);

    return {
      "--vp-top": `${startRatio * 100}%`,
      "--vp-h": `${Math.max((endRatio - startRatio) * 100, 2)}%`,
    } as CSSProperties;
  }, [cells.length, segmentStates.length, viewportRange]);

  const ratioFromClientY = useCallback((clientY: number) => {
    const el = containerRef.current;
    if (!el) return 0;
    const box = el.getBoundingClientRect();
    if (box.height <= 0) return 0;
    return Math.max(0, Math.min(1, (clientY - box.top) / box.height));
  }, []);

  /** Bracket seek: document ratio → ordinal → host navigate (filter-safe). */
  const seekBracketFromClientY = useCallback(
    (clientY: number) => {
      const ratio = ratioFromClientY(clientY);
      // Optional host hook for telemetry / alternate scroll bridges.
      onViewportSeek?.(ratio);
      const ordinal = documentOrdinalFromRatio(ratio, segmentStates.length);
      onNavigate(ordinal);
    },
    [onNavigate, onViewportSeek, ratioFromClientY, segmentStates.length],
  );

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!onScrollBy) return;
    event.preventDefault();
    onScrollBy(event.deltaY);
  };

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekBracketFromClientY(event.clientY);
  };

  const onViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekBracketFromClientY(event.clientY);
  };

  const onViewportPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const resolveFocusCell = () => {
    if (focusCell >= 0 && focusCell < cells.length) return focusCell;
    if (activeCellIndex >= 0) return activeCellIndex;
    return cells.length > 0 ? 0 : -1;
  };

  const rovingIndex = resolveFocusCell();

  /** Move the roving tab stop and real DOM focus to a cell. */
  const moveRovingFocus = (next: number) => {
    if (next < 0 || next >= cells.length) return;
    setFocusCell(next);
    const cell = cells[next];
    if (!cell) return;
    // Buttons already exist; tabIndex updates on the next paint.
    document.getElementById(matrixDotId(cell.startIndex))?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (cells.length === 0) return;
    const key = event.key;
    if (
      key !== "ArrowUp" &&
      key !== "ArrowDown" &&
      key !== "ArrowLeft" &&
      key !== "ArrowRight" &&
      key !== "Enter" &&
      key !== "Home" &&
      key !== "End" &&
      key !== "Escape"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (key === "Escape") {
      // Leave matrix; restore focus to grid region without stealing textarea/IME focus.
      document.querySelector<HTMLElement>(".segment-grid")?.focus();
      return;
    }

    if (key === "Enter") {
      const cell = cells[resolveFocusCell()];
      if (cell) onNavigate(cell.startIndex);
      return;
    }

    const current = resolveFocusCell();
    if (current < 0) return;
    let next = current;
    if (key === "ArrowRight") next = Math.min(cells.length - 1, current + 1);
    if (key === "ArrowLeft") next = Math.max(0, current - 1);
    if (key === "ArrowDown") next = Math.min(cells.length - 1, current + COLS);
    if (key === "ArrowUp") next = Math.max(0, current - COLS);
    if (key === "Home") next = 0;
    if (key === "End") next = cells.length - 1;
    moveRovingFocus(next);
  };

  return (
    <div className="doc-matrix-shell">
      <div className="doc-matrix-shell__header">
        <span className="doc-matrix-shell__title">{labels.title}</span>
      </div>
      <div
        ref={containerRef}
        className="doc-matrix"
        role="navigation"
        aria-label={labels.landmark}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        {cells.map((cell, i) => (
          <button
            key={cell.startIndex}
            id={matrixDotId(cell.startIndex)}
            type="button"
            className="doc-matrix__dot"
            data-state={cell.state ?? undefined}
            data-active={
              activeIndex >= 0 && i === activeCellIndex ? true : undefined
            }
            data-focus={i === rovingIndex ? true : undefined}
            tabIndex={i === rovingIndex ? 0 : -1}
            style={{ "--i": i } as CSSProperties}
            title={formatTooltip(cell, labels)}
            aria-label={formatTooltip(cell, labels)}
            onClick={() => onNavigate(cell.startIndex)}
            onFocus={() => setFocusCell(i)}
          />
        ))}

        {viewportStyle && (
          <div
            className="doc-matrix__viewport"
            style={viewportStyle}
            role="slider"
            aria-label={labels.title}
            aria-valuemin={0}
            aria-valuemax={Math.max(segmentStates.length - 1, 0)}
            aria-valuenow={viewportRange[0]}
            aria-hidden={false}
          >
            {/*
              Only edge handles capture pointer input so dots under the
              bracket rectangle remain clickable (pass-through body).
            */}
            <div
              className="doc-matrix__viewport-handle doc-matrix__viewport-handle--start"
              onPointerDown={onViewportPointerDown}
              onPointerMove={onViewportPointerMove}
              onPointerUp={onViewportPointerUp}
              onPointerCancel={onViewportPointerUp}
            />
            <div
              className="doc-matrix__viewport-handle doc-matrix__viewport-handle--end"
              onPointerDown={onViewportPointerDown}
              onPointerMove={onViewportPointerMove}
              onPointerUp={onViewportPointerUp}
              onPointerCancel={onViewportPointerUp}
            />
          </div>
        )}
      </div>
      <ul className="matrix-legend" aria-label={labels.title}>
        {(
          [
            ["untranslated", labels.legendUntranslated],
            ["draft", labels.legendDraft],
            ["confirmed", labels.legendConfirmed],
            ["error", labels.legendError],
            ["neutral", labels.legendNeutral],
          ] as const
        ).map(([state, text]) => (
          <li key={state} className="matrix-legend__item" title={text}>
            <span
              className="matrix-legend__dot"
              data-state={state}
              aria-hidden="true"
            />
            <span className="visually-hidden">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Aggregate segment states into a fixed cell budget.
 *
 * Priority among fully-known buckets: error > untranslated > draft > confirmed.
 * Any unresolved (null/undefined) member keeps the cell neutral so unknown
 * positions never inherit a definitive color.
 */
export function aggregateCells(
  states: readonly MatrixSegmentState[],
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

export function dominantState(
  states: readonly MatrixSegmentState[],
): SegmentState | null {
  if (states.length === 0) return null;
  // Unresolved members block definitive colors (neutral aggregate).
  if (states.some((state) => state == null)) return null;
  const known = states as SegmentState[];
  if (known.includes("error")) return "error";
  if (known.includes("untranslated")) return "untranslated";
  if (known.includes("draft")) return "draft";
  return "confirmed";
}

function formatTooltip(
  cell: MatrixCell,
  labels: DocumentMatrixLabels,
): string {
  const stateLabel =
    cell.state === "untranslated"
      ? labels.stateUntranslated
      : cell.state === "draft"
        ? labels.stateDraft
        : cell.state === "confirmed"
          ? labels.stateConfirmed
          : cell.state === "error"
            ? labels.stateError
            : labels.stateNeutral;

  const from = cell.startIndex + 1;
  const to = cell.startIndex + cell.count;
  const range = labels.formatRange(from, to);
  return `${range} · ${stateLabel}`;
}
