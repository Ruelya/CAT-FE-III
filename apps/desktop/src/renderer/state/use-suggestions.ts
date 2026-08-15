import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorSuggestion } from "@translunar/contracts";

import { invokeEngine } from "../lib/rpc";

export interface SuggestionState {
  suggestions: EditorSuggestion[];
  activeIndex: number;
  prefix: string;
}

const EMPTY: SuggestionState = { suggestions: [], activeIndex: 0, prefix: "" };

/** Characters typed before the host is asked. Below this the list is noise. */
const MIN_PREFIX = 2;
/** Debounce. Long enough to skip intermediate keystrokes, short enough to feel
 *  like the editor is keeping up rather than catching up. */
const DEBOUNCE_MS = 90;

/**
 * As-you-type completions for the target editor.
 *
 * Requests are debounced and every response is checked against the request
 * that is current when it lands, because the answer to a prefix the translator
 * has already typed past is worse than no answer: it flashes a list that does
 * not match what is on screen.
 */
export function useSuggestions(input: {
  enabled: boolean;
  projectId: string | null;
  segmentId: string | null;
}): SuggestionState & {
  request: (targetText: string, caret: number) => void;
  dismiss: () => void;
  move: (delta: number) => void;
  accept: () => EditorSuggestion | null;
  setActiveIndex: (index: number) => void;
} {
  const [state, setState] = useState<SuggestionState>(EMPTY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const dismissedFor = useRef<string | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  // Leaving the segment ends the conversation; a list computed for the
  // previous sentence must never be offered against the next one.
  useEffect(() => {
    clearTimer();
    generation.current += 1;
    dismissedFor.current = null;
    setState(EMPTY);
  }, [input.segmentId, input.enabled]);

  useEffect(() => () => clearTimer(), []);

  const dismiss = useCallback(() => {
    clearTimer();
    generation.current += 1;
    setState((previous) => {
      dismissedFor.current = previous.prefix;
      return EMPTY;
    });
  }, []);

  const request = useCallback(
    (targetText: string, caret: number) => {
      if (!input.enabled || !input.projectId || !input.segmentId) return;
      clearTimer();
      const token = (generation.current += 1);
      timer.current = setTimeout(() => {
        void (async () => {
          try {
            const result = await invokeEngine("editor.suggest", {
              projectId: input.projectId as string,
              segmentId: input.segmentId as string,
              targetText,
              caret,
              limit: 8,
            });
            if (token !== generation.current) return;
            if (result.prefix.length < MIN_PREFIX) {
              setState(EMPTY);
              return;
            }
            // Esc closed the list for this word; do not reopen it until the
            // translator moves on to a different one.
            if (dismissedFor.current === result.prefix) return;
            dismissedFor.current = null;
            setState({
              suggestions: result.suggestions,
              activeIndex: 0,
              prefix: result.prefix,
            });
          } catch {
            // A failed completion is not worth interrupting anyone over, but
            // it must not leave a stale list on screen either.
            if (token === generation.current) setState(EMPTY);
          }
        })();
      }, DEBOUNCE_MS);
    },
    [input.enabled, input.projectId, input.segmentId],
  );

  const move = useCallback((delta: number) => {
    setState((previous) => {
      if (previous.suggestions.length === 0) return previous;
      const count = previous.suggestions.length;
      // Wrapping keeps a short list navigable with one key rather than two.
      const next = (previous.activeIndex + delta + count) % count;
      return { ...previous, activeIndex: next };
    });
  }, []);

  const accept = useCallback((): EditorSuggestion | null => {
    const chosen = state.suggestions[state.activeIndex] ?? null;
    if (chosen) {
      clearTimer();
      generation.current += 1;
      setState(EMPTY);
    }
    return chosen;
  }, [state]);

  const setActiveIndex = useCallback((index: number) => {
    setState((previous) => ({ ...previous, activeIndex: index }));
  }, []);

  return { ...state, request, dismiss, move, accept, setActiveIndex };
}
