import { useCallback, useEffect, useRef, useState } from "react";
import type { AiProviderProfile } from "@translunar/contracts";

import { pickSuggestAiProfile } from "./use-ocr-ai";
import { invokeEngine } from "../lib/rpc";
import {
  AI_SUGGEST_GROUNDING,
  attachCompletion,
  buildCompletePrompt,
  livePrefix,
} from "../lib/inline-completion";

const MIN_PREFIX = 2;
const DEBOUNCE_MS = 400;

export interface AiSuggestState {
  suffix: string;
  pending: boolean;
  runnable: boolean;
}

/**
 * Context-aware inline continuation for the target caret.
 *
 * Uses the existing `ai.run.start` freeform lane with engine grounding
 * (terms / TM / neighbour segments). The unsaved draft travels in `prompt`.
 * Failures are silent: a missed completion must not toast over typing.
 */
export function useAiSuggest(input: {
  enabled: boolean;
  projectId: string | null;
  segmentId: string | null;
  segmentRevision: number | null;
}): AiSuggestState & {
  request: (targetText: string, caret: number) => void;
  dismiss: () => void;
  consume: (unit: string) => void;
} {
  const [suffix, setSuffix] = useState("");
  const [pending, setPending] = useState(false);
  const [runnable, setRunnable] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const profilesReady = useRef(false);
  const profilesRef = useRef<AiProviderProfile[]>([]);
  const runnableRef = useRef(false);
  const queued = useRef<{ text: string; caret: number } | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const bump = () => {
    clearTimer();
    generation.current += 1;
    setSuffix("");
    setPending(false);
  };

  useEffect(() => {
    queued.current = null;
    bump();
  }, [input.segmentId, input.enabled]);

  useEffect(() => {
    if (!input.enabled) {
      profilesReady.current = false;
      profilesRef.current = [];
      runnableRef.current = false;
      setRunnable(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const page = await invokeEngine("ai.provider.list", {
          offset: 0,
          limit: 50,
        });
        if (cancelled) return;
        const profile = pickSuggestAiProfile(page.items);
        profilesReady.current = true;
        profilesRef.current = page.items;
        runnableRef.current = profile !== undefined;
        setRunnable(profile !== undefined);
      } catch {
        if (!cancelled) {
          profilesReady.current = true;
          profilesRef.current = [];
          runnableRef.current = false;
          setRunnable(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.enabled]);

  useEffect(() => () => clearTimer(), []);

  const dismiss = useCallback(() => {
    queued.current = null;
    bump();
  }, []);

  const consume = useCallback((unit: string) => {
    if (!unit) return;
    setSuffix((previous) =>
      previous.startsWith(unit) ? previous.slice(unit.length) : "",
    );
  }, []);

  const request = useCallback(
    (targetText: string, caret: number) => {
      if (!input.enabled || !input.projectId || !input.segmentId) return;
      if (input.segmentRevision === null) return;
      if (!profilesReady.current || !runnableRef.current) {
        queued.current = { text: targetText, caret };
        return;
      }
      queued.current = null;
      const prefix = livePrefix(targetText, caret);
      if (prefix.length < MIN_PREFIX) {
        queued.current = null;
        bump();
        return;
      }
      clearTimer();
      const token = (generation.current += 1);
      const projectId = input.projectId;
      const segmentId = input.segmentId;
      const revision = input.segmentRevision;
      timer.current = setTimeout(() => {
        void (async () => {
          try {
            if (token !== generation.current) return;
            const profile = pickSuggestAiProfile(profilesRef.current);
            if (!profile) {
              runnableRef.current = false;
              setRunnable(false);
              setPending(false);
              setSuffix("");
              return;
            }
            setPending(true);
            const started = await invokeEngine("ai.run.start", {
              action: "freeform",
              prompt: buildCompletePrompt(targetText, caret),
              expectedRevision: revision,
              profileId: profile.id,
              projectId,
              segmentId,
              options: AI_SUGGEST_GROUNDING,
            });
            if (token !== generation.current) return;
            let run = started;
            while (
              run.status === "queued" ||
              run.status === "running" ||
              run.status === "retrying"
            ) {
              await new Promise((resolve) => setTimeout(resolve, 400));
              if (token !== generation.current) return;
              run = await invokeEngine("ai.run.get", { runId: run.id });
            }
            if (token !== generation.current) return;
            setPending(false);
            if (run.status !== "succeeded") {
              setSuffix("");
              return;
            }
            setSuffix(attachCompletion(run.proposalText ?? "", targetText, caret));
          } catch {
            if (token === generation.current) {
              setPending(false);
              setSuffix("");
            }
          }
        })();
      }, DEBOUNCE_MS);
    },
    [input.enabled, input.projectId, input.segmentId, input.segmentRevision],
  );

  useEffect(() => {
    if (!runnable) return;
    const pendingRequest = queued.current;
    if (!pendingRequest) return;
    queued.current = null;
    request(pendingRequest.text, pendingRequest.caret);
  }, [runnable, request]);

  return { suffix, pending, runnable, request, dismiss, consume };
}
