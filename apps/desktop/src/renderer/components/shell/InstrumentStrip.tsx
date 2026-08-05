/**
 * Instrument Strip 仪表条
 *
 * 30px 高 Ink 面横条，贴窗口底缘。承载全局状态：
 * 段计数 · 进度比例条 · 完成百分比 · 保存状态 · 词数
 *
 * 所有数字必须自洽：进度条各段宽度比例 = 实际状态计数比例
 *
 * Source: docs/design-ii/06-shell-navigation.md §4
 */

export interface SegmentCounts {
  total: number;
  confirmed: number;
  draft: number;
  untranslated: number;
  error: number;
}

export type SaveState = "saved" | "saving" | "error";

interface InstrumentStripProps {
  activeSegmentIndex?: number | undefined;
  counts: SegmentCounts;
  saveState: SaveState;
  wordCount: number;
}

export function InstrumentStrip({
  activeSegmentIndex,
  counts,
  saveState,
  wordCount,
}: InstrumentStripProps) {
  const { total, confirmed, draft, untranslated, error } = counts;

  // 完成百分比：已确认段占比
  const pct = total > 0 ? Math.round((confirmed / total) * 100) : 0;

  const saveLabel: Record<SaveState, string> = {
    saved: "已保存",
    saving: "保存中",
    error: "保存失败",
  };

  return (
    <div className="instrument shell__instrument" role="status" aria-live="polite">
      {/* 段计数 */}
      <div className="instrument__count">
        <span className="instrument__count-label">段</span>
        {activeSegmentIndex !== undefined && (
          <>
            <span>{activeSegmentIndex.toLocaleString()}</span>
            <span className="text-on-ink-2">/</span>
          </>
        )}
        <span>{total.toLocaleString()}</span>
      </div>

      {/* 进度比例条 */}
      <div
        className="instrument__progress"
        role="img"
        aria-label={`进度：已确认 ${confirmed}，草稿 ${draft}，未翻译 ${untranslated}，问题 ${error}`}
      >
        <ProgressSegment state="confirmed" count={confirmed} total={total} />
        <ProgressSegment state="draft" count={draft} total={total} />
        <ProgressSegment state="untranslated" count={untranslated} total={total} />
        <ProgressSegment state="error" count={error} total={total} />
      </div>

      {/* 完成百分比 */}
      <div className="instrument__pct">{pct}%</div>

      {/* 保存状态 */}
      <div className="instrument__status">
        <span
          className="instrument__status-lamp"
          data-state={saveState}
          aria-hidden="true"
        />
        <span>{saveLabel[saveState]}</span>
      </div>

      {/* 词数 */}
      <div className="instrument__words">
        {wordCount.toLocaleString()} 词
      </div>
    </div>
  );
}

function ProgressSegment({
  state,
  count,
  total,
}: {
  state: "confirmed" | "draft" | "untranslated" | "error";
  count: number;
  total: number;
}) {
  if (count === 0) return null;

  return (
    <span
      className="instrument__segment"
      data-state={state}
      style={{ flexGrow: count / Math.max(total, 1) }}
    />
  );
}
