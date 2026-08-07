/**
 * Segment grid host: semantics, virtual spacers, batch bar, roving grid.
 * No draft/business ownership — Workbench remains orchestrator.
 *
 * Source: docs/design-ii/screens/workbench.md §3 · Phase 3 design.md
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useRovingGrid } from "../../hooks/useRovingGrid";
import { WorkbenchVisualState } from "../../WorkbenchVisualState";
import { BatchBar } from "./BatchBar";
import { SegmentRow } from "./SegmentRow";
import type {
  BatchActionId,
  SegmentGridProps,
  SegmentRowView,
} from "./segmentTypes";

export type { SegmentGridProps, SegmentRowView };

export function SegmentGrid({
  rows,
  total,
  offset,
  rowHeight,
  loading,
  empty,
  hasFilters,
  activeId,
  labels,
  gridRef,
  onScroll,
  onSeekOrdinal,
  onActivate,
  onTargetFocus,
  onDraftChange,
  onCompositionStart,
  onCompositionEnd,
  onTargetKeyDown,
  onSelectTargetTag,
  onMoveTargetTag,
  onBestMatch,
  onOpenComments,
  onMoreAction,
  onAcceptAutocomplete,
  onAddDictionary,
  onLocateFinding,
  onIgnoreFinding,
  onClearFilters,
  onBatchAction,
  batchActions,
  isComposing: isComposingProp,
  renderAxis,
  renderSource,
  selectedIds,
  anchorId,
  onSelectionChange,
  filterSelectedCount,
  hiddenSelectedCount = 0,
  allFilteredIds,
  onSelectAllFilterScope,
  onRangeSelect,
  onRowStrideChange,
}: SegmentGridProps) {
  const measureCacheRef = useRef(new Map<string, number>());
  const heightByListIndexRef = useRef(new Map<number, number>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const rowElsRef = useRef(new Map<string, HTMLDivElement>());
  const listIndexByIdRef = useRef(new Map<string, number>());
  const rafRef = useRef<number | null>(null);
  const [measureRev, setMeasureRev] = useState(0);
  const bump = useCallback(() => setMeasureRev((n) => n + 1), []);

  // Keep list-index map in sync with the mounted window.
  useEffect(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      map.set(row.segmentId, offset + index);
    });
    listIndexByIdRef.current = map;
  }, [offset, rows]);

  const isRowEditable = useCallback(
    (segmentId: string) => {
      const row = rows.find((item) => item.segmentId === segmentId);
      return Boolean(row?.isEditable);
    },
    [rows],
  );

  const roving = useRovingGrid({
    rows,
    total,
    offset,
    activeId,
    gridRef,
    selectedIds,
    anchorId,
    onSelectionChange,
    onActivate,
    isRowEditable,
    ...(onSeekOrdinal ? { onSeekOrdinal } : {}),
    ...(allFilteredIds ? { allFilteredIds } : {}),
    ...(onSelectAllFilterScope ? { onSelectAllFilterScope } : {}),
    ...(onRangeSelect ? { onRangeSelect } : {}),
    ...(isComposingProp ? { isComposing: isComposingProp } : {}),
  });

  // Shared ResizeObserver for measured row heights (absent in some jsdom tests).
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.dataset.segmentRow;
        if (!id) continue;
        const height = entry.contentRect.height;
        const prev = measureCacheRef.current.get(id);
        if (prev !== height && height > 0) {
          measureCacheRef.current.set(id, height);
          const listIndex = listIndexByIdRef.current.get(id);
          if (listIndex !== undefined) {
            heightByListIndexRef.current.set(listIndex, height);
          }
          changed = true;
        }
      }
      if (changed) {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          bump();
        });
      }
    });
    observerRef.current = observer;
    for (const el of rowElsRef.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [bump]);

  const bindRowRef = useCallback((segmentId: string, el: HTMLDivElement | null) => {
    const prev = rowElsRef.current.get(segmentId);
    if (prev && observerRef.current) observerRef.current.unobserve(prev);
    if (el) {
      rowElsRef.current.set(segmentId, el);
      observerRef.current?.observe(el);
    } else {
      rowElsRef.current.delete(segmentId);
    }
  }, []);

  const spacerMetrics = useMemo(() => {
    let top = 0;
    for (let i = 0; i < offset; i += 1) {
      top += heightByListIndexRef.current.get(i) ?? rowHeight;
    }
    let bottom = 0;
    const after = offset + rows.length;
    for (let i = after; i < total; i += 1) {
      bottom += heightByListIndexRef.current.get(i) ?? rowHeight;
    }
    return { top, bottom };
    // measureRev intentionally forces recompute when cache updates.
  }, [measureRev, offset, rowHeight, rows.length, total]);

  // Publish average measured stride for Matrix / scroll index mapping.
  useEffect(() => {
    if (!onRowStrideChange) return;
    const heights = [...heightByListIndexRef.current.values()];
    if (heights.length === 0) {
      onRowStrideChange(rowHeight);
      return;
    }
    const sum = heights.reduce((acc, h) => acc + h, 0);
    onRowStrideChange(Math.max(1, Math.round(sum / heights.length)));
  }, [measureRev, onRowStrideChange, rowHeight]);

  const selectedCount =
    filterSelectedCount !== undefined
      ? filterSelectedCount
      : selectedIds.size;

  const handleBatch = useCallback(
    (action: BatchActionId) => {
      onBatchAction(action, [...selectedIds]);
    },
    [onBatchAction, selectedIds],
  );

  return (
    <div
      className="segment-grid grid"
      role="grid"
      aria-label={labels.region}
      aria-busy={loading}
      aria-rowcount={total + 1}
      aria-colcount={4}
      aria-activedescendant={roving.activeDescendant}
      tabIndex={roving.gridTabIndex}
      ref={gridRef}
      onScroll={onScroll}
      onKeyDown={roving.onGridKeyDown}
      onFocus={roving.onGridFocus}
      data-grid-mode={roving.mode}
    >
      <BatchBar
        selectedCount={selectedCount}
        hiddenCount={hiddenSelectedCount}
        selectedLabel={labels.selectedCount(selectedCount)}
        {...(hiddenSelectedCount > 0
          ? { hiddenLabel: labels.selectedHidden(hiddenSelectedCount) }
          : {})}
        actions={batchActions}
        onAction={handleBatch}
      />

      <div className="grid__head" role="row" aria-rowindex={1}>
        <div className="cell cell--id" role="columnheader">
          {labels.idColumn}
        </div>
        <div className="cell cell--lamp" role="columnheader">
          {labels.status}
        </div>
        <div className="cell cell--src" role="columnheader">
          {labels.sourceColumn}
        </div>
        <div className="cell cell--tgt" role="columnheader">
          {labels.targetColumn}
        </div>
      </div>

      <div className="grid__body">
        {spacerMetrics.top > 0 ? (
          <div
            className="virtual-spacer"
            aria-hidden="true"
            style={{ height: spacerMetrics.top } satisfies CSSProperties}
          />
        ) : null}

        {rows.map((row) => {
          // Axis only on the anchor when multi-selected; otherwise active row.
          const showAxis =
            row.isActive &&
            (selectedIds.size <= 1 || row.isAnchor || row.segmentId === anchorId);
          return (
            <SegmentRow
              key={row.segmentId}
              row={row}
              labels={labels}
              showAxis={showAxis}
              axis={renderAxis(row.segmentId)}
              sourceContent={renderSource(row)}
              rowRef={(el) => bindRowRef(row.segmentId, el)}
              onRowClick={roving.onRowClick}
              onTargetFocus={(segmentId) => {
                // Target focus means edit mode so Tab/Escape use edit contracts.
                roving.enterEdit(segmentId);
                onTargetFocus(segmentId);
              }}
              onDraftChange={onDraftChange}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onTargetKeyDown={onTargetKeyDown}
              onSelectTargetTag={onSelectTargetTag}
              onMoveTargetTag={onMoveTargetTag}
              onBestMatch={onBestMatch}
              onOpenComments={onOpenComments}
              onMoreAction={onMoreAction}
              onAcceptAutocomplete={onAcceptAutocomplete}
              onAddDictionary={onAddDictionary}
              onLocateFinding={onLocateFinding}
              onIgnoreFinding={onIgnoreFinding}
            />
          );
        })}

        {spacerMetrics.bottom > 0 ? (
          <div
            className="virtual-spacer"
            aria-hidden="true"
            style={{ height: spacerMetrics.bottom } satisfies CSSProperties}
          />
        ) : null}

        {empty && !loading ? (
          <WorkbenchVisualState
            kind="empty"
            variant="grid"
            label={labels.noMatches}
            action={
              hasFilters ? (
                <button
                  type="button"
                  className="button ghost"
                  onClick={onClearFilters}
                >
                  {labels.clearFilters}
                </button>
              ) : undefined
            }
          />
        ) : null}
      </div>
    </div>
  );
}
