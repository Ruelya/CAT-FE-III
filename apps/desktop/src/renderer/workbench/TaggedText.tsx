import type { ReactNode } from "react";
import type { InlineTag } from "@translunar/contracts";

import {
  hideFormattingCapsule,
  splitWhitespace,
  type EditorDisplay,
} from "../lib/editor-display";
import { adjacentPlaceholderGroupAt, pairSourceTags } from "../lib/quickplace";
import { formatRunClass, formatTokens } from "../lib/preview-markup";
import {
  highlightSlices,
  type TextHighlight,
} from "../lib/term-source";
import {
  encodeInlineTag,
  selectTagAtoms,
  splitTaggedText,
  visibleTagLabel,
} from "../lib/tagged-text";

export interface SourceHighlight {
  start: number;
  end: number;
}

export interface TaggedTextProps {
  text: string;
  tags: readonly InlineTag[];
  className?: string;
  /** Ctrl/Meta+click a source tag to place it on the target (Trados). */
  onTagActivate?: (tag: InlineTag) => void;
  /** QuickPlace active item: highlight the matching source span. */
  highlight?: SourceHighlight | null;
  /** Term recognition (and any other persistent source marks). */
  highlights?: readonly TextHighlight[];
  /** Select adjacent placeholders as one range (Trados grouping). */
  groupAdjacent?: boolean;
  display?: EditorDisplay;
}

function renderRun(
  text: string,
  key: string,
  marks: readonly TextHighlight[],
  lo: number,
  showWhitespace: boolean,
  formatClass: string,
): ReactNode {
  const wrap = (inner: ReactNode, suffix: string) =>
    formatClass ? (
      <span key={`${key}-${suffix}`} className={formatClass}>
        {inner}
      </span>
    ) : (
      <span key={`${key}-${suffix}`}>{inner}</span>
    );

  const paint = (value: string, suffix: string) => {
    if (!showWhitespace) return wrap(value, suffix);
    return wrap(
      splitWhitespace(value).map((piece, index) =>
        piece.kind === "text" ? (
          <span key={`${suffix}-t${index}`}>{piece.text}</span>
        ) : (
          <span
            key={`${suffix}-w${index}`}
            className={`ws ws--${piece.kind}`}
            data-ws={piece.kind}
          >
            {piece.text}
          </span>
        ),
      ),
      suffix,
    );
  };

  const slices = highlightSlices(text, lo, marks);
  if (slices.length === 1 && slices[0]?.highlights.length === 0) {
    return paint(text, "all");
  }
  return (
    <span key={key} className={formatClass || undefined}>
      {slices.map((slice, index) => {
        let node: ReactNode = paint(slice.text, `s${index}`);
        for (const mark of slice.highlights) {
          const handleClick = mark.onClick;
          node = (
            <mark
              className={mark.className}
              {...(mark.testId ? { "data-testid": mark.testId } : {})}
              title={mark.title}
              onClick={
                handleClick
                  ? (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleClick();
                    }
                  : undefined
              }
            >
              {node}
            </mark>
          );
        }
        return <span key={`${key}-${index}`}>{node}</span>;
      })}
    </span>
  );
}

/**
 * Source (or target) text with inline tag capsules visible.
 *
 * Without this, a bold phrase looks identical to plain text and the translator
 * cannot see what they are being asked to carry. Capsules are inert: selecting
 * source text for concordance/term capture still works through the surrounding
 * text nodes.
 */
export function TaggedText({
  text,
  tags,
  className,
  onTagActivate,
  highlight,
  highlights,
  groupAdjacent = false,
  display,
}: TaggedTextProps) {
  const formatting = display?.formatting ?? "full";
  const tagText = display?.tagText ?? "partial";
  const whitespace = display?.whitespace === true;
  const marks: TextHighlight[] = [...(highlights ?? [])];
  if (highlight && highlight.end > highlight.start) {
    marks.push({
      start: highlight.start,
      end: highlight.end,
      className: "qp-source-hit",
      testId: "qp-source-hit",
    });
  }
  const pieces = splitTaggedText(text, tags);
  if (pieces.length === 0) {
    return (
      <div className={className}>
        {whitespace
          ? renderRun(text || "\u00a0", "empty", marks, 0, true, "")
          : text || "\u00a0"}
      </div>
    );
  }
  let offset = 0;
  const nodes: ReactNode[] = [];
  const stack: string[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (piece.kind === "text") {
      const formatClass =
        formatting === "tags" ? "" : formatRunClass(stack);
      nodes.push(
        renderRun(
          piece.text,
          `t-${index}`,
          marks,
          offset,
          whitespace,
          formatClass,
        ),
      );
      offset += [...piece.text].length;
      continue;
    }
    const tag = piece.tag;
    const qpHit = marks.some(
      (mark) =>
        mark.className === "qp-source-hit" &&
        offset >= mark.start &&
        offset <= mark.end,
    );
    const tokens = tag ? formatTokens(tag.displayText) : [];
    const hidden = tag
      ? hideFormattingCapsule(tag.kind, tag.displayText, formatting, false)
      : false;
    const label =
      tag && tagText !== "none" ? visibleTagLabel(tag, tagText) : "";
    nodes.push(
      <span
        key={`g-${tag?.id ?? index}`}
        className={`inline-tag inline-tag--${tag?.kind ?? "standalone"}${
          hidden ? " inline-tag--hidden" : ""
        }${qpHit ? " inline-tag--qp-hit" : ""}`}
        title={
          onTagActivate
            ? `Ctrl+click to place ${piece.text}`
            : (tag?.payload ?? piece.text)
        }
        {...(tag ? { "data-tag": encodeInlineTag(tag) } : {})}
        onMouseDown={(event) => {
          if (!tag) return;
          if (event.ctrlKey || event.metaKey) {
            if (!onTagActivate) return;
            event.preventDefault();
            onTagActivate(tag);
            return;
          }
          if (!groupAdjacent) return;
          const group = adjacentPlaceholderGroupAt(tags, tag.id);
          if (group.length < 2) return;
          event.preventDefault();
          const root =
            event.currentTarget.closest(".segment-source") ??
            event.currentTarget.parentElement;
          if (root instanceof HTMLElement) {
            selectTagAtoms(
              root,
              group.map((item) => item.id),
            );
          }
        }}
        onDoubleClick={(event) => {
          if (!tag) return;
          const pair = pairSourceTags(tags).pairs.find(
            (item) => item.start.id === tag.id || item.end.id === tag.id,
          );
          if (!pair) return;
          event.preventDefault();
          const root =
            event.currentTarget.closest(".segment-source") ??
            event.currentTarget.parentElement;
          if (root instanceof HTMLElement) {
            selectTagAtoms(root, [pair.start.id, pair.end.id]);
          }
        }}
      >
        {hidden ? "" : label || piece.text}
      </span>,
    );
    if (tag?.kind === "end") {
      for (const token of tokens) {
        const at = stack.lastIndexOf(token);
        if (at >= 0) stack.splice(at, 1);
      }
    } else if (tag?.kind === "start") {
      stack.push(...tokens);
    }
  }
  return <div className={className}>{nodes}</div>;
}
