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
  /** Select adjacent placeholders as one range (Trados grouping). */
  groupAdjacent?: boolean;
  display?: EditorDisplay;
}

function renderRun(
  text: string,
  key: string,
  highlight: SourceHighlight | null | undefined,
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

  const chars = [...text];
  const hi = lo + chars.length;
  if (!highlight || highlight.start >= hi || highlight.end <= lo) {
    return paint(text, "all");
  }
  const from = Math.max(0, highlight.start - lo);
  const to = Math.min(chars.length, highlight.end - lo);
  return (
    <span key={key} className={formatClass || undefined}>
      {from > 0 ? paint(chars.slice(0, from).join(""), "a") : null}
      <mark className="qp-source-hit" data-testid="qp-source-hit">
        {paint(chars.slice(from, to).join(""), "h")}
      </mark>
      {to < chars.length ? paint(chars.slice(to).join(""), "c") : null}
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
  groupAdjacent = false,
  display,
}: TaggedTextProps) {
  const formatting = display?.formatting ?? "full";
  const tagText = display?.tagText ?? "partial";
  const whitespace = display?.whitespace === true;
  const pieces = splitTaggedText(text, tags);
  if (pieces.length === 0) {
    return (
      <div className={className}>
        {whitespace
          ? renderRun(text || "\u00a0", "empty", null, 0, true, "")
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
          highlight,
          offset,
          whitespace,
          formatClass,
        ),
      );
      offset += [...piece.text].length;
      continue;
    }
    const tag = piece.tag;
    const hit =
      highlight != null && offset >= highlight.start && offset <= highlight.end;
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
        }${hit ? " inline-tag--qp-hit" : ""}`}
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
