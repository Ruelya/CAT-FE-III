import { useEffect, useMemo, useState } from "react";

import type { Segment, TmMatchItem } from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel, TextField } from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface ConcordanceHit {
  segment: Segment;
  field: "source" | "target";
  text: string;
}

export interface ConcordancePanelProps {
  projectId: string;
  segments: Segment[];
  /** Seed query, e.g. the text selection captured on F3. */
  initialQuery: string;
  onJump: (segmentId: string) => void;
}

/** Fuzzy floor for TM concordance: recall generously, the score is shown. */
const TM_CONCORDANCE_MIN_SCORE = 50;

/** Case-insensitive substring search over the loaded document's segments. */
export function searchConcordance(
  segments: readonly Segment[],
  query: string,
): ConcordanceHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const hits: ConcordanceHit[] = [];
  for (const segment of segments) {
    if (segment.sourceText.toLowerCase().includes(needle)) {
      hits.push({ segment, field: "source", text: segment.sourceText });
    }
    if (
      segment.targetText.length > 0 &&
      segment.targetText.toLowerCase().includes(needle)
    ) {
      hits.push({ segment, field: "target", text: segment.targetText });
    }
  }
  return hits;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return <>{text}</>;
  }
  const parts: Array<{ chunk: string; hit: boolean }> = [];
  let rest = text;
  let restLower = text.toLowerCase();
  let index = restLower.indexOf(needle);
  while (index >= 0) {
    if (index > 0) {
      parts.push({ chunk: rest.slice(0, index), hit: false });
    }
    parts.push({ chunk: rest.slice(index, index + needle.length), hit: true });
    rest = rest.slice(index + needle.length);
    restLower = restLower.slice(index + needle.length);
    index = restLower.indexOf(needle);
  }
  if (rest.length > 0) {
    parts.push({ chunk: rest, hit: false });
  }
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={i} className="concordance__hit">
            {part.chunk}
          </mark>
        ) : (
          <span key={i}>{part.chunk}</span>
        ),
      )}
    </>
  );
}

export function ConcordancePanel({
  projectId,
  segments,
  initialQuery,
  onJump,
}: ConcordancePanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [tmMatches, setTmMatches] = useState<TmMatchItem[]>([]);
  const [tmError, setTmError] = useState<string | null>(null);

  // F3 with a new selection re-seeds the query even if the tab was open.
  useEffect(() => {
    if (initialQuery.trim().length > 0) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  const hits = useMemo(
    () => searchConcordance(segments, query),
    [segments, query],
  );

  // TM concordance backed by the engine's fuzzy lookup.
  useEffect(() => {
    setTmMatches([]);
    setTmError(null);
    const needle = query.trim();
    if (needle.length === 0) {
      return;
    }
    let cancelled = false;
    callEngine("tm.lookup", {
      projectId,
      sourceText: needle,
      minScore: TM_CONCORDANCE_MIN_SCORE,
    })
      .then((result) => {
        if (!cancelled) {
          setTmMatches(result.matches);
        }
      })
      .catch((lookupError: unknown) => {
        if (!cancelled) {
          setTmError(describeError(lookupError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, query]);

  return (
    <Panel
      title="Concordance 检索"
      className="dock-panel"
      actions={
        query.trim() ? <Badge tone="accent">{hits.length} 命中</Badge> : null
      }
    >
      <div className="dock-stack">
        <TextField
          label="检索词"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.trim().length === 0 ? (
          <EmptyState title="输入检索词" />
        ) : hits.length === 0 ? (
          <EmptyState title="文档内无命中" />
        ) : (
          <div className="dock-stack">
            {hits.map((hit) => (
              <div
                key={`${hit.segment.id}-${hit.field}`}
                className="match-card"
              >
                <div className="match-card__row">
                  <span className="concordance__meta">
                    <Badge tone={hit.field === "source" ? "neutral" : "accent"}>
                      {hit.field === "source" ? "源文" : "译文"}
                    </Badge>
                    <span className="concordance__ordinal">
                      #{hit.segment.ordinal + 1}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onJump(hit.segment.id)}
                  >
                    定位句段
                  </Button>
                </div>
                <p className="match-card__text">
                  <Highlighted text={hit.text} query={query} />
                </p>
              </div>
            ))}
          </div>
        )}
        {query.trim().length > 0 ? (
          <section className="concordance__tm" aria-label="TM 命中">
            <h4 className="concordance__tm-heading">
              项目 TM（模糊检索）
              {tmMatches.length > 0 ? (
                <Badge tone="accent">{tmMatches.length} 条</Badge>
              ) : null}
            </h4>
            {tmError ? (
              <div className="honest-note" data-tone="danger" role="alert">
                {tmError}
              </div>
            ) : tmMatches.length === 0 ? (
              <EmptyState title="TM 内无相似条目" />
            ) : (
              <div className="dock-stack">
                {tmMatches.map((match) => (
                  <div key={match.entry.id} className="match-card">
                    <div className="match-card__row">
                      <Badge tone={match.grade === "fuzzy" ? "accent" : "ok"}>
                        {match.score}%
                      </Badge>
                    </div>
                    <p className="match-card__text">
                      <Highlighted
                        text={match.entry.sourceText}
                        query={query}
                      />
                    </p>
                    <span className="match-card__origin">
                      译：{match.entry.targetText}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </Panel>
  );
}
