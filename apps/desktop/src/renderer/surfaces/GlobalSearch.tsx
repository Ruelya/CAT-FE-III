import { useState, type FormEvent } from "react";
import type { GlobalSearchHit } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { searchHitKey } from "../state/search-navigation";

export interface GlobalSearchProps {
  submittedQuery: string;
  pendingQuery?: string | null;
  items: GlobalSearchHit[];
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  error: UiError | null;
  navigationError: UiError | null;
  disabled?: boolean;
  onSearch: (query: string) => void;
  onPage: (offset: number) => void;
  onActivate: (hit: GlobalSearchHit) => void;
}

export function GlobalSearch({
  submittedQuery,
  pendingQuery = null,
  items,
  total,
  offset,
  limit,
  loading,
  error,
  navigationError,
  disabled,
  onSearch,
  onPage,
  onActivate,
}: GlobalSearchProps) {
  const [query, setQuery] = useState(submittedQuery);
  const busy = Boolean(disabled || loading);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch(query);
  }

  return (
    <section className="surface" data-testid="global-search">
      <div className="surface__masthead">
        <h1 className="surface__title">Search</h1>
      </div>

      <form className="search-form" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="global-search-input">
            Query
          </label>
          <div className="search-form__row">
            <input
              id="global-search-input"
              className="field__control"
              value={query}
              disabled={disabled}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {loading ? "Searching" : "Search"}
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <p className="error-text" data-testid="search-error">
          {formatUiError(error)}
          {pendingQuery ? ` (${pendingQuery})` : ""}
        </p>
      ) : null}
      {navigationError ? (
        <p className="error-text">{formatUiError(navigationError)}</p>
      ) : null}

      {submittedQuery && !loading ? (
        <p className="muted" role="status" data-testid="search-result-status">
          {total} result{total === 1 ? "" : "s"} for “{submittedQuery}”
        </p>
      ) : null}
      {loading && pendingQuery ? (
        <p className="muted" role="status">
          Searching “{pendingQuery}”
        </p>
      ) : null}

      <ul className="search-results" data-testid="search-results">
        {items.map((hit, index) => (
          <li key={searchHitKey(hit, index)} className="search-result">
            <button
              type="button"
              className="search-result__button"
              disabled={busy}
              onClick={() => onActivate(hit)}
            >
              <span className="search-result__title">
                {hit.projectName}
                {hit.documentName ? ` · ${hit.documentName}` : ""}
                {hit.segmentOrdinal != null ? ` · #${hit.segmentOrdinal}` : ""}
              </span>
              <span className="search-result__meta muted">
                {hit.field}
                {hit.workflowState ? ` · ${hit.workflowState}` : ""}
              </span>
              <span className="search-result__snippet">{hit.snippet}</span>
            </button>
          </li>
        ))}
      </ul>

      {submittedQuery ? (
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy || offset <= 0}
            onClick={() => onPage(Math.max(0, offset - limit))}
          >
            Previous
          </button>
          <span className="muted">
            {total === 0
              ? "0"
              : `${offset + 1}–${Math.min(offset + items.length, total)}`}{" "}
            of {total}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy || offset + limit >= total}
            onClick={() => onPage(offset + limit)}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
