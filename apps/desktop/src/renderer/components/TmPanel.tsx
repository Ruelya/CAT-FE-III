import type { Segment, TmMatchItem } from "@translunar/contracts";
import { Button, EmptyState, MatchBadge, Panel } from "@translunar/ui";

export interface TmPanelProps {
  activeSegment: Segment | null;
  /** Matches for the active segment; the workbench owns the lookup. */
  matches: TmMatchItem[];
  /** Lookup failure, if the last query could not be answered. */
  error: string | null;
  /**
   * Applies the hit as a draft. The whole match travels so the write can
   * stamp the real grade and score as the segment's origin.
   */
  onApply: (match: TmMatchItem) => void;
}

/**
 * Labels for the grades the engine actually returns. The contract type
 * still carries "inContext" but no lookup path emits it — a dead grade
 * renders without a label instead of inventing one.
 */
const GRADE_LABEL: Partial<Record<TmMatchItem["grade"], string>> = {
  exact: "精确",
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
        <EmptyState title="未选中句段" />
      ) : error ? (
        <div className="honest-note" data-tone="danger" role="alert">
          {error}
        </div>
      ) : matches.length === 0 ? (
        <EmptyState title="无匹配" />
      ) : (
        <div className="dock-stack">
          {matches.map((match, index) => (
            // Double-click applies the hit as a draft — same segment.update
            // as the button; Ctrl+数字 in the editor is the third path.
            <div
              key={match.entry.id}
              className="match-card"
              data-grade={index === 0 ? match.grade : undefined}
              onDoubleClick={() => onApply(match)}
            >
              <div className="match-card__row">
                <span className="match-card__grade">
                  <MatchBadge score={match.score} grade={match.grade} />
                  {GRADE_LABEL[match.grade] ? (
                    <span className="match-card__grade-label">
                      {GRADE_LABEL[match.grade]}
                    </span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onApply(match)}
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
