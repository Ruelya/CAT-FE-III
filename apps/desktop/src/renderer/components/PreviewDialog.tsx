import { useMemo } from "react";

import type { Segment } from "@translunar/contracts";
import { Badge, Dialog } from "@translunar/ui";

import { buildPreviewModel } from "../lib/preview.js";

export interface PreviewDialogProps {
  open: boolean;
  documentName: string;
  segments: Segment[];
  onClose: () => void;
  onJump: (segmentId: string) => void;
}

/**
 * HTML target-backfill preview of the current draft. Paragraph grouping
 * follows the imported structural path; untranslated segments fall back to
 * source text and are visibly marked — no fake completeness.
 */
export function PreviewDialog({
  open,
  documentName,
  segments,
  onClose,
  onJump,
}: PreviewDialogProps) {
  const model = useMemo(() => buildPreviewModel(segments), [segments]);

  return (
    <Dialog
      title={`译文预览 — ${documentName}`}
      open={open}
      onClose={onClose}
      wide
      footer={
        <span className="preview__legend">
          <Badge tone="ok">已确认</Badge>
          <Badge tone="accent">草稿</Badge>
          <Badge tone="warn">未译（显示源文）</Badge>
          <span className="preview__legend-note">
            点击句段可跳转到编辑网格；精确的空白与格式以导出结果为准。
          </span>
        </span>
      }
    >
      {model.totalSegments === 0 ? (
        <p className="preview__empty">当前文档没有句段。</p>
      ) : (
        <>
          <p className="preview__summary">
            共 {model.totalSegments} 个句段：{model.translatedSegments}{" "}
            个已有译文
            {model.fallbackSegments > 0
              ? `，${model.fallbackSegments} 个未译（以源文回填显示）`
              : "，全部完成"}
            。
          </p>
          <div className="preview__document">
            {model.blocks.map((block) => (
              <p key={block.key} className="preview__block">
                {block.parts.map((part) => (
                  <button
                    key={part.segmentId}
                    type="button"
                    className="preview__segment"
                    data-state={part.state}
                    data-fallback={part.fallback}
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
        </>
      )}
    </Dialog>
  );
}
