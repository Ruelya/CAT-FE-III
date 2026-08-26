import { useEffect, useMemo, useRef, useState } from "react";

import type { Segment } from "@translunar/contracts";
import { Badge, Dialog } from "@translunar/ui";

import { describeError } from "../lib/engine.js";
import { buildPreviewModel } from "../lib/preview.js";

export interface PreviewDialogProps {
  open: boolean;
  documentId: string;
  documentName: string;
  /** Engine-reported document format; DOCX formats get the layout view. */
  documentFormat: string;
  segments: Segment[];
  /** Followed by the proofread view: highlighted and scrolled into view. */
  activeSegmentId: string | null;
  onClose: () => void;
  onJump: (segmentId: string) => void;
  /**
   * Quiet period after a segment change before the layout view re-exports.
   * Exposed so tests can collapse the debounce; the default absorbs bursts
   * of rapid edits without re-running the export pipeline for each one.
   */
  layoutRefreshDelayMs?: number;
}

type PreviewMode = "proofread" | "layout";

type LayoutState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "refreshing"; translatedSegments: number }
  | { phase: "ready"; translatedSegments: number }
  | { phase: "error"; message: string };

/** Formats whose export artifact is a DOCX file docx-preview can render. */
const LAYOUT_FORMATS = new Set(["docx", "bilingual-docx"]);

/**
 * Formats whose anchored preview export embeds segment bookmarks, which
 * docx-preview renders as `<span id="tlseg-…">` markers. Plain DOCX anchors
 * every paragraph; bilingual-docx anchors each row's target-cell paragraph
 * (see tl-filter-docx), so clicking a target cell jumps to that row's
 * segment while source cells and page chrome stay honest and do nothing.
 */
const LAYOUT_JUMP_FORMATS = new Set(["docx", "bilingual-docx"]);

/** Bookmark-name prefix the engine uses for segment anchors (see tl-filter-docx). */
const ANCHOR_PREFIX = "tlseg-";

/**
 * Resolve a click inside the rendered DOCX to a grid segment id: walk from the
 * click target up to the container and, at each rendered paragraph, look for
 * the anchor span the export pipeline bookmarked into it. Innermost paragraph
 * wins (textbox content jumps to its own segment, not the host paragraph's).
 * Returns null for un-anchored regions — no fake jumps from page chrome.
 */
