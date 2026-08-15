import type { ReactNode } from "react";
import type { InlineTag } from "@translunar/contracts";

import { adjacentPlaceholderGroupAt } from "../lib/quickplace";
import { encodeInlineTag, selectTagAtoms, splitTaggedText } from "../lib/tagged-text";

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
}: TaggedTextProps) {
  const pieces = splitTaggedText(text, tags);
  if (pieces.length === 0) {
    return <div className={className}>{text || "\u00a0"}</div>;
  }
  let offset = 0;
  const nodes: ReactNode[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (piece.kind === "text") {
      const chars = [...piece.text];
      const lo = offset;
      const hi = offset + chars.length;
      if (highlight && highlight.start < hi && highlight.end > lo) {
        const from = Math.max(0, highlight.start - lo);
        const to = Math.min(chars.length, highlight.end - lo);
        if (from > 0) {
          nodes.push(
            <span key={`t-${index}-a`}>{chars.slice(0, from).join("")}</span>,
          );
        }
        nodes.push(
          <mark key={`t-${index}-h`} className="qp-source-hit" data-testid="qp-source-hit">
            {chars.slice(from, to).join("")}
          </mark>,
        );
        if (to < chars.length) {
          nodes.push(
            <span key={`t-${index}-c`}>{chars.slice(to).join("")}</span>,
          );
        }
      } else {
        nodes.push(<span key={`t-${index}`}>{piece.text}</span>);
      }
      offset = hi;
      continue;
    }
    const hit =
      highlight != null && offset >= highlight.start && offset <= highlight.end;
    nodes.push(
      <span
        key={`g-${piece.tag?.id ?? index}`}
        className={`inline-tag inline-tag--${piece.tag?.kind ?? "standalone"}${
          hit ? " inline-tag--qp-hit" : ""
        }`}
        title={
          onTagActivate
            ? `Ctrl+click to place ${piece.text}`
            : (piece.tag?.payload ?? piece.text)
        }
        {...(piece.tag ? { "data-tag": encodeInlineTag(piece.tag) } : {})}
        onMouseDown={(event) => {
          if (!piece.tag) return;
          if (event.ctrlKey || event.metaKey) {
            if (!onTagActivate) return;
            event.preventDefault();
            onTagActivate(piece.tag);
            return;
          }
          if (!groupAdjacent) return;
          const group = adjacentPlaceholderGroupAt(tags, piece.tag.id);
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
      >
        {piece.text}
      </span>,
    );
  }
  return <div className={className}>{nodes}</div>;
}
