import type { Segment, TmEntry } from "@translunar/contracts";
import { Database } from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";
import { wordDiff } from "./wordDiff";

export interface MatchCardProps {
  match: TmEntry;
  rank: number;
  activeSegment: Segment | undefined;
  current?: boolean;
  onInsert(target: string): void;
}

export function MatchCard({
  match,
  rank,
  activeSegment,
  current = false,
  onInsert,
}: MatchCardProps) {
  const { t, formatDate } = useLocale();
  const activeSource = activeSegment?.sourceText ?? "";
  const tokens = wordDiff(activeSource, match.sourceText);
  const shortcutHint = rank >= 1 && rank <= 9 ? String(rank) : null;

  return (
    <article className="match" data-current={current ? "" : undefined}>
      <div className="match__top">
        <span className="pctbox" data-tier="high">
          100%
        </span>
        <span className="match__lib">{t("workbench.projectTm")}</span>
        <time className="match__date">
          {formatDate(match.confirmedAtMs, { dateStyle: "medium" })}
        </time>
      </div>
      <div className="match__label">{t("common.source")}</div>
      <div className="match__text">
        {tokens.length === 0 ? (
          match.sourceText
        ) : (
          tokens.map((token, index) => {
            if (token.kind === "delete") {
              return <del key={index}>{token.text}</del>;
            }
            if (token.kind === "insert") {
              return <ins key={index}>{token.text}</ins>;
            }
            return <span key={index}>{token.text}</span>;
          })
        )}
      </div>
      <div className="match__label">{t("common.target")}</div>
      <div className="match__text">{match.targetText}</div>
      <div className="match__foot">
        <span>
          <Database size={12} aria-hidden="true" />{" "}
          {t("workbench.segmentLabel", {
            number: match.originSegmentId.slice(0, 8),
          })}
        </span>
        <span className="match__ins">
          <button
            type="button"
            className="insert-button"
            onClick={() => onInsert(match.targetText)}
          >
            {t("workbench.insert")}
          </button>
          {shortcutHint ? <kbd>Alt+{shortcutHint}</kbd> : null}
        </span>
      </div>
    </article>
  );
}
