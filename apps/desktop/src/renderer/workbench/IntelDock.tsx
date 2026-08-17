import { useEffect, useMemo, useRef, useState } from "react";
import { Books, HardDrives } from "@phosphor-icons/react";
import type {
  ConcordanceHit,
  TermCandidate,
  TermMatch,
  TmMatch,
} from "@translunar/contracts";

import { formatUiError, toUiError } from "../lib/errors";
import {
  filterTermMatches,
  mergeTermMatches,
  nextInsertableTerm,
  preferredTranslation,
  segmentSpanForTerm,
} from "../lib/term-source";
import type { SegmentIntel } from "../state/segment-intel";
import {
  SEGMENT_AI_ACTIONS,
  type SegmentAiState,
} from "../state/use-segment-ai";
import type { AiAction } from "@translunar/contracts";
import { matchLabel, rankMatches } from "../state/segment-intel";

export interface IntelDockProps {
  intel: SegmentIntel;
  collapsed: boolean;
  /** Side rail, historic top strip, or stacked TM + termbase panes. */
  placement?: "side" | "top" | "stack";
  /** Open the Asset Hub so the translator can mount memories and termbases. */
  onAssets?: () => void;
  disabled?: boolean;
  onToggle: () => void;
  /** Put a translation memory hit into the target of the current segment. */
  onApplyMatch: (match: TmMatch) => void;
  /** Put a term translation in at the caret. */
  onInsertTerm: (translation: string) => void;
  /** Look a phrase up across the memory. */
  onConcordance: (query: string) => void;
  /** Store the current source/target selection as a term. */
  onQuickAddTerm: () => void;
  /** True when a source and target selection are both available to store. */
  canQuickAddTerm: boolean;
  /** Look a phrase up across mounted termbases (Trados Termbase Search). */
  onSearchTerms?: (query: string) => Promise<TermMatch[]>;
  focusedTermIndex?: number;
  onFocusedTermIndex?: (index: number) => void;
  /** Hover/keyboard focus paints the source span, like QuickPlace. */
  onHighlightTerm?: (span: { start: number; end: number } | null) => void;
  ai: SegmentAiState & {
    setAction: (action: AiAction) => void;
    generate: () => void;
  };
  /** Current row is an OCR unit — AI here still writes the target. */
  ocrSource?: boolean;
  onApplyAiProposal: (text: string) => void;
  extract?: {
    pending: boolean;
    error: string | null;
    candidates: TermCandidate[];
    onExtract: () => void;
  };
  /** Increment to force the Terms tab open (context-menu extract). */
  termsFocusTick?: number;
}

