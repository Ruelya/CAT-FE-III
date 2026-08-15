import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorSuggestion } from "@translunar/contracts";

export interface SuggestionPopupProps {
  suggestions: EditorSuggestion[];
  activeIndex: number;
  onHover: (index: number) => void;
  onAccept: (suggestion: EditorSuggestion) => void;
  onDismiss: () => void;
}

const SOURCE_LABEL: Record<EditorSuggestion["source"], string> = {
  nonTranslatable: "source",
  term: "term",
  memoryFragment: "memory",
};

/**
 * The as-you-type completion list.
 *
 * Deliberately not a combobox: the target editor stays a plain text field with
 * its own IME behaviour, and wrapping it in combobox semantics would have the
 * screen reader announce a listbox over the top of the candidate window an IME
 * is already showing. Instead the list is a polite status region the caret
 * never enters, and every entry says where it came from, because "the termbase
 * says this" and "some old translation said this" deserve different trust.
 */
export function SuggestionPopup({
  suggestions,
  activeIndex,
  onHover,
  onAccept,
  onDismiss,
}: SuggestionPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);

  useEffect(() => {
    const onWindowBlur = () => onDismiss();
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, [onDismiss]);

  // Flip above the field when there is no room below. The last segment of a
  // document is both the most likely place to run out of room and the place a
  // translator is least willing to scroll, so this is not an edge case.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setAbove(false);
    const frame = requestAnimationFrame(() => {
      const box = element.getBoundingClientRect();
      const room = window.innerHeight - box.top;
      setAbove(box.height > room && box.top > box.height);
    });
    return () => cancelAnimationFrame(frame);
  }, [suggestions]);

  if (suggestions.length === 0) return null;

  return (
    <div
      ref={ref}
      className={`suggestions${above ? " suggestions--above" : ""}`}
      data-testid="suggestion-popup"
      role="status"
      aria-live="polite"
    >
      <ul className="suggestions__list">
        {suggestions.map((suggestion, index) => (
          <li key={`${suggestion.source}:${suggestion.text}`}>
            <button
              type="button"
              className={`suggestions__item${
                index === activeIndex ? " suggestions__item--active" : ""
              }`}
              data-testid={`suggestion-${index}`}
              // The target editor must keep focus: losing it mid-word would
              // drop the IME composition the translator is in the middle of.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onAccept(suggestion)}
            >
              <span className="suggestions__text">{suggestion.text}</span>
              <span className="suggestions__source">
                {SOURCE_LABEL[suggestion.source]}
              </span>
              {suggestion.hint ? (
                <span className="suggestions__hint truncate">
                  {suggestion.hint}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <p className="suggestions__legend">
        Tab or Enter to accept, Esc to close
      </p>
    </div>
  );
}
