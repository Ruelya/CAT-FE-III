import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Segment, SegmentState } from "@translunar/contracts";
import { Badge, Button } from "@translunar/ui";
import type { BadgeTone } from "@translunar/ui";

export interface SegmentGridProps {
  segments: Segment[];
  activeSegmentId: string | null;
  /** Segment ids with open QA issues. */
  qaSegmentIds: ReadonlySet<string>;
  onSelect: (segmentId: string) => void;
  onSaveDraft: (segment: Segment, targetText: string) => void;
  onConfirm: (segment: Segment, targetText: string) => void;
}

const STATE_LABEL: Record<SegmentState, [string, BadgeTone]> = {
  untranslated: ["未译", "neutral"],
  draft: ["草稿", "accent"],
  confirmed: ["已确认", "ok"],
};

/** Rows above this count are windowed instead of fully rendered. */
const VIRTUAL_THRESHOLD = 120;
const ESTIMATED_ROW_HEIGHT = 56;
const OVERSCAN_PX = 400;
const FALLBACK_VIEWPORT = 600;

export function SegmentGrid({
  segments,
  activeSegmentId,
  qaSegmentIds,
  onSelect,
  onSaveDraft,
  onConfirm,
}: SegmentGridProps) {
  const [draft, setDraft] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const heightsRef = useRef(new Map<string, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT);
  // Bumped when a measured row height changes so offsets are recomputed.
  const [, setMeasureVersion] = useState(0);

  const activeSegment =
    segments.find((segment) => segment.id === activeSegmentId) ?? null;

  // Re-seed the editor whenever the active segment (or its committed target)
  // changes from the outside, e.g. TM apply, AI draft, or propagation.
  useEffect(() => {
    setDraft(activeSegment?.targetText ?? "");
  }, [activeSegment?.id, activeSegment?.targetText]);

  const virtualized = segments.length > VIRTUAL_THRESHOLD;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const measure = () => {
      setViewportHeight(container.clientHeight || FALLBACK_VIEWPORT);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const rowHeight = useCallback((segmentId: string): number => {
    return heightsRef.current.get(segmentId) ?? ESTIMATED_ROW_HEIGHT;
  }, []);

  const measureRow = useCallback(
    (segmentId: string, element: HTMLTableRowElement | null) => {
      if (!element) {
        return;
      }
      const height = element.offsetHeight;
      if (height > 0 && heightsRef.current.get(segmentId) !== height) {
        heightsRef.current.set(segmentId, height);
        setMeasureVersion((version) => version + 1);
      }
    },
    [],
  );

  const rowWindow = useMemo(() => {
    if (!virtualized) {
      return {
        start: 0,
        end: segments.length - 1,
        topPad: 0,
        bottomPad: 0,
      };
    }
    const windowTop = scrollTop - OVERSCAN_PX;
    const windowBottom = scrollTop + viewportHeight + OVERSCAN_PX;
    let offset = 0;
    let start = 0;
    let end = segments.length - 1;
    let topPad = 0;
    let started = false;
    let usedHeight = 0;
    for (let index = 0; index < segments.length; index += 1) {
      const height = rowHeight(segments[index]!.id);
      if (!started && offset + height > windowTop) {
        start = index;
        topPad = offset;
        started = true;
      }
      if (started) {
        usedHeight += height;
      }
      offset += height;
      if (started && offset >= windowBottom) {
        end = index;
        break;
      }
    }
    if (!started) {
      // Scrolled past the end (e.g. after filtering); clamp to the tail.
      start = Math.max(0, segments.length - 1);
      end = segments.length - 1;
      topPad = offset - rowHeight(segments[start]?.id ?? "");
      usedHeight = offset - topPad;
    }
    let total = offset;
    for (let index = end + 1; index < segments.length; index += 1) {
      total += rowHeight(segments[index]!.id);
    }
    // `offset` already includes rows up to `end`; the remainder is padding.
    const bottomPad = Math.max(0, total - topPad - usedHeight);
    return { start, end, topPad, bottomPad };
    // Heights live in a ref; the measureVersion state bump forces a
    // recompute whenever a rendered row reports a new height.
  }, [virtualized, segments, scrollTop, viewportHeight, rowHeight]);

  // Bring the active row into the scroll window when selection jumps
  // (QA "定位句段", concordance hits, filters).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeSegmentId) {
      return;
    }
    const index = segments.findIndex(
      (segment) => segment.id === activeSegmentId,
    );
    if (index < 0) {
      return;
    }
    if (virtualized) {
      let offset = 0;
      for (let i = 0; i < index; i += 1) {
        offset += rowHeight(segments[i]!.id);
      }
      const height = rowHeight(segments[index]!.id);
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + (container.clientHeight || viewportHeight);
      if (
        (offset < viewTop || offset + height > viewBottom) &&
        typeof container.scrollTo === "function"
      ) {
        container.scrollTo({ top: Math.max(0, offset - viewportHeight / 3) });
        setScrollTop(Math.max(0, offset - viewportHeight / 3));
      }
    } else {
      const row = container.querySelector(
        `tr[data-segment-id="${activeSegmentId}"]`,
      );
      if (row && typeof row.scrollIntoView === "function") {
        row.scrollIntoView({ block: "nearest" });
      }
    }
    // Only reposition when the selection itself changes, not on every
    // data refresh, so background updates never yank the scroll position.
  }, [activeSegmentId]);

  const visible = segments.slice(rowWindow.start, rowWindow.end + 1);

  return (
    <div
      className="segment-grid"
      ref={containerRef}
      onScroll={
        virtualized
          ? (event) => setScrollTop(event.currentTarget.scrollTop)
          : undefined
      }
    >
      <table>
        <thead>
          <tr>
            <th className="segment-grid__ordinal">#</th>
            <th className="segment-grid__source">源文</th>
            <th className="segment-grid__target">译文</th>
            <th className="segment-grid__state">状态</th>
          </tr>
        </thead>
        <tbody>
          {rowWindow.topPad > 0 ? (
            <tr className="segment-grid__spacer" aria-hidden="true">
              <td colSpan={4} style={{ height: rowWindow.topPad }} />
            </tr>
          ) : null}
          {visible.map((segment) => {
            const isActive = segment.id === activeSegmentId;
            const [label, tone] = STATE_LABEL[segment.state];
            return (
              <tr
                key={segment.id}
                data-active={isActive}
                data-segment-id={segment.id}
                ref={(element) => measureRow(segment.id, element)}
                onClick={() => onSelect(segment.id)}
              >
                <td className="segment-grid__ordinal">{segment.ordinal + 1}</td>
                <td className="segment-grid__source">{segment.sourceText}</td>
                <td className="segment-grid__target">
                  {isActive ? (
                    <div className="segment-grid__target-editor">
                      <textarea
                        aria-label={`句段 ${segment.ordinal + 1} 译文`}
                        value={draft}
                        autoFocus
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            (event.ctrlKey || event.metaKey) &&
                            event.key === "Enter"
                          ) {
                            event.preventDefault();
                            onConfirm(segment, draft);
                          }
                        }}
                      />
                      <div className="segment-grid__actions">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSaveDraft(segment, draft);
                          }}
                        >
                          保存草稿
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={draft.trim().length === 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            onConfirm(segment, draft);
                          }}
                        >
                          确认
                        </Button>
                        <span className="segment-grid__hint">
                          Ctrl+Enter 确认
                        </span>
                      </div>
                    </div>
                  ) : segment.targetText ? (
                    segment.targetText
                  ) : (
                    <span className="segment-grid__placeholder">—</span>
                  )}
                </td>
                <td className="segment-grid__state">
                  <Badge tone={tone}>{label}</Badge>{" "}
                  {qaSegmentIds.has(segment.id) ? (
                    <Badge tone="danger" title="存在未解决的 QA 问题">
                      QA
                    </Badge>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {rowWindow.bottomPad > 0 ? (
            <tr className="segment-grid__spacer" aria-hidden="true">
              <td colSpan={4} style={{ height: rowWindow.bottomPad }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