type DockTab = "matches" | "terms" | "concordance" | "ai";

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
  placement = "side",
  disabled,
  onToggle,
  onApplyMatch,
  onInsertTerm,
  onConcordance,
  onQuickAddTerm,
  canQuickAddTerm,
  onSearchTerms,
  focusedTermIndex,
  onFocusedTermIndex,
  onHighlightTerm,
  ai,
  ocrSource,
  onApplyAiProposal,
  extract,
  termsFocusTick,
  onAssets,
}: IntelDockProps) {
  const [tab, setTab] = useState<DockTab>("matches");
  useEffect(() => {
    if (termsFocusTick && termsFocusTick > 0) setTab("terms");
  }, [termsFocusTick]);
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
  const top = placement === "top";
  const stack = placement === "stack";
  const showSplit = stack || (top && (tab === "matches" || tab === "terms"));
  const libraries = uniqueLibraries(matches);
  const termbases = uniqueTermbases(terms);

  return (
    <section
      className={`intel-dock${collapsed ? " intel-dock--collapsed" : ""}${
        top ? " intel-dock--top" : ""
      }${stack ? " intel-dock--stack" : ""}`}
      aria-label="Segment intelligence"
      data-testid="intel-dock"
      data-placement={placement}
    >
      <div className="intel-dock__chrome">
        <span className="intel-dock__collapsed-label">Memory and terms</span>
        {stack ? (
          <h2 className="intel-dock__title">Resources</h2>
        ) : (
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
            <DockTabButton
              id="concordance"
              label="Concordance"
              count={intel.concordance.hits.length}
              active={tab === "concordance"}
              loading={intel.concordance.loading}
              onSelect={setTab}
            />
            <DockTabButton
              id="ai"
              label="AI"
              count={ai.run?.proposalText ? 1 : 0}
              active={tab === "ai"}
              loading={ai.pending}
              onSelect={setTab}
            />
          </div>
        )}
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
          <span aria-hidden="true">
            {top
              ? collapsed
                ? "\u25be"
                : "\u25b4"
              : collapsed
                ? "\u203a"
                : "\u2039"}
          </span>
        </button>
      </div>

      <div ref={bodyRef} className="intel-dock__body">
        {showSplit ? (
          <div className="intel-dock__split" data-testid="intel-dock-split">
            <div className="intel-dock__pane intel-dock__pane--matches">
              <div className="intel-dock__pane-head">
                <div
                  className="intel-dock__pane-tab"
                  data-testid="intel-pane-tm"
                >
                  <span className="intel-dock__pane-tab-label">
                    Translation memory
                  </span>
                  <span className="intel-dock__count">
                    {intel.tm.loading ? "\u2026" : matchCount}
                  </span>
                </div>
                {onAssets ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    data-testid="intel-open-tm"
                    title="Open mounted translation memories"
                    onClick={onAssets}
                  >
                    <HardDrives size={16} weight="regular" />
                    Open memories
                  </button>
                ) : null}
              </div>
              {stack ? (
                <div
                  className="segmented intel-dock__tools"
                  role="group"
                  aria-label="Memory tools"
                >
                  <ToolChip
                    id="matches"
                    label="Matches"
                    count={matchCount}
                    active={tab === "matches" || tab === "terms"}
                    loading={intel.tm.loading}
                    onSelect={setTab}
                  />
                  <ToolChip
                    id="concordance"
                    label="Concordance"
                    count={intel.concordance.hits.length}
                    active={tab === "concordance"}
                    loading={intel.concordance.loading}
                    onSelect={setTab}
                  />
                  <ToolChip
                    id="ai"
                    label="AI"
                    count={ai.run?.proposalText ? 1 : 0}
                    active={tab === "ai"}
                    loading={ai.pending}
                    onSelect={setTab}
                  />
                </div>
              ) : null}
              {libraries.length > 0 ? (
                <p
                  className="intel-dock__link"
                  data-testid="intel-tm-libraries"
                >
                  {libraries.map((library) => library.name).join(" · ")}
                </p>
              ) : (
                <p
                  className="intel-dock__link"
                  data-testid="intel-tm-libraries"
                >
                  No memory linked to this segment
                </p>
              )}
              {stack && tab === "concordance" ? (
                <ConcordanceList
                  concordance={intel.concordance}
                  disabled={disabled === true}
                  onSearch={onConcordance}
                  onInsert={onInsertTerm}
                />
              ) : stack && tab === "ai" ? (
                <AiPanel
                  ai={ai}
                  disabled={disabled === true}
                  ocrSource={ocrSource === true}
                  onApply={onApplyAiProposal}
                />
              ) : (
                <MatchList
                  matches={matches}
                  loading={intel.tm.loading}
                  error={intel.tm.error ? formatUiError(intel.tm.error) : null}
                  disabled={disabled === true}
                  onApply={onApplyMatch}
                />
              )}
            </div>
            <div className="intel-dock__pane intel-dock__pane--terms">
              <div className="intel-dock__pane-head">
                <div
                  className="intel-dock__pane-tab"
                  data-testid="intel-pane-tb"
                >
                  <span className="intel-dock__pane-tab-label">
                    Term recognition
                  </span>
                  <span className="intel-dock__count">
                    {intel.terms.loading ? "\u2026" : termCount}
                  </span>
                </div>
                {onAssets ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    data-testid="intel-open-tb"
                    title="Open mounted termbases"
                    onClick={onAssets}
                  >
                    <Books size={16} weight="regular" />
                    Open termbases
                  </button>
                ) : null}
              </div>
              {termbases.length > 0 ? (
                <p
                  className="intel-dock__link"
                  data-testid="intel-tb-libraries"
                >
                  {termbases.join(" · ")}
                </p>
              ) : (
                <p
                  className="intel-dock__link"
                  data-testid="intel-tb-libraries"
                >
                  No termbase linked to this segment
                </p>
              )}
              <TermList
                terms={terms}
                loading={intel.terms.loading}
                error={
                  intel.terms.error ? formatUiError(intel.terms.error) : null
                }
                disabled={disabled === true}
                canQuickAdd={canQuickAddTerm}
                onInsert={onInsertTerm}
                onQuickAdd={onQuickAddTerm}
                {...(onSearchTerms ? { onSearchTerms } : {})}
                {...(focusedTermIndex !== undefined
                  ? { focusedIndex: focusedTermIndex }
                  : {})}
                {...(onFocusedTermIndex
                  ? { onFocusedIndex: onFocusedTermIndex }
                  : {})}
                {...(onHighlightTerm ? { onHighlight: onHighlightTerm } : {})}
                {...(extract ? { extract } : {})}
              />
            </div>
          </div>
        ) : tab === "matches" ? (
          <MatchList
            matches={matches}
            loading={intel.tm.loading}
            error={intel.tm.error ? formatUiError(intel.tm.error) : null}
            disabled={disabled === true}
            onApply={onApplyMatch}
          />
        ) : tab === "terms" ? (
          <TermList
            terms={terms}
            loading={intel.terms.loading}
            error={intel.terms.error ? formatUiError(intel.terms.error) : null}
            disabled={disabled === true}
            canQuickAdd={canQuickAddTerm}
            onInsert={onInsertTerm}
            onQuickAdd={onQuickAddTerm}
            {...(onSearchTerms ? { onSearchTerms } : {})}
            {...(focusedTermIndex !== undefined
              ? { focusedIndex: focusedTermIndex }
              : {})}
            {...(onFocusedTermIndex
              ? { onFocusedIndex: onFocusedTermIndex }
              : {})}
            {...(onHighlightTerm ? { onHighlight: onHighlightTerm } : {})}
            {...(extract ? { extract } : {})}
          />
        ) : tab === "concordance" ? (
          <ConcordanceList
            concordance={intel.concordance}
            disabled={disabled === true}
            onSearch={onConcordance}
            onInsert={onInsertTerm}
          />
        ) : (
          <AiPanel
            ai={ai}
            disabled={disabled === true}
            ocrSource={ocrSource === true}
            onApply={onApplyAiProposal}
          />
        )}
      </div>
    </section>
  );
}

