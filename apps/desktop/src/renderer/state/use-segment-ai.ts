import { useCallback, useEffect, useRef, useState } from "react";
import type { AiAction, AiProviderProfile, AiRun } from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { invokeEngine } from "../lib/rpc";

export interface SegmentAiState {
  action: AiAction;
  run: AiRun | null;
  pending: boolean;
  error: UiError | null;
  profiles: AiProviderProfile[];
  profilesLoaded: boolean;
}

const ACTIONS: Array<{ id: AiAction; label: string }> = [
  { id: "translate", label: "Translate" },
  { id: "improve", label: "Improve" },
  { id: "formal", label: "More formal" },
  { id: "shorten", label: "Shorter" },
  { id: "literal", label: "More literal" },
];

export const SEGMENT_AI_ACTIONS = ACTIONS;

/**
 * AI that lives on the current segment, not in a side chat.
 *
 * A run is always tied to one segmentId. Leaving that segment abandons the
 * visible proposal (the Engine run itself continues to completion and remains
 * in history), because applying a proposal to the wrong row is worse than
 * asking again.
 */
export function useSegmentAi(input: {
  enabled: boolean;
  projectId: string | null;
  segmentId: string | null;
  segmentRevision: number | null;
}): SegmentAiState & {
  setAction: (action: AiAction) => void;
  generate: () => Promise<void>;
  clear: () => void;
} {
  const [action, setAction] = useState<AiAction>("translate");
  const [run, setRun] = useState<AiRun | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const generation = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => {
    clearPoll();
    generation.current += 1;
    setRun(null);
    setPending(false);
    setError(null);
  }, [input.segmentId]);

  useEffect(() => {
    if (!input.enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await invokeEngine("ai.provider.list", {
          offset: 0,
          limit: 50,
        });
        if (cancelled) return;
        setProfiles(page.items);
        setProfilesLoaded(true);
      } catch {
        if (!cancelled) {
          setProfiles([]);
          setProfilesLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.enabled]);

  useEffect(() => () => clearPoll(), []);

  const poll = useCallback((runId: string, token: number) => {
    clearPoll();
    pollTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const next = await invokeEngine("ai.run.get", { runId });
          if (token !== generation.current) return;
          setRun(next);
          if (
            next.status === "queued" ||
            next.status === "running" ||
            next.status === "retrying"
          ) {
            poll(runId, token);
            return;
          }
          setPending(false);
        } catch (error) {
          if (token !== generation.current) return;
          setPending(false);
          setError(toUiError(error));
        }
      })();
    }, 400);
  }, []);

  const generate = useCallback(async () => {
    if (!input.enabled || !input.projectId || !input.segmentId) return;
    if (input.segmentRevision === null) return;
    const profile = profiles.find((item) => item.enabled !== false && item.id);
    if (!profile) {
      setError({
        kind: "domain",
        code: "NO_PROFILE",
        message:
          "No AI profile is configured. Add a provider in AI settings first.",
      });
      return;
    }
    const token = (generation.current += 1);
    setPending(true);
    setError(null);
    setRun(null);
    try {
      const started = await invokeEngine("ai.run.start", {
        action,
        expectedRevision: input.segmentRevision,
        profileId: profile.id,
        projectId: input.projectId,
        segmentId: input.segmentId,
      });
      if (token !== generation.current) return;
      setRun(started);
      poll(started.id, token);
    } catch (error) {
      if (token !== generation.current) return;
      setPending(false);
      setError(toUiError(error));
    }
  }, [
    action,
    input.enabled,
    input.projectId,
    input.segmentId,
    input.segmentRevision,
    poll,
    profiles,
  ]);

  const clear = useCallback(() => {
    clearPoll();
    generation.current += 1;
    setRun(null);
    setPending(false);
    setError(null);
  }, []);

  return {
    action,
    run,
    pending,
    error,
    profiles,
    profilesLoaded,
    setAction,
    generate,
    clear,
  };
}
