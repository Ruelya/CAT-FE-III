import type { Segment, TmMatchItem } from "@translunar/contracts";
import { Button, EmptyState, MatchBadge, Panel } from "@translunar/ui";

export interface TmPanelProps {
  activeSegment: Segment | null;
  /** Matches for the active segment; the workbench owns the lookup. */
  matches: TmMatchItem[];
  /** Lookup failure, if the last query could not be answered. */
  error: string | null;
  onApply: (targetText: string) => void;
}

const GRADE_LABEL: Record<TmMatchItem["grade"], string> = {
  exact: "精确",
  inContext: "上下文",
  fuzzy: "模糊",
};

/**
 * TM dock: renders the workbench-owned lookup for the active segment. The
 * same result also feeds the TM tab chip and the active grid row, so the
 * three surfaces can never disagree about the best match.
 */
export function TmPanel({
  activeSegment,
  matches,
  error,
  onApply,
}: TmPanelProps) {
  return (
    <Panel
      title="翻译记忆"
      className="dock-panel"
      actions={
        matches.length > 0 ? (
          <MatchBadge
            score={matches[0]!.score}
            grade={matches[0]!.grade}
            title="最佳匹配分值"
          />
        ) : null
      }
    >
      {!activeSegment ? (
        <EmptyState title="未选中句段" hint="在网格中选中句段后自动查询 TM。" />
      ) : error ? (
        <div className="honest-note" data-tone="danger" role="alert">
          {error}
        </div>
      ) : matches.length === 0 ? (
        <EmptyState
          title="无匹配"
          hint="确认句段后会写入项目 TM；相同源文显示 100% 精确匹配，相似源文按分值显示模糊匹配。"
        />
      ) : (
        <div className="dock-stack">
          {matches.map((match) => (
            <div key={match.entry.id} className="match-card">
              <div className="match-card__row">
                <span className="match-card__grade">
                  <MatchBadge score={match.score} grade={match.grade} />
                  <span className="match-card__grade-label">
                    {GRADE_LABEL[match.grade]}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onApply(match.entry.targetText)}
                >
                  应用为草稿
                </Button>
              </div>
              <p className="match-card__text">{match.entry.targetText}</p>
              <span className="match-card__origin">
                源：{match.entry.sourceText}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
