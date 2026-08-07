/**
 * Atomic protected-tag capsule (source or target).
 * Pair highlight and missing/order hooks only — mutation stays in Workbench.
 *
 * Source: docs/design-ii/screens/workbench.md §3.4
 */

import type { KeyboardEvent, MouseEvent } from "react";

import { shouldIgnoreKey } from "../../hooks/useComposition";
import type { TagView } from "./segmentTypes";

export interface TagCapsuleProps {
  tag: TagView;
  side: "source" | "target";
  selected?: boolean;
  pairedHighlight?: boolean;
  disabled?: boolean;
  label: string;
  missingLabel?: string;
  orderLabel?: string;
  onSelect?: (tagId: string) => void;
  onHoverPair?: (pairKey: string | null) => void;
  onMove?: (direction: -1 | 1) => void;
}

export function TagCapsule({
  tag,
  side,
  selected = false,
  pairedHighlight = false,
  disabled = false,
  label,
  missingLabel,
  orderLabel,
  onSelect,
  onHoverPair,
  onMove,
}: TagCapsuleProps) {
  const issueLabel =
    tag.issue === "missing"
      ? missingLabel
      : tag.issue === "order"
        ? orderLabel
        : undefined;
  const accessible = issueLabel ? `${label}. ${issueLabel}` : label;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (shouldIgnoreKey(event.nativeEvent)) return;
    if (disabled || side !== "target" || !onMove) return;
    if (!event.altKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    onMove(event.key === "ArrowLeft" ? -1 : 1);
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabled) return;
    onSelect?.(tag.id);
  };

  return (
    <button
      type="button"
      className="tag-capsule"
      data-tag-side={side}
      data-tag-kind={tag.kind}
      data-pair-key={tag.pairKey}
      data-issue={tag.issue === "none" ? undefined : tag.issue}
      data-paired-highlight={pairedHighlight || undefined}
      data-selected={selected || undefined}
      disabled={disabled}
      aria-label={accessible}
      aria-pressed={side === "target" ? selected : undefined}
      title={accessible}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={() => onHoverPair?.(tag.pairKey)}
      onMouseLeave={() => onHoverPair?.(null)}
      onFocus={() => onHoverPair?.(tag.pairKey)}
      onBlur={() => onHoverPair?.(null)}
    >
      <span className="tag-capsule__text">{tag.displayText}</span>
      {side === "target" ? (
        <small className="tag-capsule__pos">{tag.position}</small>
      ) : null}
    </button>
  );
}
