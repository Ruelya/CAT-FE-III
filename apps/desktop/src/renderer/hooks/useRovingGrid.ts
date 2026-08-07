/**
 * Roving grid focus / selection coordinator for the segment grid.
 * Composition-first; no engine calls. Virtual seek is a handshake only.
 *
 * Source: docs/design-ii/07-interaction.md · Phase 3 design.md §6–10
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import {
  isComposing as isGlobalComposing,
  shouldIgnoreKey,
} from "./useComposition";
import {
  cellId,
  GRID_COLUMNS,
  type GridColumn,
  type SegmentRowView,
} from "../components/workbench/segmentTypes";

export type GridEditMode = "navigate" | "edit";

export interface UseRovingGridOptions {
  rows: SegmentRowView[];
  total: number;
  offset: number;
  activeId: string | null;
  gridRef: RefObject<HTMLElement | null>;
  selectedIds: ReadonlySet<string>;
  anchorId: string | null;
  onSelectionChange: (next: {
    selectedIds: Set<string>;
    anchorId: string | null;
  }) => void;
  onActivate: (segmentId: string) => void;
  /** Seek so that `listIndex` (filter-space) is mounted. */
  onSeekOrdinal?: (listIndex: number) => void | Promise<void>;
  /**
   * Ordered IDs for the full current filter scope (list index order).
   * When present and non-empty, Select-All / cross-window ranges use it.
   */
  allFilteredIds?: readonly string[];
  /**
   * Expand Select-All via Workbench when `allFilteredIds` is not yet available.
   * Must not fall back to the mounted window only.
   */
  onSelectAllFilterScope?: () => void | Promise<void>;
  /**
   * Expand a filter-space list-index range when endpoints cross the window
   * and `allFilteredIds` is unavailable.
   */
  onRangeSelect?: (
    fromListIndex: number,
    toListIndex: number,
    anchorId: string,
  ) => void | Promise<void>;
  isRowEditable: (segmentId: string) => boolean;
  /** Optional injected composition predicate (Workbench session + per-segment). */
  isComposing?: () => boolean;
}

export interface UseRovingGridResult {
  mode: GridEditMode;
  activeDescendant: string | undefined;
  focusColumn: GridColumn;
  gridTabIndex: 0 | -1;
  onGridKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onGridFocus: () => void;
  onRowClick: (
    event: ReactMouseEvent,
    segmentId: string,
    targetIsEditor: boolean,
  ) => void;
  enterEdit: (segmentId: string) => void;
  exitEdit: () => void;
  setFocusCell: (segmentId: string, column: GridColumn) => void;
}

type PendingSeek = {
  listIndex: number;
  column: GridColumn;
  extendSelection: boolean;
  enterEdit: boolean;
};

function columnIndex(column: GridColumn): number {
  return GRID_COLUMNS.indexOf(column);
}

function columnAt(index: number): GridColumn {
  const clamped = Math.max(0, Math.min(GRID_COLUMNS.length - 1, index));
  return GRID_COLUMNS[clamped] ?? "target";
}

