/**
 * Band Spine 彩条脊柱
 *
 * 全屏唯一的完整 Band 实例。固定在窗口最左缘，跨 Surface 恒定。
 * 五色自上而下固定顺序，严格等分。
 *
 * Source: docs/design-ii/03-signatures.md §1
 */
export function BandSpine() {
  return (
    <div
      className="band-spine shell__band"
      role="presentation"
      aria-hidden="true"
    />
  );
}

/**
 * Band Echo 压缩回显
 *
 * 20×3px 水平五色条。每屏最多一处，用于次级标识位置。
 */
export function BandEcho({ className }: { className?: string }) {
  return (
    <div
      className={className ? `band-echo ${className}` : "band-echo"}
      role="presentation"
      aria-hidden="true"
    >
      <span className="band-echo__segment" />
      <span className="band-echo__segment" />
      <span className="band-echo__segment" />
      <span className="band-echo__segment" />
      <span className="band-echo__segment" />
    </div>
  );
}
