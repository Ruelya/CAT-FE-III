import type { InlineTag } from "@translunar/contracts";

import { splitTaggedText } from "../lib/tagged-text";

export interface TaggedTextProps {
  text: string;
  tags: readonly InlineTag[];
  className?: string;
  /** Ctrl/Meta+click a source tag to place it on the target (Trados). */
  onTagActivate?: (tag: InlineTag) => void;
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
}: TaggedTextProps) {
  const pieces = splitTaggedText(text, tags);
  if (pieces.length === 0) {
    return <div className={className}>{text || "\u00a0"}</div>;
  }
  return (
    <div className={className}>
      {pieces.map((piece, index) =>
        piece.kind === "text" ? (
          <span key={`t-${index}`}>{piece.text}</span>
        ) : (
          <span
            key={`g-${piece.tag?.id ?? index}`}
            className={`inline-tag inline-tag--${piece.tag?.kind ?? "standalone"}`}
            title={
              onTagActivate
                ? `Ctrl+click to place ${piece.text}`
                : (piece.tag?.payload ?? piece.text)
            }
            onMouseDown={(event) => {
              if (!onTagActivate || !piece.tag) return;
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              onTagActivate(piece.tag);
            }}
          >
            {piece.text}
          </span>
        ),
      )}
    </div>
  );
}