function anchoredSegmentId(target: EventTarget | null, container: Element) {
  let node = target instanceof Element ? target : null;
  while (node && node !== container) {
    if (node.tagName === "P") {
      // Attribute-walk instead of a CSS.escape selector: ids are
      // engine-issued but jsdom (tests) lacks CSS.escape.
      for (const span of node.querySelectorAll("span[id]")) {
        const id = span.getAttribute("id");
        if (id?.startsWith(ANCHOR_PREFIX)) {
          return id.slice(ANCHOR_PREFIX.length);
        }
      }
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Two honest views of the current draft:
 *
 * - 校对视图: client-side target backfill grouped by structural path, with
 *   untranslated segments shown as source and visibly marked. Follows the
 *   active grid segment and jumps back on click.
 * - 版式视图 (DOCX only): the engine's real export pipeline writes the
 *   translated DOCX to a temp path and the bytes are rendered as-is, so the
 *   layout preview cannot drift from what「导出译文」would produce. The
 *   preview export additionally embeds segment anchors (every paragraph for
 *   plain DOCX, each row's target cell for bilingual DOCX), so clicking an
 *   anchored region jumps through the same onJump path the proofread view
 *   uses. While the dialog stays open, segment edits mark the layout stale
 *   and re-run the same export after a short quiet period, so the layout
 *   view never shows a draft older than the grid.
 */
export function PreviewDialog({
  open,
  documentId,
  documentName,
  documentFormat,
  segments,
  activeSegmentId,
  onClose,
  onJump,
  layoutRefreshDelayMs = 600,
}: PreviewDialogProps) {
  const model = useMemo(() => buildPreviewModel(segments), [segments]);
  const layoutAvailable = LAYOUT_FORMATS.has(documentFormat);
  const layoutJumpAvailable = LAYOUT_JUMP_FORMATS.has(documentFormat);
  const [mode, setMode] = useState<PreviewMode>("proofread");
  const [layout, setLayout] = useState<LayoutState>({ phase: "idle" });
  const proofreadRef = useRef<HTMLDivElement | null>(null);
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  // The segments array the current layout DOM was generated from. Layout DOM
  // survives tab switches within one open cycle; it regenerates when the
  // segments prop changes identity (every grid edit produces a new array) or
  // after the dialog is reopened.
  const layoutRenderedForRef = useRef<Segment[] | null>(null);

  useEffect(() => {
    if (!open) {
      setMode("proofread");
      setLayout({ phase: "idle" });
      layoutRenderedForRef.current = null;
    }
  }, [open]);

  // Follow the active segment: center it whenever the proofread view is
  // (re)shown or the active segment changes while the dialog is open.
  useEffect(() => {
    if (!open || mode !== "proofread" || !activeSegmentId) {
      return;
    }
    const container = proofreadRef.current;
    if (!container) {
      return;
    }
    // Attribute-walk instead of a CSS.escape selector: segment ids are
    // engine-issued but jsdom (tests) lacks CSS.escape.
    for (const candidate of container.querySelectorAll("[data-segment-id]")) {
      if (candidate.getAttribute("data-segment-id") === activeSegmentId) {
        if (typeof candidate.scrollIntoView === "function") {
          candidate.scrollIntoView({ block: "center" });
        }
        break;
      }
    }
  }, [open, mode, activeSegmentId, model]);

  useEffect(() => {
    if (
      !open ||
      mode !== "layout" ||
      layoutRenderedForRef.current === segments
    ) {
      return;
    }
    let cancelled = false;
    const generate = async () => {
      try {
        const response = await window.tl.renderDocxPreview(documentId);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setLayout({ phase: "error", message: response.error.message });
          return;
        }
        const { renderAsync } = await import("docx-preview");
        const container = layoutContainerRef.current;
        if (cancelled || !container) {
          return;
        }
        container.innerHTML = "";
        await renderAsync(response.data, container, undefined, {
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
        });
        if (!cancelled) {
          layoutRenderedForRef.current = segments;
          setLayout({
            phase: "ready",
            translatedSegments: response.translatedSegments,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLayout({ phase: "error", message: describeError(error) });
        }
      }
    };
    if (layoutRenderedForRef.current === null) {
      // First generation for this open cycle: nothing on screen yet.
      setLayout({ phase: "loading" });
      void generate();
      return () => {
        cancelled = true;
      };
    }
    // Segments changed under an already-rendered layout: say the view is
    // syncing (the stale DOM stays visible underneath), then re-run the same
    // export pipeline after a quiet period so bursts of edits coalesce into
    // one regeneration. An unmount or a further edit cancels this cycle.
    setLayout((previous) =>
      previous.phase === "ready" || previous.phase === "refreshing"
        ? {
            phase: "refreshing",
            translatedSegments: previous.translatedSegments,
          }
        : { phase: "loading" },
    );
    const timer = window.setTimeout(() => {
      void generate();
    }, layoutRefreshDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, documentId, segments, layoutRefreshDelayMs]);

  return (
    <Dialog
      title={`译文预览 — ${documentName}`}
      open={open}
      onClose={onClose}
      wide
      footer={
        mode === "layout" ? (
          <span className="preview__legend">
            <span className="preview__legend-note">
              {layoutJumpAvailable
                ? documentFormat === "bilingual-docx"
                  ? "版式视图由导出管线生成；点击译文单元格可跳转到编辑网格，精确排版以导出文件为准。"
                  : "版式视图由导出管线生成；点击段落可跳转到编辑网格，精确排版以导出文件为准。"
                : "版式视图由导出管线生成，此格式暂不支持点段跳转；以导出文件为准。"}
            </span>
          </span>
        ) : (
          <span className="preview__legend">
            <Badge tone="ok">已确认</Badge>
            <Badge tone="accent">草稿</Badge>
            <Badge tone="warn">未译（显示源文）</Badge>
            <span className="preview__legend-note">
              点击句段可跳转到编辑网格；精确的空白与格式以导出结果为准。
            </span>
          </span>
        )
      }
    >
      {model.totalSegments === 0 ? (
        <p className="preview__empty">当前文档没有句段。</p>
      ) : (
        <>
          {layoutAvailable ? (
            <div className="preview__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "proofread"}
                data-active={mode === "proofread"}
                onClick={() => setMode("proofread")}
              >
                校对视图
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "layout"}
                data-active={mode === "layout"}
                onClick={() => setMode("layout")}
              >
                版式视图（DOCX）
              </button>
            </div>
          ) : null}

          <div className="preview__pane" hidden={mode !== "proofread"}>
            <p className="preview__summary">
              共 {model.totalSegments} 个句段：{model.translatedSegments}{" "}
              个已有译文
              {model.fallbackSegments > 0
                ? `，${model.fallbackSegments} 个未译（以源文回填显示）`
                : "，全部完成"}
              。
            </p>
            <div className="preview__document" ref={proofreadRef}>
              {model.blocks.map((block) => (
                <p key={block.key} className="preview__block">
                  {block.parts.map((part) => (
                    <button
                      key={part.segmentId}
                      type="button"
                      className="preview__segment"
                      data-state={part.state}
                      data-fallback={part.fallback}
                      data-segment-id={part.segmentId}
                      data-active={part.segmentId === activeSegmentId}
                      title={
                        part.fallback
                          ? `句段 #${part.ordinal + 1} 未译，显示源文`
                          : `句段 #${part.ordinal + 1}`
                      }
                      onClick={() => onJump(part.segmentId)}
                    >
                      {part.text}
                    </button>
                  ))}
                </p>
              ))}
            </div>
          </div>

          {layoutAvailable ? (
            <div
              className="preview__layout preview__pane"
              hidden={mode !== "layout"}
            >
              {layout.phase === "loading" ? (
                <p className="preview__summary">
                  正在通过导出管线生成 DOCX 版式预览…
                </p>
              ) : null}
              {layout.phase === "refreshing" ? (
                <p className="preview__summary" role="status">
                  句段已更新，正在重新生成版式预览…
                </p>
              ) : null}
              {layout.phase === "error" ? (
                <div className="honest-note" data-tone="danger" role="alert">
                  版式预览生成失败：{layout.message}
                </div>
              ) : null}
              {layout.phase === "ready" ? (
                <p className="preview__summary">
                  与「导出译文」同一管线：已回填 {layout.translatedSegments}{" "}
                  个已译单元，未译段落保持源文。
                </p>
              ) : null}
              {/*
                docx-preview inserts raw DOM here; clicks bubble up to this
                handler, which maps them back to grid segments through the
                anchors the export pipeline embedded. Only wired for formats
                whose export actually carries anchors — never a fake overlay.
              */}
              <div
                className="preview__docx"
                data-jumpable={layoutJumpAvailable}
                ref={layoutContainerRef}
                onClick={
                  layoutJumpAvailable
                    ? (event) => {
                        const segmentId = anchoredSegmentId(
                          event.target,
                          event.currentTarget,
                        );
                        if (segmentId) {
                          onJump(segmentId);
                        }
                      }
                    : undefined
                }
              />
            </div>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