export function useRovingGrid({
  rows,
  total,
  offset,
  activeId,
  gridRef,
  selectedIds,
  anchorId,
  onSelectionChange,
  onActivate,
  onSeekOrdinal,
  allFilteredIds,
  onSelectAllFilterScope,
  onRangeSelect,
  isRowEditable,
  isComposing: isComposingOption,
}: UseRovingGridOptions): UseRovingGridResult {
  const composingActive = useCallback(() => {
    if (isComposingOption?.()) return true;
    return isGlobalComposing();
  }, [isComposingOption]);
  const [mode, setMode] = useState<GridEditMode>("navigate");
  const [focusColumn, setFocusColumn] = useState<GridColumn>("target");
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(
    activeId,
  );
  const pendingSeekRef = useRef<PendingSeek | null>(null);
  /** Filter-space list index of the selection anchor (stable across seeks). */
  const anchorListIndexRef = useRef<number | null>(null);

  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(row.segmentId, index));
    return map;
  }, [rows]);

  const resolveFocusId = focusSegmentId ?? activeId ?? rows[0]?.segmentId ?? null;

  // Never point aria-activedescendant at an unmounted cell (mounted window only).
  const activeDescendant =
    mode === "navigate" &&
    resolveFocusId &&
    rowIndexById.has(resolveFocusId)
      ? cellId(resolveFocusId, focusColumn)
      : undefined;

  const focusEditor = useCallback((segmentId: string) => {
    window.requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLTextAreaElement>(
        `[data-editor-for="${segmentId}"]`,
      );
      editor?.focus();
    });
  }, []);

  const enterEdit = useCallback(
    (segmentId: string) => {
      if (!isRowEditable(segmentId)) return;
      setMode("edit");
      setFocusSegmentId(segmentId);
      setFocusColumn("target");
      onActivate(segmentId);
      focusEditor(segmentId);
    },
    [focusEditor, isRowEditable, onActivate],
  );

  const exitEdit = useCallback(() => {
    setMode("navigate");
    window.requestAnimationFrame(() => gridRef.current?.focus());
  }, [gridRef]);

  const setFocusCell = useCallback(
    (segmentId: string, column: GridColumn) => {
      setFocusSegmentId(segmentId);
      setFocusColumn(column);
      onActivate(segmentId);
    },
    [onActivate],
  );

  const applySelectionToListIndex = useCallback(
    (
      listIndex: number,
      segmentId: string,
      extendSelection: boolean,
    ) => {
      if (extendSelection) {
        const anchor =
          anchorId ??
          (anchorListIndexRef.current != null && allFilteredIds
            ? (allFilteredIds[anchorListIndexRef.current] ?? segmentId)
            : segmentId);
        const anchorList =
          anchorListIndexRef.current ??
          (allFilteredIds ? allFilteredIds.indexOf(anchor) : -1);
        const localAnchor = rowIndexById.get(anchor);

        if (allFilteredIds && allFilteredIds.length > 0 && anchorList >= 0) {
          const from = Math.min(anchorList, listIndex);
          const to = Math.max(anchorList, listIndex);
          const next = new Set<string>();
          for (let i = from; i <= to; i += 1) {
            const id = allFilteredIds[i];
            if (id) next.add(id);
          }
          onSelectionChange({ selectedIds: next, anchorId: anchor });
          return;
        }

        if (
          localAnchor !== undefined &&
          listIndex >= offset &&
          listIndex < offset + rows.length
        ) {
          const local = listIndex - offset;
          const from = Math.min(localAnchor, local);
          const to = Math.max(localAnchor, local);
          const next = new Set<string>();
          for (let i = from; i <= to; i += 1) {
            const id = rows[i]?.segmentId;
            if (id) next.add(id);
          }
          onSelectionChange({ selectedIds: next, anchorId: anchor });
          return;
        }

        if (onRangeSelect && anchorList >= 0) {
          void onRangeSelect(anchorList, listIndex, anchor);
          return;
        }

        if (onRangeSelect && localAnchor !== undefined) {
          void onRangeSelect(offset + localAnchor, listIndex, anchor);
          return;
        }

        onSelectionChange({
          selectedIds: new Set([segmentId]),
          anchorId: segmentId,
        });
        anchorListIndexRef.current = listIndex;
        return;
      }

      onSelectionChange({
        selectedIds: new Set([segmentId]),
        anchorId: segmentId,
      });
      anchorListIndexRef.current = listIndex;
    },
    [
      allFilteredIds,
      anchorId,
      offset,
      onRangeSelect,
      onSelectionChange,
      rowIndexById,
      rows,
    ],
  );

  const completeMove = useCallback(
    (
      listIndex: number,
      segmentId: string,
      column: GridColumn,
      extendSelection: boolean,
      shouldEnterEdit: boolean,
    ) => {
      // Destination is already in the mounted window (`rows`). Descendant is
      // gated by `rowIndexById` so we never advertise an unmounted cell id.
      setFocusSegmentId(segmentId);
      setFocusColumn(column);
      onActivate(segmentId);
      applySelectionToListIndex(listIndex, segmentId, extendSelection);
      if (shouldEnterEdit) enterEdit(segmentId);
      else setMode("navigate");
    },
    [applySelectionToListIndex, enterEdit, onActivate],
  );

  const ensureMounted = useCallback(
    async (listIndex: number): Promise<SegmentRowView | null> => {
      if (listIndex < 0 || listIndex >= total) return null;
      const local = listIndex - offset;
      if (local >= 0 && local < rows.length) {
        return rows[local] ?? null;
      }
      if (!onSeekOrdinal) return null;
      await onSeekOrdinal(listIndex);
      // Rows update asynchronously; completion is handled by the pending-seek effect.
      return null;
    },
    [offset, onSeekOrdinal, rows, total],
  );

  const moveToListIndex = useCallback(
    async (
      listIndex: number,
      column: GridColumn,
      extendSelection: boolean,
      shouldEnterEdit = false,
    ) => {
      if (listIndex < 0 || listIndex >= total) return;
      const local = listIndex - offset;
      const row = local >= 0 && local < rows.length ? rows[local] : null;
      if (!row) {
        pendingSeekRef.current = {
          listIndex,
          column,
          extendSelection,
          enterEdit: shouldEnterEdit,
        };
        await ensureMounted(listIndex);
        return;
      }
      pendingSeekRef.current = null;
      completeMove(
        listIndex,
        row.segmentId,
        column,
        extendSelection,
        shouldEnterEdit,
      );
    },
    [completeMove, ensureMounted, offset, rows, total],
  );

  // After virtual seek, re-resolve destination from updated window.
  useEffect(() => {
    const pending = pendingSeekRef.current;
    if (!pending) return;
    const local = pending.listIndex - offset;
    if (local < 0 || local >= rows.length) return;
    const row = rows[local];
    if (!row) return;

    pendingSeekRef.current = null;
    completeMove(
      pending.listIndex,
      row.segmentId,
      pending.column,
      pending.extendSelection,
      pending.enterEdit,
    );
  }, [completeMove, offset, rows]);

  // Keep anchor list index aligned when filter-scope IDs arrive.
  useEffect(() => {
    if (!anchorId || !allFilteredIds?.length) return;
    const idx = allFilteredIds.indexOf(anchorId);
    if (idx >= 0) anchorListIndexRef.current = idx;
  }, [anchorId, allFilteredIds]);

  const onRowClick = useCallback(
    (
      event: ReactMouseEvent,
      segmentId: string,
      targetIsEditor: boolean,
    ) => {
      if (composingActive()) return;
      const multi = event.ctrlKey || event.metaKey;
      const range = event.shiftKey;
      const localIndex = rowIndexById.get(segmentId);
      const listIndex =
        localIndex === undefined ? null : offset + localIndex;

      if (range && anchorId && listIndex !== null) {
        const aList =
          anchorListIndexRef.current ??
          (allFilteredIds ? allFilteredIds.indexOf(anchorId) : -1);
        const aLocal = rowIndexById.get(anchorId);

        if (allFilteredIds && allFilteredIds.length > 0 && aList >= 0) {
          const from = Math.min(aList, listIndex);
          const to = Math.max(aList, listIndex);
          const next = new Set<string>();
          for (let i = from; i <= to; i += 1) {
            const id = allFilteredIds[i];
            if (id) next.add(id);
          }
          onSelectionChange({ selectedIds: next, anchorId });
          onActivate(anchorId);
          setFocusSegmentId(segmentId);
          return;
        }

        if (aLocal !== undefined && localIndex !== undefined) {
          const next = new Set<string>();
          const from = Math.min(aLocal, localIndex);
          const to = Math.max(aLocal, localIndex);
          for (let i = from; i <= to; i += 1) {
            const id = rows[i]?.segmentId;
            if (id) next.add(id);
          }
          onSelectionChange({ selectedIds: next, anchorId });
          onActivate(anchorId);
          setFocusSegmentId(segmentId);
          return;
        }

        if (onRangeSelect) {
          const from =
            aList >= 0
              ? aList
              : aLocal !== undefined
                ? offset + aLocal
                : listIndex;
          void onRangeSelect(from, listIndex, anchorId);
          onActivate(anchorId);
          setFocusSegmentId(segmentId);
          return;
        }
      }

      if (multi) {
        const next = new Set(selectedIds);
        if (next.has(segmentId)) next.delete(segmentId);
        else next.add(segmentId);
        const nextAnchor =
          next.has(segmentId) ? segmentId : (anchorId ?? segmentId);
        onSelectionChange({
          selectedIds: next,
          anchorId: next.size ? nextAnchor : null,
        });
        if (listIndex !== null && next.has(segmentId)) {
          anchorListIndexRef.current = listIndex;
        }
        onActivate(segmentId);
        setFocusSegmentId(segmentId);
        return;
      }

      onSelectionChange({
        selectedIds: new Set([segmentId]),
        anchorId: segmentId,
      });
      if (listIndex !== null) anchorListIndexRef.current = listIndex;
      onActivate(segmentId);
      setFocusSegmentId(segmentId);
      if (targetIsEditor && isRowEditable(segmentId)) {
        setMode("edit");
        setFocusColumn("target");
      } else {
        setMode("navigate");
      }
    },
    [
      allFilteredIds,
      anchorId,
      composingActive,
      isRowEditable,
      offset,
      onActivate,
      onRangeSelect,
      onSelectionChange,
      rowIndexById,
      rows,
      selectedIds,
    ],
  );

  const advanceToNextEditable = useCallback(
    (fromLocalIndex: number, fromListIndex: number) => {
      for (let i = fromLocalIndex + 1; i < rows.length; i += 1) {
        const row = rows[i];
        if (row && isRowEditable(row.segmentId)) {
          enterEdit(row.segmentId);
          anchorListIndexRef.current = offset + i;
          return;
        }
      }
      // Seek past window end for the next list index; complete via pending seek → edit.
      if (fromListIndex + 1 < total) {
        void moveToListIndex(fromListIndex + 1, "target", false, true);
      }
    },
    [enterEdit, isRowEditable, moveToListIndex, offset, rows, total],
  );

  const onGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (shouldIgnoreKey(event.nativeEvent) || composingActive()) return;

      const focusId = resolveFocusId;
      if (!focusId) return;
      const localIndex = rowIndexById.get(focusId);
      if (localIndex === undefined) return;
      const listIndex = offset + localIndex;

      // Ctrl+Tab: leave grid (do not preventDefault — allow browser/app).
      if (event.key === "Tab" && event.ctrlKey) {
        setMode("navigate");
        return;
      }

      // Select all in filter scope — never silently shrink to the mounted window.
      if (
        event.key.toLowerCase() === "a" &&
        event.shiftKey &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        if (allFilteredIds && allFilteredIds.length > 0) {
          onSelectionChange({
            selectedIds: new Set(allFilteredIds),
            anchorId: focusId,
          });
          const idx = allFilteredIds.indexOf(focusId);
          if (idx >= 0) anchorListIndexRef.current = idx;
          return;
        }
        if (onSelectAllFilterScope) {
          void onSelectAllFilterScope();
          return;
        }
        // No full-scope adapter: do not select window-only as "all".
        return;
      }

      if (mode === "edit") {
        if (event.key === "Escape") {
          event.preventDefault();
          if (selectedIds.size > 1) {
            onSelectionChange({
              selectedIds: new Set(anchorId ? [anchorId] : [focusId]),
              anchorId: anchorId ?? focusId,
            });
            return;
          }
          exitEdit();
          return;
        }
        if (event.key === "Tab" && !event.shiftKey && !event.altKey) {
          // Autocomplete Tab is handled on the textarea first (preventDefault).
          // If default was not prevented, advance to the next editable target.
          if (event.defaultPrevented) return;
          event.preventDefault();
          advanceToNextEditable(localIndex, listIndex);
          return;
        }
        return;
      }

      // Navigation mode
      if (event.key === "Escape") {
        if (selectedIds.size > 1) {
          event.preventDefault();
          const keep = anchorId ?? focusId;
          onSelectionChange({
            selectedIds: new Set([keep]),
            anchorId: keep,
          });
          onActivate(keep);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        enterEdit(focusId);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        void moveToListIndex(
          listIndex + delta,
          focusColumn,
          event.shiftKey,
        );
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const nextCol = columnAt(columnIndex(focusColumn) + delta);
        setFocusColumn(nextCol);
        return;
      }

      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        advanceToNextEditable(localIndex, listIndex);
      }
    },
    [
      advanceToNextEditable,
      allFilteredIds,
      anchorId,
      composingActive,
      enterEdit,
      exitEdit,
      focusColumn,
      mode,
      moveToListIndex,
      offset,
      onActivate,
      onSelectAllFilterScope,
      onSelectionChange,
      resolveFocusId,
      rowIndexById,
      selectedIds,
    ],
  );

  const onGridFocus = useCallback(() => {
    if (!resolveFocusId && rows[0]) {
      setFocusSegmentId(rows[0].segmentId);
      setFocusColumn("target");
      anchorListIndexRef.current = offset;
    } else if (activeId) {
      setFocusSegmentId(activeId);
    }
  }, [activeId, offset, resolveFocusId, rows]);

  return {
    mode,
    activeDescendant,
    focusColumn,
    gridTabIndex: 0,
    onGridKeyDown,
    onGridFocus,
    onRowClick,
    enterEdit,
    exitEdit,
    setFocusCell,
  };
}
