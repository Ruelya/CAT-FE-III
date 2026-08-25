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
}

type PreviewMode = "proofread" | "layout";

type LayoutState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; translatedSegments: number }
  | { phase: "error"; message: string };

/** Formats whose export artifact is a DOCX file docx-preview can render. */
const LAYOUT_FORMATS = new Set(["docx", "bilingual-docx"]);

/**
 * Formats whose anchored preview export embeds per-paragraph segment
 * bookmarks, which docx-preview renders as `<span id="tlseg-…">` markers.
 * bilingual-docx writes into existing table-cell ranges and has no anchor
 * story yet, so its layout view stays view-only and says so.
 */
const LAYOUT_JUMP_FORMATS = new Set(["docx"]);

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
 *   layout preview cannot drift from what「导出译文」would produce. For plain
 *   DOCX the preview export additionally bookmarks each paragraph with its
 *   grid segment id, so clicking a paragraph jumps through the same onJump
 *   path the proofread view uses.
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
}: PreviewDialogProps) {
  const model = useMemo(() => buildPreviewModel(segments), [segments]);
  const layoutAvailable = LAYOUT_FORMATS.has(documentFormat);
  const layoutJumpAvailable = LAYOUT_JUMP_FORMATS.has(documentFormat);
  const [mode, setMode] = useState<PreviewMode>("proofread");
  const [layout, setLayout] = useState<LayoutState>({ phase: "idle" });
  const proofreadRef = useRef<HTMLDivElement | null>(null);
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  // Layout DOM survives tab switches within one open cycle; regenerate only
  // after the dialog is reopened (segments may have changed in between).
  const layoutRenderedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setMode("proofread");
      setLayout({ phase: "idle" });
      layoutRenderedRef.current = false;
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
    if (!open || mode !== "layout" || layoutRenderedRef.current) {
      return;
    }
    let cancelled = false;
    setLayout({ phase: "loading" });
    void (async () => {
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
          layoutRenderedRef.current = true;
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
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, documentId]);

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
                ? "版式视图由导出管线生成；点击段落可跳转到编辑网格，精确排版以导出文件为准。"
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

          <div hidden={mode !== "proofread"}>
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
            <div className="preview__layout" hidden={mode !== "layout"}>
              {layout.phase === "loading" ? (
                <p className="preview__summary">
                  正在通过导出管线生成 DOCX 版式预览…
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
