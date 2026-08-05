import type { SegmentCounts } from "@translunar/contracts";

/**
 * Instrument Strip 仪表条
 *
 * 30px 高 Ink 面横条，贴窗口底缘。承载全局状态：
 * 段计数 · 进度比例条 · 完成百分比 · 保存状态 · 词数
 *
 * 数字自洽契约（screens/workbench.md §10）：
 *   untranslated + draft + confirmed = total
 * `openIssues` 是叠加维度（一个已确认段也可以有未决问题），
 * 因此**不进堆叠条**，只作为独立计数展示。
 *
 * Source: docs/design-ii/06-shell-navigation.md §4
 */

export type SaveState = "saved" | "saving" | "error";

/** 堆叠条只使用互斥的三态（openIssues 不在其中） */
type StackState = "confirmed" | "draft" | "untranslated";

const STATE_LABEL: Record<StackState, string> = {
  confirmed: "已确认",
  draft: "草稿",
  untranslated: "未翻译",
};

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "已保存",
  saving: "保存中",
  error: "保存失败",
};

interface InstrumentStripProps {
  counts: SegmentCounts;
  saveState: SaveState;
  /** 当前段序号（1-based，用于 `段 418 / 1,248`） */
  activeOrdinal?: number | undefined;
  wordCount?: number | undefined;
}

export function InstrumentStrip({
  counts,
  saveState,
  activeOrdinal,
  wordCount,
}: InstrumentStripProps) {
  const { total, confirmed, draft, untranslated, openIssues } = counts;

  // 完成百分比：已确认段占比。total=0 时为 0，不显示 NaN。
  const pct = total > 0 ? Math.round((confirmed / total) * 100) : 0;

  const segments: readonly { state: StackState; count: number }[] = [
    { state: "confirmed", count: confirmed },
    { state: "draft", count: draft },
    { state: "untranslated", count: untranslated },
  ];

  const barLabel = segments
    .map(({ state, count }) => `${STATE_LABEL[state]} ${count}`)
    .join("，");

  return (
    <div className="instrument shell__instrument">
      {/* 段计数 */}
      <div className="instrument__count num">
        <span className="instrument__count-label">段</span>
        {activeOrdinal !== undefined && (
          <>
            <b>{activeOrdinal.toLocaleString()}</b>
            <span className="text-on-ink-2">/</span>
          </>
        )}
        <span>{total.toLocaleString()}</span>
      </div>

      {/* 堆叠比例条：宽度比例 = 计数比例 */}
      <div className="instrument__progress" role="img" aria-label={barLabel}>
        {segments.map(({ state, count }) =>
          count > 0 ? (
            <span
              key={state}
              className="instrument__segment"
              data-state={state}
              style={{ flexGrow: count }}
              title={`${STATE_LABEL[state]} ${count.toLocaleString()}`}
            />
          ) : null,
        )}
      </div>

      {/* 完成百分比 */}
      <div className="instrument__pct" aria-label={`完成 ${pct}%`}>
        {pct}%
      </div>

      {/* 未决问题（叠加维度，独立于堆叠条）*/}
      {openIssues > 0 && (
        <div className="instrument__issues">
          <span
            className="instrument__status-lamp"
            data-state="error"
            aria-hidden="true"
          />
          <span className="num">{openIssues.toLocaleString()}</span>
          <span>问题</span>
        </div>
      )}

      {/* 保存状态 */}
      <div className="instrument__status" role="status" aria-live="polite">
        <span
          className="instrument__status-lamp"
          data-state={saveState}
          aria-hidden="true"
        />
        <span>{SAVE_LABEL[saveState]}</span>
      </div>

      {/* 词数 */}
      {wordCount !== undefined && (
        <div className="instrument__words num">
          {wordCount.toLocaleString()} 词
        </div>
      )}
    </div>
  );
}
