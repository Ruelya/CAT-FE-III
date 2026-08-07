import {
  useCallback,
  useMemo,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import type { MatrixCellState } from "./qa-presenters";

export interface LiveMatrixLegendItem {
  state: MatrixCellState | "inert";
  label: string;
}

export interface LiveMatrixProps {
  title: string;
  cells: readonly MatrixCellState[];
  legend: readonly LiveMatrixLegendItem[];
  /** Partial-projection honesty note under the title. */
  caption?: string;
  interactive?: boolean;
  selectedOrdinal?: number | null;
  onSelectOrdinal?(ordinal: number): void;
  ariaLabel: string;
  columns?: number;
}

const STATE_TOKEN: Record<MatrixCellState | "inert", string> = {
  none: "none",
  warn: "warn",
  error: "error",
  waived: "waived",
  inert: "inert",
};

/**
 * Thin Live Matrix for QA / assets distribution (severity or health cells).
 * Not coupled to Workbench DocumentMatrix workflow lamps.
 */
export function LiveMatrix({
  title,
  cells,
  legend,
  caption,
  interactive = true,
  selectedOrdinal = null,
  onSelectOrdinal,
  ariaLabel,
  columns = 10,
}: LiveMatrixProps) {
  const colCount = Math.max(1, columns);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!interactive || !onSelectOrdinal || cells.length === 0) return;
      const current = selectedOrdinal ?? 0;
      let next = current;
      if (event.key === "ArrowRight") next = Math.min(cells.length - 1, current + 1);
      else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
      else if (event.key === "ArrowDown")
        next = Math.min(cells.length - 1, current + colCount);
      else if (event.key === "ArrowUp") next = Math.max(0, current - colCount);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = cells.length - 1;
      else return;
      event.preventDefault();
      onSelectOrdinal(next);
    },
    [cells.length, colCount, interactive, onSelectOrdinal, selectedOrdinal],
  );

  const style = useMemo(
    () =>
      ({
        "--live-matrix-cols": String(colCount),
      }) as CSSProperties,
    [colCount],
  );

  return (
    <div className="live-matrix" aria-label={ariaLabel}>
      <header className="live-matrix__header">
        <strong className="live-matrix__title">{title}</strong>
        {caption ? <span className="live-matrix__caption">{caption}</span> : null}
      </header>
      <div
        className="live-matrix__grid"
        role={interactive ? "grid" : "img"}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={interactive ? onKeyDown : undefined}
        style={style}
      >
        {cells.map((state, ordinal) => {
          const selected = selectedOrdinal === ordinal;
          if (!interactive || !onSelectOrdinal) {
            return (
              <span
                key={ordinal}
                className="live-matrix__cell"
                data-state={STATE_TOKEN[state]}
                data-selected={selected || undefined}
                title={`${ordinal + 1}`}
              />
            );
          }
          return (
            <button
              key={ordinal}
              type="button"
              role="gridcell"
              className="live-matrix__cell"
              data-state={STATE_TOKEN[state]}
              data-selected={selected || undefined}
              aria-label={`${ordinal + 1}`}
              onClick={() => onSelectOrdinal(ordinal)}
            />
          );
        })}
      </div>
      <ul className="live-matrix__legend">
        {legend.map((item) => (
          <li key={item.state}>
            <span
              className="live-matrix__swatch"
              data-state={STATE_TOKEN[item.state]}
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
