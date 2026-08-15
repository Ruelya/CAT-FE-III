import type { SegmentEditorRow } from "@translunar/contracts";

import { previewBlocks } from "../lib/structure-preview";

export interface StructurePreviewProps {
  rows: readonly SegmentEditorRow[];
  activeSegmentId: string | null;
  onJump: (segmentId: string) => void;
}

/**
 * Structure preview for the current document.
 *
 * Not a Word/HTML WYSIWYG. Each block is a segment in document order, labelled
 * with the same context the grid uses. The active segment is highlighted so
 * preview follows the caret. Clicking a block activates that row.
 */
export function StructurePreview({
  rows,
  activeSegmentId,
  onJump,
}: StructurePreviewProps) {
  const blocks = previewBlocks(rows);
  return (
    <aside
      className="structure-preview"
      data-testid="structure-preview"
      aria-label="Structure preview"
    >
      <h2 className="structure-preview__title">Preview</h2>
      {blocks.length === 0 ? (
        <p className="muted">No segments to preview.</p>
      ) : (
        <ol className="structure-preview__list">
          {blocks.map((block) => {
            const active = block.segmentId === activeSegmentId;
            return (
              <li key={block.segmentId}>
                <button
                  type="button"
                  className={`structure-preview__block${
                    active ? " structure-preview__block--active" : ""
                  }${block.empty ? " structure-preview__block--empty" : ""}`}
                  data-testid={`preview-block-${block.segmentId}`}
                  aria-current={active ? "true" : undefined}
                  title={block.path || block.label}
                  onClick={() => onJump(block.segmentId)}
                >
                  <span className="structure-preview__label">{block.label}</span>
                  <span className="structure-preview__text">{block.text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
