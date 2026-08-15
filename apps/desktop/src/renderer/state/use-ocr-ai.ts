import { useCallback, useEffect, useRef, useState } from "react";
import type { AiProviderProfile, AiRun } from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { invokeEngine } from "../lib/rpc";

/** Freeform prompt: correct OCR source, never translate, never narrate. */
export const OCR_CORRECT_PROMPT =
  "Correct OCR recognition errors in this segment's source text (misspellings, broken spaces, punctuation). Return only the corrected source text. Do not translate. Do not explain.";

export const OCR_AI_REASON = "AI-assisted OCR correction";

export function pickRunnableAiProfile(
  profiles: readonly AiProviderProfile[],
): AiProviderProfile | undefined {
  return profiles.find(
    (profile) => profile.enabled && profile.credentialPresent && Boolean(profile.id),
  );
}

/** Preferred AutoSuggest model when a matching profile exists. */
export const PREFERRED_SUGGEST_MODEL = "gemini-3.5-flash-lite";

/** Closest public Gemini lite id when 3.5-flash-lite is not on the gateway. */
export const FALLBACK_SUGGEST_MODEL = "gemini-3.1-flash-lite";

/**
 * Score a provider model for inline completion.
 *
 * Ghost text needs a fast non-reasoning model. A thinking / grok profile can
 * still translate a segment; it must not be the first choice for 400ms suggest.
 */
export function suggestModelScore(model: string): number {
  const value = model.toLowerCase();
  if (
    value.includes("3.5-flash-lite") ||
    value.includes("3.5_flash_lite") ||
    value === PREFERRED_SUGGEST_MODEL
  ) {
    return 100;
  }
  if (
    value.includes("3.1-flash-lite") ||
    value.includes("3.1_flash_lite") ||
    value === FALLBACK_SUGGEST_MODEL
  ) {
    return 98;
  }
  if (value.includes("flash") && value.includes("lite")) return 90;
  if (value.includes("gemini-3") && value.includes("flash")) return 80;
  if (value.includes("flash")) return 70;
  if (value.includes("lite") || value.includes("mini") || value.includes("haiku")) {
    return 60;
  }
  if (/(grok|o1|o3|o4|r1|thinking|reason)/.test(value)) return 1;
  return 10;
}

/** Runnable profile whose model is best for AutoSuggest. */
export function pickSuggestAiProfile(
  profiles: readonly AiProviderProfile[],
): AiProviderProfile | undefined {
  const runnable = profiles.filter(
    (profile) => profile.enabled && profile.credentialPresent && Boolean(profile.id),
  );
  if (runnable.length === 0) return undefined;
  return [...runnable].sort((left, right) => {
    const delta = suggestModelScore(right.model) - suggestModelScore(left.model);
    if (delta !== 0) return delta;
    return left.name.localeCompare(right.name);
  })[0];
}

export interface OcrAiState {
  run: AiRun | null;
  pending: boolean;
  error: UiError | null;
  profiles: AiProviderProfile[];
  profilesLoaded: boolean;
  runnable: boolean;
  proposal: string;
}

/**
 * AI that suggests an OCR source correction for the open correct dialog.
 *
 * The proposal is a draft only. The translator still types a reason and
 * confirms through `pdf.correctOcr`. Leaving the dialog abandons the view.
 */
export function useOcrAi(input: {
  enabled: boolean;
  projectId: string | null;
  segmentId: string | null;
  segmentRevision: number | null;
}): OcrAiState & {
  generate: () => Promise<void>;
  clear: () => void;
} {
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
  }, [input.segmentId, input.enabled]);

  useEffect(() => {
    if (!input.enabled) {
      setProfilesLoaded(false);
      setProfiles([]);
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
        } catch (caught) {
          if (token !== generation.current) return;
          setPending(false);
          setError(toUiError(caught));
        }
      })();
    }, 400);
  }, []);

  const generate = useCallback(async () => {
    if (!input.enabled || !input.projectId || !input.segmentId) return;
    if (input.segmentRevision === null) return;
    const profile = pickRunnableAiProfile(profiles);
    if (!profile) {
      setError({
        kind: "domain",
        code: "NO_PROFILE",
        message:
          "No credential-backed AI profile is enabled. Configure one under AI settings, then return here.",
      });
      return;
    }
    const token = (generation.current += 1);
    setPending(true);
    setError(null);
    setRun(null);
    try {
      const started = await invokeEngine("ai.run.start", {
        action: "freeform",
        prompt: OCR_CORRECT_PROMPT,
        expectedRevision: input.segmentRevision,
        profileId: profile.id,
        projectId: input.projectId,
        segmentId: input.segmentId,
      });
      if (token !== generation.current) return;
      setRun(started);
      if (
        started.status === "queued" ||
        started.status === "running" ||
        started.status === "retrying"
      ) {
        poll(started.id, token);
        return;
      }
      setPending(false);
    } catch (caught) {
      if (token !== generation.current) return;
      setPending(false);
      setError(toUiError(caught));
    }
  }, [
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

  const proposal = run?.proposalText?.trim() ?? "";
  const runnable = pickRunnableAiProfile(profiles) !== undefined;

  return {
    run,
    pending,
    error,
    profiles,
    profilesLoaded,
    runnable,
    proposal,
    generate,
    clear,
  };
}