function uniqueLibraries(
  matches: readonly TmMatch[],
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const match of matches) {
    if (!seen.has(match.library.id)) {
      seen.set(match.library.id, match.library.name);
    }
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

function uniqueTermbases(terms: readonly TermMatch[]): string[] {
  const seen = new Set<string>();
  for (const term of terms) {
    if (term.termbaseId) seen.add(term.termbaseId);
  }
  return [...seen];
}

function ToolChip({
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
      id={`intel-tab-${id}`}
      className="segmented__item"
      aria-pressed={active}
      data-selected={active ? "true" : undefined}
      onClick={() => onSelect(id)}
    >
      {label}
      {loading || count > 0 ? (
        <span className="intel-dock__count" aria-hidden={loading}>
          {loading ? "\u2026" : count}
        </span>
      ) : null}
    </button>
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
      {loading || count > 0 ? (
        <span className="intel-dock__count" aria-hidden={loading}>
          {loading ? "\u2026" : count}
        </span>
      ) : null}
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
              className="btn btn--primary btn--sm match__apply"
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
  canQuickAdd,
  onInsert,
  onQuickAdd,
  onSearchTerms,
  focusedIndex,
  onFocusedIndex,
  onHighlight,
  extract,
}: {
  terms: TermMatch[];
  loading: boolean;
  error: string | null;
  disabled: boolean;
  canQuickAdd: boolean;
  onInsert: (translation: string) => void;
  onQuickAdd: () => void;
  onSearchTerms?: (query: string) => Promise<TermMatch[]>;
  focusedIndex?: number;
  onFocusedIndex?: (index: number) => void;
  onHighlight?: (span: { start: number; end: number } | null) => void;
  extract?: {
    pending: boolean;
    error: string | null;
    candidates: TermCandidate[];
    onExtract: () => void;
  };
}) {
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<TermMatch[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [internalFocus, setInternalFocus] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const focus = focusedIndex ?? internalFocus;
  const setFocus = onFocusedIndex ?? setInternalFocus;

  useEffect(() => {
    setQuery("");
    setLookup([]);
    setLookupError(null);
    setExpandedId(null);
  }, [terms]);

  const filtered = useMemo(
    () => filterTermMatches(terms, query),
    [terms, query],
  );
  const displayed = useMemo(
    () => (query.trim() ? mergeTermMatches(filtered, lookup) : filtered),
    [filtered, lookup, query],
  );

  useEffect(() => {
    if (!onSearchTerms) return;
    const needle = query.trim();
    if (!needle) {
      setLookup([]);
      setLookupError(null);
      setLookupLoading(false);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    const timer = window.setTimeout(() => {
      void onSearchTerms(needle)
        .then((matches) => {
          if (cancelled) return;
          setLookup(matches);
          setLookupError(null);
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setLookup([]);
          setLookupError(formatUiError(toUiError(caught)));
        })
        .finally(() => {
          if (!cancelled) setLookupLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchTerms, query]);

  useEffect(() => {
    if (displayed.length === 0) {
      onHighlight?.(null);
      return;
    }
    if (focus >= displayed.length) setFocus(0);
  }, [displayed, focus, onHighlight, setFocus]);

  const paintFocus = (index: number) => {
    setFocus(index);
    const term = displayed[index];
    if (!term) {
      onHighlight?.(null);
      return;
    }
    onHighlight?.(segmentSpanForTerm(term, terms));
  };

  const insertFocused = () => {
    const hit = nextInsertableTerm(displayed, focus);
    if (!hit) return;
    onInsert(hit.translation);
    if (displayed.length > 0) {
      paintFocus((hit.index + 1) % displayed.length);
    }
  };

  const tools = (
    <div className="term-list__tools">
      <form
        className="term-list__search"
        onSubmit={(event) => {
          event.preventDefault();
          const needle = query.trim();
          if (!needle || !onSearchTerms) return;
          setLookupLoading(true);
          void onSearchTerms(needle)
            .then((matches) => {
              setLookup(matches);
              setLookupError(null);
            })
            .catch((caught: unknown) => {
              setLookup([]);
              setLookupError(formatUiError(toUiError(caught)));
            })
            .finally(() => setLookupLoading(false));
        }}
      >
        <label className="field term-list__field">
          <span className="field__label">Look up a term</span>
          <input
            type="text"
            value={query}
            disabled={disabled}
            data-testid="term-search"
            placeholder="Filter this segment or search termbases"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="btn btn--secondary btn--sm"
          disabled={disabled || query.trim().length === 0 || !onSearchTerms}
        >
          Search
        </button>
      </form>
      <div className="term-list__actions">
        {extract ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={disabled || extract.pending}
            data-testid="term-extract-run"
            onClick={extract.onExtract}
          >
            {extract.pending ? "Extracting" : "Extract terms"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--primary btn--sm term-list__add"
          disabled={disabled || !canQuickAdd}
          data-testid="quick-add-term"
          title={
            canQuickAdd
              ? "Store the selected source and target as a term (Ctrl+Shift+T)"
              : "Select a phrase in the source and its translation in the target"
          }
          onClick={onQuickAdd}
        >
          Add term
        </button>
      </div>
      {extract ? (
        <div className="term-extract" data-testid="term-extract">
          {extract.error ? (
            <p className="error-text" role="alert">
              {extract.error}
            </p>
          ) : null}
          {extract.candidates.length > 0 ? (
            <ul
              className="term-extract__list"
              data-testid="term-extract-results"
            >
              {extract.candidates.map((candidate) => (
                <li key={candidate.sourceTerm} className="term-extract__item">
                  <span className="term-extract__source">
                    {candidate.sourceTerm}
                  </span>
                  {candidate.suggestedTarget ? (
                    <span className="term-extract__target">
                      {candidate.suggestedTarget}
                    </span>
                  ) : (
                    <span className="muted">No aligned translation</span>
                  )}
                  <span className="muted">×{candidate.frequency}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (error) {
    return (
      <>
        {tools}
        <p className="error-text" role="alert">
          {error}
        </p>
      </>
    );
  }
  if (loading && terms.length === 0 && !query.trim()) {
    return (
      <>
        {tools}
        <p className="muted">Checking termbases</p>
      </>
    );
  }

  const emptyMessage =
    query.trim() && displayed.length === 0
      ? `No termbase entries match "${query.trim()}"`
      : "No termbase entries in this segment";

  return (
    <>
      {tools}
      {lookupError ? (
        <p className="error-text" role="alert">
          {lookupError}
        </p>
      ) : null}
      {displayed.length === 0 ? (
        <p className="muted" data-testid="no-terms">
          {emptyMessage}
        </p>
      ) : (
        <ul
          className="term-list"
          role="listbox"
          tabIndex={0}
          aria-label="Term recognition"
          data-testid="term-list"
          onMouseLeave={() => onHighlight?.(null)}
          onKeyDown={(event) => {
            if (event.target instanceof HTMLInputElement) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              paintFocus(Math.min(displayed.length - 1, focus + 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              paintFocus(Math.max(0, focus - 1));
              return;
            }
            if (event.key === "Insert") {
              event.preventDefault();
              insertFocused();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const term = displayed[focus];
              if (term) {
                setExpandedId((current) =>
                  current === term.entryId ? null : term.entryId,
                );
              }
            }
          }}
        >
          {displayed.map((term, index) => {
            const inSegment = segmentSpanForTerm(term, terms) != null;
            const active = index === focus;
            return (
              <li
                key={`${term.entryId}:${index}`}
                role="option"
                aria-selected={active}
                data-testid={`term-hit-${index}`}
                className={`term${active ? " term--active" : ""}`}
                onMouseEnter={() => paintFocus(index)}
                onClick={() => paintFocus(index)}
              >
                <p className="term__source">{term.sourceTerm}</p>
                {term.termbaseId ? (
                  <p className="term__termbase muted">{term.termbaseId}</p>
                ) : null}
                {term.translations.length === 0 ? (
                  <p className="term__untranslated muted">
                    No translation on file
                  </p>
                ) : (
                  <div className="term__translations">
                    {[...term.translations]
                      .sort(
                        (left, right) =>
                          Number(right.preferred) - Number(left.preferred),
                      )
                      .map((translation) =>
                        translation.forbidden ? (
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
                              translation.preferred
                                ? " term__insert--preferred"
                                : ""
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
                {expandedId === term.entryId ? (
                  <dl
                    className="term__details"
                    data-testid={`term-details-${index}`}
                  >
                    <div>
                      <dt>Source</dt>
                      <dd>{term.sourceTerm}</dd>
                    </div>
                    <div>
                      <dt>Where</dt>
                      <dd>
                        {inSegment
                          ? "Recognised in this segment"
                          : "Termbase search"}
                      </dd>
                    </div>
                    {preferredTranslation(term) ? (
                      <div>
                        <dt>Insert</dt>
                        <dd>{preferredTranslation(term)}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {lookupLoading ? <p className="muted">Searching termbases</p> : null}
    </>
  );
}

function ConcordanceList({
  concordance,
  disabled,
  onSearch,
  onInsert,
}: {
  concordance: SegmentIntel["concordance"];
  disabled: boolean;
  onSearch: (query: string) => void;
  onInsert: (text: string) => void;
}) {
  const [draft, setDraft] = useState(concordance.query);
  useEffect(() => {
    setDraft(concordance.query);
  }, [concordance.query]);

  return (
    <>
      <form
        className="concordance__form"
        onSubmit={(event) => {
          event.preventDefault();
          const query = draft.trim();
          if (query) onSearch(query);
        }}
      >
        <label className="field concordance__field">
          <span className="field__label">Search memory</span>
          <input
            type="text"
            value={draft}
            disabled={disabled}
            data-testid="concordance-query"
            placeholder="Select a phrase or type one"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="btn btn--secondary btn--sm"
          disabled={disabled || draft.trim().length === 0}
        >
          Search
        </button>
      </form>
      {concordance.error ? (
        <p className="error-text" role="alert">
          {formatUiError(concordance.error)}
        </p>
      ) : concordance.loading ? (
        <p className="muted">Searching</p>
      ) : concordance.query === "" ? (
        <p className="muted" data-testid="concordance-idle">
          Select a phrase in the segment and press F3
        </p>
      ) : concordance.hits.length === 0 ? (
        <p className="muted" data-testid="no-concordance">
          {`No memory contains "${concordance.query}"`}
        </p>
      ) : (
        <ul className="concordance-list">
          {concordance.hits.map((hit: ConcordanceHit) => (
            <li key={hit.unit.id} className="concordance-hit">
              <p className="concordance-hit__source">{hit.unit.sourceText}</p>
              <p className="concordance-hit__target">{hit.unit.targetText}</p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={disabled}
                title="Insert this translation at the caret"
                onClick={() => onInsert(hit.unit.targetText)}
              >
                Insert
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AiPanel({
  ai,
  disabled,
  ocrSource,
  onApply,
}: {
  ai: SegmentAiState & {
    setAction: (action: AiAction) => void;
    generate: () => void;
  };
  disabled: boolean;
  ocrSource: boolean;
  onApply: (text: string) => void;
}) {
  const proposal = ai.run?.proposalText?.trim() ?? "";
  const runnable = ai.profiles.some(
    (profile) => profile.enabled && profile.credentialPresent,
  );

  return (
    <div className="ai-panel" data-testid="segment-ai">
      <p className="ai-panel__intro">
        Suggestions for this segment only. Leaving the row clears the proposal
        from view.
      </p>
      {ocrSource ? (
        <p className="ai-panel__intro" data-testid="ai-ocr-source-note">
          This row came from OCR. Use PDF → Correct to fix the source; Translate
          / Improve here still writes the target.
        </p>
      ) : null}
      {!ai.profilesLoaded ? (
        <p className="muted">Loading AI profiles</p>
      ) : !runnable ? (
        <p className="muted" data-testid="ai-no-profile">
          No credential-backed AI profile is enabled. Configure one under AI
          settings, then return here.
        </p>
      ) : (
        <>
          <div
            className="ai-panel__actions"
            role="group"
            aria-label="AI action"
          >
            {SEGMENT_AI_ACTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chip-toggle${
                  ai.action === item.id ? " chip-toggle--on" : ""
                }`}
                aria-pressed={ai.action === item.id}
                disabled={disabled || ai.pending}
                onClick={() => ai.setAction(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={disabled || ai.pending}
            data-testid="ai-generate"
            onClick={() => ai.generate()}
          >
            {ai.pending ? "Generating" : "Generate for this segment"}
          </button>
        </>
      )}
      {ai.error ? (
        <p className="error-text" role="alert">
          {formatUiError(ai.error)}
        </p>
      ) : null}
      {ai.run?.status === "failed" ? (
        <p className="error-text" role="alert">
          {ai.run.errorMessage ?? "Generation failed"}
        </p>
      ) : null}
      {proposal ? (
        <div className="ai-panel__proposal">
          <p className="ai-panel__proposal-text">{proposal}</p>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={disabled}
            data-testid="ai-apply"
            onClick={() => onApply(proposal)}
          >
            Apply to target
          </button>
        </div>
      ) : ai.pending ? (
        <p className="muted">Waiting for the model</p>
      ) : null}
    </div>
  );
}
