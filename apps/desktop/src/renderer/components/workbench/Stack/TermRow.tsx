import type { TermMatch } from "@translunar/contracts";
import { Ban } from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";
import type { TermStateKind } from "./stackTypes";

export interface TermRowProps {
  match: TermMatch;
  onInsert?(
    target: string,
    context?: { kind: "term"; sourceTerm: string },
  ): void;
}

function resolveTermState(
  preferred: boolean | undefined,
  forbidden: boolean | undefined,
): TermStateKind {
  if (forbidden) return "forbidden";
  if (preferred) return "preferred";
  return "pending";
}

export function TermRow({ match, onInsert }: TermRowProps) {
  const { t } = useLocale();
  const translation =
    match.translations.find((item) => item.preferred) ??
    match.translations.find((item) => !item.forbidden) ??
    match.translations[0];
  const state = resolveTermState(translation?.preferred, translation?.forbidden);
  const target = translation?.term ?? "—";
  const stateLabel =
    state === "forbidden"
      ? t("workbench.termState.forbidden")
      : state === "preferred"
        ? t("workbench.termState.preferred")
        : t("workbench.termState.pending");

  return (
    <div
      className="term"
      data-forbidden={state === "forbidden" ? "" : undefined}
    >
      <span className="term__source">{match.sourceTerm}</span>
      <span className="term__arrow" aria-hidden="true">
        →
      </span>
      <span
        className={
          state === "forbidden" ? "term__target term__target--forbidden" : "term__target"
        }
      >
        {target}
      </span>
      <span
        className="term__state"
        data-forbidden={state === "forbidden" ? "" : undefined}
      >
        {state === "forbidden" ? (
          <>
            <Ban size={10} aria-hidden="true" /> {stateLabel}
          </>
        ) : (
          stateLabel
        )}
      </span>
      {translation && !translation.forbidden && onInsert ? (
        <button
          type="button"
          className="insert-button term__insert"
          onClick={() =>
            onInsert(translation.term, {
              kind: "term",
              sourceTerm: match.sourceTerm,
            })
          }
        >
          {t("workbench.insert")}
        </button>
      ) : null}
    </div>
  );
}
