import type { DisplayFilter } from "../state/display-filter";
import {
  describeFilter,
  EMPTY_FILTER,
  isFilterActive,
} from "../state/display-filter";

export interface DisplayFilterBarProps {
  filter: DisplayFilter;
  shown: number;
  total: number;
  disabled?: boolean;
  onChange: (filter: DisplayFilter) => void;
}

const STATES: Array<{ id: string; label: string }> = [
  { id: "untranslated", label: "Open" },
  { id: "draft", label: "Draft" },
  { id: "confirmed", label: "Confirmed" },
];

/**
 * Pull the segments that need attention out of a document.
 *
 * This is the editor's second job, and the one that makes review possible at
 * all: without it, checking a four hundred segment file means scrolling it and
 * hoping. Criteria combine rather than replace each other, because the real
 * question is usually compound - "drafts that also have a QA finding".
 */
export function DisplayFilterBar({
  filter,
  shown,
  total,
  disabled,
  onChange,
}: DisplayFilterBarProps) {
  const active = isFilterActive(filter);
  const toggleState = (id: string) => {
    const states = filter.states.includes(id)
      ? filter.states.filter((value) => value !== id)
      : [...filter.states, id];
    onChange({ ...filter, states });
  };

  return (
    <div
      className={`display-filter${active ? " display-filter--active" : ""}`}
      data-testid="display-filter"
    >
      <span className="display-filter__label" aria-hidden="true">
        Show
      </span>
      <div className="display-filter__group" role="group" aria-label="Status">
        {STATES.map((state) => (
          <button
            key={state.id}
            type="button"
            className={`chip-toggle${
              filter.states.includes(state.id) ? " chip-toggle--on" : ""
            }`}
            aria-pressed={filter.states.includes(state.id)}
            disabled={disabled}
            data-testid={`filter-state-${state.id}`}
            onClick={() => toggleState(state.id)}
          >
            {state.label}
          </button>
        ))}
      </div>

      <div className="display-filter__group" role="group" aria-label="Marks">
        <button
          type="button"
          className={`chip-toggle${filter.withQaIssues ? " chip-toggle--on" : ""}`}
          aria-pressed={filter.withQaIssues}
          disabled={disabled}
          data-testid="filter-qa"
          onClick={() =>
            onChange({ ...filter, withQaIssues: !filter.withQaIssues })
          }
        >
          Findings
        </button>
        <button
          type="button"
          className={`chip-toggle${filter.withComments ? " chip-toggle--on" : ""}`}
          aria-pressed={filter.withComments}
          disabled={disabled}
          data-testid="filter-comments"
          onClick={() =>
            onChange({ ...filter, withComments: !filter.withComments })
          }
        >
          Comments
        </button>
        <button
          type="button"
          className={`chip-toggle${filter.repeatsOnly ? " chip-toggle--on" : ""}`}
          aria-pressed={filter.repeatsOnly}
          disabled={disabled}
          data-testid="filter-repeats"
          onClick={() =>
            onChange({ ...filter, repeatsOnly: !filter.repeatsOnly })
          }
        >
          Repeats
        </button>
      </div>

      <label className="display-filter__search">
        <span className="visually-hidden">Filter text</span>
        <input
          type="text"
          value={filter.text}
          disabled={disabled}
          placeholder="Filter text"
          data-testid="filter-text"
          onChange={(event) =>
            onChange({ ...filter, text: event.target.value })
          }
        />
      </label>
      <label className="display-filter__side">
        <span className="visually-hidden">Filter side</span>
        <select
          value={filter.field}
          disabled={disabled}
          data-testid="filter-side"
          onChange={(event) =>
            onChange({
              ...filter,
              field: event.target.value as DisplayFilter["field"],
            })
          }
        >
          <option value="both">Both</option>
          <option value="source">Source</option>
          <option value="target">Target</option>
        </select>
      </label>
      <label className="display-filter__regex">
        <input
          type="checkbox"
          checked={filter.regex}
          disabled={disabled}
          data-testid="filter-regex"
          onChange={(event) =>
            onChange({ ...filter, regex: event.target.checked })
          }
        />
        <span>Regex</span>
      </label>

      {/* The count is the filter's honesty: it says how much of the document
          is being hidden, so nobody signs off on a file they only saw part of. */}
      <span className="display-filter__count" data-testid="filter-count">
        {describeFilter(filter, shown, total)}
      </span>
      {active ? (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={disabled}
          data-testid="filter-clear"
          onClick={() => onChange(EMPTY_FILTER)}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
