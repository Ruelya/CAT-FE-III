import { useEffect, useState, type KeyboardEvent } from "react";
import type { SegmentEditorRow } from "@translunar/contracts";

import { previewBlocks } from "../lib/structure-preview";
import {
  previewKind,
  previewRendererHint,
} from "../lib/preview-render";
import type { ManagedSourceBytes } from "../../shared/managed-source";
import { DocxPreviewHost } from "./DocxPreviewHost";

export interface StructurePreviewProps {
  rows: readonly SegmentEditorRow[];
  filterId?: string;
  format?: string;
  documentId?: string;
  documentName?: string;
  relativePath?: string;
  activeSegmentId: string | null;
  onJump: (segmentId: string) => void;
}

function activateOnKey(
  event: KeyboardEvent<HTMLDivElement>,
  activate: () => void,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

/**
 * Live formatted preview for the current document.
 *
 * Markdown/HTML go through marked and DOMPurify. Other filters keep the
 * tag-to-typography reconstruction, then the same sanitizer. When a managed
 * DOCX copy is available, docx-preview shows the original file above the
 * clickable live blocks. This is not Word COM and not the PDF page dock.
 */
export function StructurePreview({
  rows,
  filterId = "",
  format = "",
  documentId = "",
  documentName = "",
  relativePath = "",
  activeSegmentId,
  onJump,
}: StructurePreviewProps) {
  const kind = previewKind(filterId, format);
  const blocks = previewBlocks(rows, filterId, format);
  const [original, setOriginal] = useState<ManagedSourceBytes | null>(null);

  useEffect(() => {
    if (kind !== "docx" || !documentId) {
      setOriginal(null);
      return;
    }
    const api = window.translunar;
    if (typeof api?.readManagedSource !== "function") {
      setOriginal(null);
      return;
    }
    let cancelled = false;
    void api
      .readManagedSource({
        documentId,
        format,
        name: documentName,
        relativePath,
      })
      .then((result) => {
        if (!cancelled) setOriginal(result);
      })
      .catch(() => {
        if (!cancelled) setOriginal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, documentId, format, documentName, relativePath]);

  const hasOriginalLayout = original !== null && kind === "docx";

  return (
    <aside
      className="structure-preview structure-preview--formatted"
      data-testid="structure-preview"
      aria-label="Document preview"
    >
      <h2 className="structure-preview__title">Preview</h2>
      <p className="structure-preview__hint">
        {previewRendererHint(kind, hasOriginalLayout)}
      </p>
      {original ? <DocxPreviewHost bytes={original.bytes} /> : null}
      {blocks.length === 0 ? (
        <p className="muted">No segments to preview.</p>
      ) : (
        <div className="structure-preview__page">
          {blocks.map((block) => {
            const active = block.segmentId === activeSegmentId;
            return (
              <div
                key={block.segmentId}
                role="button"
                tabIndex={0}
                className={`structure-preview__block structure-preview__block--${block.role}${
                  active ? " structure-preview__block--active" : ""
                }${block.empty ? " structure-preview__block--empty" : ""}`}
                data-testid={`preview-block-${block.segmentId}`}
                aria-current={active ? "true" : undefined}
                title={block.path || block.label}
                onClick={() => onJump(block.segmentId)}
                onKeyDown={(event) =>
                  activateOnKey(event, () => onJump(block.segmentId))
                }
              >
                <span
                  className="structure-preview__text"
                  dangerouslySetInnerHTML={{ __html: block.html || "&nbsp;" }}
                />
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
