import { useEffect, useRef, useState } from "react";
import type { TermMatch, TmMatch } from "@translunar/contracts";

import { formatUiError } from "../lib/errors";
import type { SegmentIntel } from "../state/segment-intel";
import { matchLabel, rankMatches } from "../state/segment-intel";

export interface IntelDockProps {
  intel: SegmentIntel;
  collapsed: boolean;
  disabled?: boolean;
  onToggle: () => void;
  /** Put a translation memory hit into the target of the current segment. */
  onApplyMatch: (match: TmMatch) => void;
  /** Put a term translation in at the caret. */
  onInsertTerm: (translation: string) => void;
}

type DockTab = "matches" | "terms";

/**
 * The panel stack that follows the caret.
 *
 * Everything here answers a question about the segment the translator is
 * standing on, and everything here can be acted on without reaching for the
 * mouse. A result you can read but not use is worse than no result: it shows
 * the answer and then makes you type it out again.
 */
export function IntelDock({
  intel,
  collapsed,
  disabled,
  onToggle,
  onApplyMatch,
  onInsertTerm,
}: IntelDockProps) {
  const [tab, setTab] = useState<DockTab>("matches");
  const bodyRef = useRef<HTMLDivElement>(null);
  const matches = rankMatches(intel.tm.matches);
  const terms = intel.terms.matches;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (collapsed) {
      body.setAttribute("inert", "");
      body.setAttribute("aria-hidden", "true");
    } else {
      body.removeAttribute("inert");
      body.removeAttribute("aria-hidden");
    }
  }, [collapsed]);

  const matchCount = matches.length;
  const termCount = terms.length;

  return (
    <section
      className={`intel-dock${collapsed ? " intel-dock--collapsed" : ""}`}
      aria-label="Segment intelligence"
      data-testid="intel-dock"
    >
      <div className="intel-dock__chrome">
        <div
          className="intel-dock__tabs"
          role="tablist"
          aria-label="Segment intelligence"
        >
          <DockTabButton
            id="matches"
            label="Matches"
            count={matchCount}
            active={tab === "matches"}
            loading={intel.tm.loading}
            onSelect={setTab}
          />
          <DockTabButton
            id="terms"
            label="Terms"
            count={termCount}
            active={tab === "terms"}
            loading={intel.terms.loading}
            onSelect={setTab}
          />
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? "Expand segment intelligence"
              : "Collapse segment intelligence"
          }
          title={collapsed ? "Expand" : "Collapse"}
          onClick={onToggle}
        >
          <span aria-hidden="true">{collapsed ? "\u203a" : "\u2039"}</span>
        </button>
      </div>

      <div ref={bodyRef} className="intel-dock__body">
        {tab === "matches" ? (
          <MatchList
            matches={matches}
            loading={intel.tm.loading}
            error={intel.tm.error ? formatUiError(intel.tm.error) : null}
            disabled={disabled === true}
            onApply={onApplyMatch}
          />
        ) : (
          <TermList
            terms={terms}
            loading={intel.terms.loading}
            error={intel.terms.error ? formatUiError(intel.terms.error) : null}
            disabled={disabled === true}
            onInsert={onInsertTerm}
          />
        )}
      </div>
    </section>
  );
}

function DockTabButton({
  id,
  label,
  count,
  active,
  loading,
  onSelect,
}: {
  id: DockTab;
  label: string;
  count: number;
  active: boolean;
  loading: boolean;
  onSelect: (tab: DockTab) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`intel-tab-${id}`}
      aria-selected={active}
      className={`intel-dock__tab${active ? " intel-dock__tab--active" : ""}`}
      onClick={() => onSelect(id)}
    >
      {label}
      {/* A count of zero is information: it says the lookup ran and found
          nothing, which is different from not having looked. */}
      <span className="intel-dock__count" aria-hidden={loading}>
        {loading ? "\u2026" : count}
      </span>
    </button>
  );
}

function MatchList({
  matches,
  loading,
  error,
  disabled,
  onApply,
}: {
  matches: TmMatch[];
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onApply: (match: TmMatch) => void;
}) {
  if (error) {
    return (
      <p className="error-text" role="alert">
        {error}
      </p>
    );
  }
  if (loading && matches.length === 0) {
    return <p className="muted">Searching translation memory</p>;
  }
  if (matches.length === 0) {
    return (
      <p className="muted" data-testid="no-matches">
        No memory matches for this segment
      </p>
    );
  }
  return (
    <ol className="match-list">
      {matches.map((match, index) => {
        const shortcut = index < 9 ? `Ctrl+${index + 1}` : null;
        return (
          <li key={`${match.unit.id}:${index}`} className="match">
            <div className="match__head">
              <span
                className={`match__score match__score--${match.kind}`}
                title={`${match.kind} match from ${match.library.name}`}
              >
                {matchLabel(match)}
              </span>
              <span className="match__library truncate">
                {match.library.name}
              </span>
              {shortcut ? (
                <kbd className="match__shortcut">{shortcut}</kbd>
              ) : null}
            </div>
            <p className="match__source">{match.unit.sourceText}</p>
            <p className="match__target">{match.unit.targetText}</p>
            {match.substitutions.length > 0 ? (
              <p className="match__substitutions">
                {`Adjusted ${match.substitutions.length} placeable${
                  match.substitutions.length === 1 ? "" : "s"
                }`}
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn--secondary btn--sm match__apply"
              disabled={disabled}
              data-testid={`apply-match-${index}`}
              onClick={() => onApply(match)}
            >
              {shortcut ? `Apply (${shortcut})` : "Apply"}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function TermList({
  terms,
  loading,
  error,
  disabled,
  onInsert,
}: {
  terms: TermMatch[];
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onInsert: (translation: string) => void;
}) {
  if (error) {
    return (
      <p className="error-text" role="alert">
        {error}
      </p>
    );
  }
  if (loading && terms.length === 0) {
    return <p className="muted">Checking termbases</p>;
  }
  if (terms.length === 0) {
    return (
      <p className="muted" data-testid="no-terms">
        No termbase entries in this segment
      </p>
    );
  }
  return (
    <ul className="term-list">
      {terms.map((term) => (
        <li key={term.entryId} className="term">
          <p className="term__source">{term.sourceTerm}</p>
          {term.translations.length === 0 ? (
            // A source term with no translation is still worth showing: it is
            // the termbase saying "this phrase matters", and the translator
            // may want to add the translation as they go.
            <p className="term__untranslated muted">No translation on file</p>
          ) : (
            <div className="term__translations">
              {[...term.translations]
                .sort(
                  (left, right) =>
                    Number(right.preferred) - Number(left.preferred),
                )
                .map((translation) =>
                  translation.forbidden ? (
                    // A forbidden term is the termbase telling the translator
                    // what not to write. Rendering it as one more insertable
                    // chip would invert its meaning, so it is shown struck
                    // through and cannot be clicked into the target.
                    <span
                      key={translation.id}
                      className="term__forbidden"
                      title="Forbidden by the termbase"
                    >
                      {translation.term}
                    </span>
                  ) : (
                    <button
                      key={translation.id}
                      type="button"
                      className={`btn btn--ghost btn--sm term__insert${
                        translation.preferred ? " term__insert--preferred" : ""
                      }`}
                      disabled={disabled}
                      title={
                        translation.preferred
                          ? "Preferred term. Insert at the caret"
                          : "Insert at the caret"
                      }
                      onClick={() => onInsert(translation.term)}
                    >
                      {translation.term}
                    </button>
                  ),
                )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
