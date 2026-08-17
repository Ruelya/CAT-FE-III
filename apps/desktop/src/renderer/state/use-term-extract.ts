import { useCallback, useState } from "react";
import type { TermCandidate } from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { invokeEngine } from "../lib/rpc";

export interface TermExtractState {
  pending: boolean;
  error: UiError | null;
  candidates: TermCandidate[];
}

/**
 * Document-scoped term harvest for the open file.
 *
 * Candidates are suggestions. Inserting a suggested target writes the draft
 * only. Storing a term still goes through Asset Hub / Quick Add.
 */
export function useTermExtract(documentId: string | null): TermExtractState & {
  extract: () => Promise<void>;
  clear: () => void;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [candidates, setCandidates] = useState<TermCandidate[]>([]);

  const extract = useCallback(async () => {
    if (!documentId) {
      setError({
        kind: "domain",
        code: "NO_DOCUMENT",
        message: "Open a document before extracting terms.",
      });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const report = await invokeEngine("ai.quality.extractTerms", {
        documentId,
      });
      setCandidates(report.candidates);
      setPending(false);
    } catch (caught) {
      setPending(false);
      setError(toUiError(caught));
    }
  }, [documentId]);

  const clear = useCallback(() => {
    setCandidates([]);
    setError(null);
    setPending(false);
  }, []);

  return { pending, error, candidates, extract, clear };
}
