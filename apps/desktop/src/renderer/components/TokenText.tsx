import { useMemo } from "react";

import { lexPlaceholderTokens } from "../lib/tokens.js";

export interface TokenTextProps {
  text: string;
  /**
   * Tokens flagged by an open `qa.tag-placeholder_*` issue (evidence
   * values); matching tokens get the danger outline. QA drives this —
   * the renderer never re-judges a mismatch on its own.
   */
  dangerTokens?: ReadonlySet<string> | undefined;
}

/**
 * Renders text with placeholder tokens ({name}, {{var}}, %s, <b>, &amp;)
 * as mono glyph chips, using the same token grammar as the engine's QA
 * placeholder rules and the AI tagCheck. Plain text renders untouched.
 */
export function TokenText({ text, dangerTokens }: TokenTextProps) {
  const runs = useMemo(() => lexPlaceholderTokens(text), [text]);
  if (!runs.some((run) => run.token)) {
    return <>{text}</>;
  }
  return (
    <>
      {runs.map((run, index) =>
        run.token ? (
          <span
            key={index}
            className="tl-token"
            data-danger={dangerTokens?.has(run.text) || undefined}
          >
            {run.text}
          </span>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}
