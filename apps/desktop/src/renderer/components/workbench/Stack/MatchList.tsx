import type { Segment, TmEntry } from "@translunar/contracts";

import { WorkbenchVisualState } from "../../../WorkbenchVisualState";
import { useLocale } from "../../../i18n/LocaleProvider";
import { MatchCard } from "./MatchCard";

export interface MatchListProps {
  matches: TmEntry[];
  loading: boolean;
  error: string | null;
  activeSegment: Segment | undefined;
  onInsert(target: string): void;
}

export function MatchList({
  matches,
  loading,
  error,
  activeSegment,
  onInsert,
}: MatchListProps) {
  const { t } = useLocale();

  if (loading) {
    return (
      <WorkbenchVisualState
        kind="loading"
        variant="matches"
        label={t("workbench.loadingMatches")}
      />
    );
  }
  if (error) {
    return (
      <div className="suggestion-error" role="alert">
        {error}
      </div>
    );
  }
  if (!matches.length) {
    return (
      <WorkbenchVisualState
        kind="empty"
        variant="matches"
        label={t("workbench.noTmMatchState")}
      />
    );
  }

  return (
    <>
      {matches.map((match, index) => (
        <MatchCard
          key={match.id}
          match={match}
          rank={index + 1}
          activeSegment={activeSegment}
          current={index === 0}
          onInsert={onInsert}
        />
      ))}
    </>
  );
}
