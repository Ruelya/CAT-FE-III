import type { TermMatch } from "@translunar/contracts";

import { WorkbenchVisualState } from "../../../WorkbenchVisualState";
import { useLocale } from "../../../i18n/LocaleProvider";
import { TermRow } from "./TermRow";

export interface TermListProps {
  termMatches: TermMatch[];
  loading: boolean;
  settled: boolean;
  error: string | null;
  onInsert(target: string): void;
}

export function TermList({
  termMatches,
  loading,
  settled,
  error,
  onInsert,
}: TermListProps) {
  const { t } = useLocale();

  if (loading) {
    return (
      <div className="suggestion-pending" role="status" aria-live="polite">
        {t("workbench.loadingTerms")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="suggestion-error" role="alert">
        {error}
      </div>
    );
  }
  if (settled && termMatches.length) {
    return (
      <>
        {termMatches.map((match) => (
          <TermRow key={match.entryId} match={match} onInsert={onInsert} />
        ))}
      </>
    );
  }
  if (settled) {
    return (
      <WorkbenchVisualState
        kind="empty"
        variant="terms"
        label={t("workbench.noTermHitState")}
      />
    );
  }
  return null;
}
