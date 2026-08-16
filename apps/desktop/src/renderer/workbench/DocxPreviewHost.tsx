import { useEffect, useRef } from "react";

export interface DocxPreviewHostProps {
  bytes: Uint8Array;
}

/**
 * Original imported DOCX, rendered by docx-preview.
 *
 * This is the managed source file, not a live merge of the current target
 * drafts. Jump-to-segment stays on the live blocks below.
 */
export function DocxPreviewHost({ bytes }: DocxPreviewHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const copy = bytes.slice();
    let cancelled = false;
    void import("docx-preview")
      .then(({ renderAsync }) => {
        if (cancelled || hostRef.current !== host) return;
        return renderAsync(copy, host, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: true,
          ignoreHeight: true,
          breakPages: true,
          useBase64URL: true,
        });
      })
      .catch(() => {
        if (cancelled || hostRef.current !== host) return;
        host.textContent = "Could not render the original DOCX.";
      });
    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [bytes]);

  return (
    <div
      ref={hostRef}
      className="structure-preview__docx"
      data-testid="docx-preview-host"
      aria-label="Original document layout"
    />
  );
}
