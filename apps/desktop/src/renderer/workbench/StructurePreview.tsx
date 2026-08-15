import type { SegmentEditorRow } from "@translunar/contracts";

import { previewBlocks } from "../lib/structure-preview";

export interface StructurePreviewProps {
  rows: readonly SegmentEditorRow[];
  filterId?: string;
  activeSegmentId: string | null;
  onJump: (segmentId: string) => void;
}

/**
 * Live formatted preview for the current document.
 *
 * Each block is a segment in document order. Tags become real typography
 * (bold/italic/underline). The active segment is highlighted. Clicking a
 * block activates that row. This is an HTML reconstruction, not Word COM.
 */
export function StructurePreview({
  rows,
  filterId = "",
  activeSegmentId,
  onJump,
}: StructurePreviewProps) {
  const blocks = previewBlocks(rows, filterId);
  return (
    <aside
      className="structure-preview structure-preview--formatted"
      data-testid="structure-preview"
      aria-label="Document preview"
    >
      <h2 className="structure-preview__title">Preview</h2>
      <p className="structure-preview__hint">Live reconstruction · click a block to jump</p>
      {blocks.length === 0 ? (
        <p className="muted">No segments to preview.</p>
      ) : (
        <div className="structure-preview__page">
          {blocks.map((block) => {
            const active = block.segmentId === activeSegmentId;
            return (
              <button
                key={block.segmentId}
                type="button"
                className={`structure-preview__block structure-preview__block--${block.role}${
                  active ? " structure-preview__block--active" : ""
                }${block.empty ? " structure-preview__block--empty" : ""}`}
                data-testid={`preview-block-${block.segmentId}`}
                aria-current={active ? "true" : undefined}
                title={block.path || block.label}
                onClick={() => onJump(block.segmentId)}
              >
                <span
                  className="structure-preview__text"
                  dangerouslySetInnerHTML={{ __html: block.html || "&nbsp;" }}
                />
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
